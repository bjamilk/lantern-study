# The lease on a `__processing__` idempotency claim (#117)

`withIdempotency` claims a key by INSERTing `{_status: '__processing__'}`, runs the handler, then
stores the response — or, on a throw, `{_status: '__failed__', _failedAt}`, which ages out after
`FAILURE_TTL_MS` (10 min). Only ONE of the two non-terminal markers had an expiry. If the process
died between the claim and the finish (deploy, crash, OOM), or the failure marker write itself
failed (`idempotency-failure-marker-write-failed`, #108), the key stayed at `__processing__` and
every retry on it waited 5 s and answered 409, for ever.

## 1. How a claim is stored, and what is already atomic

`public.api_idempotency_keys` (`supabase/migrations/20260710180000_phase0_security_hardening.sql:30`):
`(user_id, operation, idempotency_key)` PRIMARY KEY, `response jsonb NOT NULL`,
`created_at timestamptz NOT NULL DEFAULT now()`. No Redis, no module state — the guarantee has
to hold across Render replicas. The claim is atomic because it is an INSERT and the primary key
decides the winner; the loser gets `23505` and reads the row back.

**No migration.** The claim time goes in the marker — `{_status, _claimedAt}` — because the
marker is already what the CAS filters on, and jsonb needs no DDL. `created_at` alone would not
do: it is the row's FIRST claim, and a reclaim UPDATEs `response` without touching it. It is
still the fallback for rows claimed before this shipped, and for those the two coincide.

## 2. LEASE = 20 minutes

The lease must clear the longest a LIVE handler can legitimately run, or it hands a second
request a key whose first execution is still working. The ceiling is outbound HTTP:
`middleware/timeout.ts` caps the REQUEST at 30 s, but `req.setTimeout` only destroys the socket
— the handler keeps running; and `paystackFetch` passes **no `AbortSignal`**, so a stalled
Paystack call is bounded only by undici's defaults, 300 s headers + 300 s body ≈ **10 min**.
(The AI path is the tidy counter-example, `AbortSignal.timeout(AI_FETCH_TIMEOUT_MS)` = 120 s,
and no AI route is behind this wrapper anyway.)

20 minutes is that 10-minute worst case with 2x margin. Bounding `paystackFetch` would let it
fall to the ~2 min the issue suggested; **founder decision / follow-up issue.** A claim younger
than the lease behaves exactly as it did: wait, then 409 `IDEMPOTENCY_CONCURRENT`.

## 3. Taking an abandoned claim: one statement, two columns

```sql
UPDATE api_idempotency_keys SET response = <next>
 WHERE user_id = $1 AND operation = $2 AND idempotency_key = $3
   AND response->>'_status'    = '__processing__'
   AND response->>'_claimedAt' = $4      -- or IS NULL for a pre-#117 row
RETURNING idempotency_key
```

PostgreSQL row-locks for the duration of that UPDATE. Under READ COMMITTED a second UPDATE that
finds the row locked waits, then re-evaluates its WHERE against what the winner wrote; the
timestamp has moved, so it matches nothing and RETURNING gives it no row — the returned row IS
the claim. The timestamp must be in the predicate: on the reclaim path the winner also writes
`__processing__`, so a status-only filter would let both retries "win" — the exact bug G3 · H5
fixed for the failure marker.

## 4. Replay safety per caller, and why the default is `leaseReclaim: false`

An abandoned claim says only "the holder never came back" — not whether it created the order,
charged the card or did nothing. Most handlers here end in a plain INSERT or a relative balance
change, so the default is NOT to replay: the claim is CAS'd to `__failed__` (`_abandoned: true`),
the retry gets `IDEMPOTENCY_PREVIOUS_FAILED` ("mint a new key") immediately instead of a 5 s
wait and an untrue "still in flight", and the key frees itself `FAILURE_TTL_MS` later through
the stale-failure path that already ships. No key is 409-forever any more. `leaseReclaim: true`
only skips that extra 10 minutes, for a handler whose every write is guarded.

| operation | decisive write | replay | setting |
|---|---|---|---|
| `marketplace_create_offer` | INSERT under the one-pending-per-buyer unique index; `23505` caught, existing offer returned | safe | **true** |
| `marketplace_payment_link` | no row write at all; one buyer notification | safe | **true** |
| `note_share_accept` | RPC `accept_note_share_link`: `FOR UPDATE`, returns `already_accepted` | safe | **true** |
| `test_result_create` | upsert on `session_id`; coins via `awardWalletOnce(testAwardKey)` | safe | **true** |
| `marketplace_offer_accept` | RPC returns the existing order when already accepted; checkout resumes the open payment row | safe, but money — deferred | false |
| `marketplace_order_action` (PATCH) | every branch status-gated or CAS-claimed; payout has a deterministic transfer ref | safe, but money — deferred | false |
| `marketplace_create_coupon` | INSERT under `(seller_id, code)` unique — no duplicate, but the replay errors rather than replaying | no gain | false |
| `marketplace_buy_now` | new order + payment row + `initializePaystackTransaction` on a fresh reference | UNSAFE: second charge session | false |
| `marketplace_cart_checkout:<fp>` | new checkout + one order per line + `createCheckoutCharge` | UNSAFE: second charge session | false |
| `streak_freeze_purchase` | `wallet_adjust_balance(-50)`, relative, unkeyed | UNSAFE: double debit | false |
| `streak_freeze_use` | absolute SET from a read taken OUTSIDE the claim | UNSAFE: second freeze spent | false |
| `marketplace_boost` | credit decremented BEFORE `boosted_until` is stamped | UNSAFE: second credit burnt | false |
| `budget_contribute` | goal total from a pre-claim read + plain transaction INSERT | UNSAFE: double-applied | false |
| `budget_create_transaction` | upsert on an id `randomUUID()`d per request when the client sends none | UNSAFE: second row | false |
| `marketplace_create_listing`, `test_create_personal`, `test_session_create`, `deck_create_with_cards`, `note_copy` | plain INSERT, no natural key | UNSAFE: duplicate row | false |

Widening this: several handlers compute their write from a read taken BEFORE the claim
(`gamification.ts:781`, `budget.ts:129`, `budget.ts:311`), so making them replay-safe means
moving the read inside the claim, not just flipping the flag.

## 5. Observability

Every abandoned claim this request retires or re-claims logs at **warn** with
`{operation, userId, ageMs, keyDigest, reclaim}` — the key is client-chosen text, so only a
12-char SHA-256 prefix is logged. A retirement is also reported to Sentry under the stable
fingerprint **`idempotency-key-abandoned`**, ids and age only; a burst means a replica is dying
mid-handler.
