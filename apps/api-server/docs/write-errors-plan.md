# Discarded write errors in the API (#108) — census and plan

supabase-js never throws on a failed write: an awaited insert / update / upsert / delete
RESOLVES with `{ data, error }`. A bare `await …;` statement therefore ignores failure, and
so does a `try/catch` wrapped around one.

## How the census was taken

1. The issue's perl one-liner, re-run over non-test `.ts` under `routes services middleware
   queue utils`: **87 bare awaited writes in 28 files** (reproduced exactly).
2. The guard test (A2) re-derives that number and widens it to the three shapes the
   one-liner cannot see, all confirmed by lane R2. It scans with comments and string bodies
   blanked out, which matters: a `;` inside a comment in `marketplacePayments.ts` ("…opened
   against; settlement refuses…") ended three payment inserts early and made three writes
   that DO check their error read as unchecked.

   | shape | how it is found | today |
   |---|---|---|
   | `bare` — bare awaited `.from('t').update(…)`, incl. the GoTrue writes | statement scan | 87 |
   | `helper` — bare awaited call to a function returning `Promise<{ error … }>` | return-type annotations, then call sites | 3 (`routes/auth.ts:525`, `:559` → `signOutUserGlobally`, #110; `routes/marketplace/orders.ts:339` → `updateOrderFieldsAsParty`, #111) |
   | `chain` — a write chain parked in a variable, awaited through an expression | identifiers assigned a write chain (functions excluded), then bare awaits naming them | **0** — #111 moved the one R2 found behind `updateOrderFieldsAsParty`, where it reads as `helper`; the detector stays, with a fixture |
   | `unread` — destructured, `error` never read in the enclosing scope or never bound | brace-counted scope walk | **0** |

   The true floor is **90 in 30 files**, of which this PR fixes 3 (baseline: 87). `unread` being zero is a
   real finding, not a dead detector — this codebase checks when it destructures; the three
   apparent hits before comment-blanking were the bug above. Two `.then` spellings go
   opposite ways: `data/boardActions.ts:780` ends in `.then(({ error }) => …)`, a real
   check, while `marketplaceOrders.ts:741` ends in `.then(undefined, handler)`, whose
   rejection handler can never fire.

3. Not table writes, counted separately: bare `.rpc(…)` — 2 (`data/adminAnalytics.ts:35`,
   `idempotency.ts:199`); bare `.storage…remove(…)` — 3 in `data/uploads.ts` (365, 796,
   863), all inside a `catch` that can never fire. `adminData.ts:154 signOutEverywhere` is
   the `helper` shape with no return-type annotation, so the guard cannot see it;
   `adminData.ts:107 setAuthBan` is the correct pattern and the model for all of them.

**What the guard cannot catch** — the number is a FLOOR. It misses a write reached through a
value the scan cannot type (an unannotated helper, one typed through an alias or interface
method, a chain passed as an argument); a promise returned, stored and awaited by a caller
that ignores it; `Promise.all([...writes])`, whose elements are not statements; and an
`error` "read" only in dead code. A shape found later becomes a detector and RAISES the
baseline in the same commit — expected, not a regression.

## The money sites — `services/marketplacePayments.ts` (27)

**MS** = must-succeed (stop, typed error) · **BE** = best-effort (read, warn, continue) ·
**CR** = compensate/reconcile (an external side effect already happened). Idempotency is
answered per webhook site, because Paystack retries a non-2xx.

| ln | function | write | what happens next | class + action |
|---|---|---|---|---|
| 346 | `createBuyNowCheckoutSession` | orders ← `payment_id`, `awaiting_payment` | Paystack init | **MS**. Nothing external yet; throw. Leaves the payment row inserted → see "the orphan payment row" below. |
| 364 | same | payments ← `paystack_access_code`, `metadata.authorizationUrl` | response returned | **BE**. The session is live and the response already carries the URL; only *resume* degrades (a fresh session is minted instead). Throwing here would strand a live charge. |
| 453 | `createCheckoutCharge` | checkouts ← `payment_id` | Paystack init | **BE**. `checkouts.payment_id` is a display mirror: fulfilment walks `payments.checkout_id` → orders. (The issue frames this as must-succeed; it is not.) |
| 458 | same | orders ← `payment_id`, `awaiting_payment` (`.in`) | Paystack init | **MS**. `createFromCart` already cancels the orders and fails the checkout on a throw. |
| 478 | same | payments ← access code | response | **BE**, as 364. |
| 550 | `createAwaitingPaymentBuyNowOrder` | orders ← `awaiting_payment` | order re-read, charge created | **BE**. The RPC creates it `pending_payment`, and every downstream reader accepts both spellings. Throwing would strand RPC-held stock. |
| 652 | `createCheckoutForExistingOrder` | payments ← `failed` + superseded marker | new payment row inserted | **MS**. Retiring the stale row *before* a replacement exists is the stated invariant: a late `charge.success` on the old split must not settle. |
| 702 | same | orders ← `payment_id`, `awaiting_payment` | Paystack init | **MS**, as 346. |
| 720 | same | payments ← access code | response | **BE**, as 364. |
| 901 | `markPaymentPaid` | checkouts ← `status: paid` | fulfilment | **BE**. Display mirror only (`getCheckout`); no money decision reads it. |
| 937 | `fulfillOrdersForPayment` | cart_items ← delete | fulfilment loop | **BE**. A stale cart row annoys; it corrupts nothing. |
| 961 | same | orders ← `status: paid`, `payment_id` | `stampOrderPaidAt`, digital delivery, notifications | **CR → 5xx**. Webhook-driven and authoritative. **Idempotent: yes** — two-phase dedupe stamps `processed_at` only after processing returns, and each order is re-selected by its own unfulfilled status. Throw so Paystack retries. |
| 1391 | `transferSellerPayout` (single-order) | payments ← real `payout_transfer_code` | maybe `markPaymentPaidOut` | **CR, never throw**. Money has moved. The cart branch's twin (1298) already checks and logs; this one was missed. Log at error + keep the claim marker so `transfer.success` can still be reconciled by reference. |
| 1409 | same, catch-block rollback | payments ← `paid`, clear claim | rethrows the transfer error | **CR**. A failed rollback wedges the row at `payout_pending` forever: the seller is never paid and the buyer's refund is refused. Log at error, still rethrow the original. |
| 1436 | `releaseOrderPayoutClaim` | orders ← `payout_status: pending` | returns | **BE (error level)**. Its `try/catch` is dead code today. Same wedge as 1409, on the order row. |
| 1464 | `finalizeOrderPayout` | orders ← `payout_status: paid_out` | roll-up to the payment row | **CR**. Webhook path: **idempotent yes** (CAS on `in('paying','pending')`), so throwing for a retry is right there — but it is *also* called inline right after a successful transfer, where a throw would 500 a buyer's confirm-received. Needs the inline caller to catch. |
| 1602 | `markPaymentPaidOut` | payments ← `paid_out` | returns | **CR**, exactly as 1464 and via the same two callers. |
| 1663 | `refundPaymentForOrder` (initialized) | payments ← `failed` | returns | **MS**. Nothing was captured, so throwing is free — and leaving the row `initialized` lets a late `charge.success` settle a cancelled order. |
| 1749 | same, refund catch rollback | payments ← `paid` | rethrows | **CR**, as 1409: a wedge at `refunding` blocks every later refund *and* the payout. |
| 1769 | same, refund success | payments ← `refunded` + `refund_reference` | order hold released | **CR**. Paystack has already returned the money. Throwing 500s a buyer who *was* refunded and the retry is then refused. Log at error + Sentry reconciliation marker, do not throw. **Needs an ops decision** (alert? reconciliation job?). |
| 1783 | same, sibling still open | payments ← back to `paid` | order hold released | **CR**, as 1769. |
| 1794 | same | orders ← `payout_status: skipped` | returns | **BE (error level)**. Failure leaves `refund_hold`, which *blocks* payout — the safe direction — but is never released. |
| 1825 | `releaseRefundHold` | orders ← `payout_status: pending` | returns | **BE (error level)**. Dead `try/catch` today. |
| 1937 | `recordSettlementMismatch` | payments ← `metadata.settlement_mismatch` | returns | **BE (error level)**. Sentry already fired; this stamp is the durable half of the only trace that funds were captured without settling. |
| 2011 | `handleWebhook` | webhook_events ← `processed_at` | 200 to Paystack | **BE**. An unstamped claim makes the next retry re-process, which the design guarantees is safe; the cost is unbounded re-processing, not corruption. Warn + Sentry. |
| 2141 | `processWebhookEvent` (transfer.failed/reversed) | orders ← unwind, fallback without `payout_attempt` | continues | **CR → 5xx**. The primary at 2120 is checked; this fallback is not, so returned money keeps reading `paid_out`. **Idempotent: yes** — the CAS is `in('paying','paid_out')`, so a replay after success matches nothing and cannot double-bump the attempt. |
| 2194 | same | payments ← payout reset fallback | ends | **CR → 5xx**, same shape, same CAS (`in('payout_pending','paid_out')`). |

## The money sites — `services/marketplaceOrders.ts` (9)

| ln | function | write | what happens next | class + action |
|---|---|---|---|---|
| 328 | `voidOrphanPendingTransaction` | transactions ← delete | returns | **BE**. *It has no caller* — dead private method. Propose deleting it in the orders PR rather than hardening it. |
| 685 | `updateOrderStatus` (`confirm_received`) | orders ← `buyer_confirmed_at` | returns into `payoutOnConfirmReceived` | **MS**. Nothing external yet, and the payout that follows is the money step. |
| 741 | same (cancel side-effect failed) | orders ← `cancellation_note` | rethrows | **BE**. Note the second bug here: the `.then(undefined, handler)` rejection handler can never fire either, for the same reason. |
| 768 | same (dispute) | transactions ← `disputed` | order patch follows | **BE**. Ledger mirror; the order row is authoritative. |
| 922 | `finalizeEscrowRelease` | inquiries ← `purchased` | returns | **BE**. Already documented as best-effort; its `catch` is dead. |
| 989 | `refundEscrow` | transactions ← `refunded` | returns | **BE (error level)**. Mirror, but a stale `held` row misreports both sides' Budget. |
| 1018 | `restoreListingAfterCancelledOrder` | listings ← quantity + status | cache bust | **CR**. Called *after* a cancel/refund has happened (733, 1677), so it must not throw: stock silently lost from a listing needs an alert, not a rollback. |
| 1020 | same (unique-listing branch) | listings ← `active` | cache bust | **CR**, as 1018. |
| 1604 | `resolveDisputeAsAdmin` | orders ← dispute outcome | status moves | **BE**. Dead `catch`; the trust score counts disputes lost, so a miss punishes a seller who won. |

## The orphan payment row (decision for 346 / 702, the pilot)

When the order-link write fails, a `marketplace_payments` row already exists at
`initialized` with a reference no Paystack session was ever opened for. It is **left as is**
and the request fails: `initialized` already means "no money captured", nothing can settle a
reference with no charge behind it, both `refundPaymentForOrder` and
`createCheckoutForExistingOrder` already handle an `initialized` row, and flipping it to
`failed` would be a second write on the same failing path. No existing status means
"abandoned before a session existed" and this lane does not invent a migration — a
`metadata` marker is proposed for a later PR if reconciliation ever needs to tell them apart.

## The other files — count and a one-line class guess each (later PRs)

`jobsBoard` 8 BE (denorm counters) · `studyPackFactory` 4 BE (job progress) · `communities`
3 BE (member counters) · `marketplaceAddresses` 3 **MS** (a lost default-address flip ships
to the wrong address) · `marketplaceStudyPacks` 3 and `marketplaceQuestionBanks` 2 mixed
(entitlement grants are **MS**) · `referrals` 3 BE (attribution; money-adjacent, audit
first) · `marketplaceCheckout` 2 **MS** (the `failed` stamp in the rollback catch) ·
`challengeService` / `marketplaceAlerts` / `studyPresence` / `studyRooms` / `studySets` 2
each BE · `adminAudit` 1 **MS** (an audit log that can vanish is not one) · `apiKey` 1 **MS**
(revocation) · `idempotency` 1 **MS** (key release) · `queue/processors`,
`companionConversations`, `creators`, `data/categories`, `data/directMessages`,
`data/marketplace`, `data/readState`, `jobAlerts`, `marketplaceFavoriteMilestones`,
`marketplaceSellerTools` 1 each BE. Plus the two non-bare shapes, both in routes and both
already marked `KNOWN ISSUE` and both the `helper` shape: `routes/auth.ts` 2
(`signOutUserGlobally`, **BE** — the session cutoff written first is what actually revokes,
so this is a reporting gap, not an integrity one) and `routes/marketplace/orders.ts` 1
(`updateOrderFieldsAsParty`, **MS** — the handler answers success for a meeting point and
note that may have saved nothing).

## Decisions (2026-09-17)

Founder decisions on the questions Phase A raised. The classification above stands.

1. **A write that fails after the money already moved** — the `refunded` stamp once Paystack
   has paid the refund out, the sibling-open release back to `paid`, the post-transfer
   `payout_transfer_code` stamp. **Do not throw.** Answer the user truthfully (the money did
   move) and record an ERROR-level event through the logger and Sentry with a STABLE
   fingerprint, `money-moved-write-failed:<table>:<op>`, tagged with the order and payment
   ids. Ids only; amounts are fine, addresses and tokens are not. **No paging alert.**
   A third helper, `reconcileLaterWrite(result, context)`, exists so the three classes are
   visible at their call sites. A reconciliation job that re-stamps the rows these events
   name is filed as a follow-up and is NOT built in this lane.
2. **The orphan `initialized` payment row** after a failed link: leave it, as the pilot does.
   #113 notes that reconciliation may later want a `metadata` marker to tell an abandoned
   row from an open one.
3. **The sites that are right to throw on the webhook path but are also called inline after
   a successful transfer** (`finalizeOrderPayout`, `markPaymentPaidOut`): in Phase B the
   inline callers CATCH and route to `reconcileLaterWrite` semantics, while the webhook path
   keeps the throw so Paystack retries. Both callers get a test, per site.
4. **`voidOrphanPendingTransaction`** has no caller: delete it in the orders PR, in its own
   commit, after a grep over code and tests proves it.
5. **The never-firing `.then(undefined, handler)`** at `marketplaceOrders.ts:741`: fixed in
   the orders PR, test-first like the rest.

## Order of work

A (#112, merged): helpers + ratchet + the buy-now pilot — 3 sites. B PR 1 (this one): the
rest of `services/marketplacePayments.ts` — 24 sites, so that file is now at ZERO and the
baseline is 87 → 63. B PR 2 (done): `marketplaceOrders.ts` — 8 fixed and the dead
`voidOrphanPendingTransaction` deleted, plus the `updateOrderFieldsAsParty` call site in
`routes/marketplace/orders.ts` that #111 marked; baseline 63 → 53. Both money services are
now at ZERO. B PR 3 (done): the must-succeed stragglers — `adminAudit`, `apiKey`, `idempotency`,
`marketplaceAddresses`, `marketplaceCheckout`, `marketplaceStudyPacks`,
`marketplaceQuestionBanks`; baseline 53 → 40. Only TWO of the thirteen turned out to be
must-succeed (the default-address flip); the rest are must-be-SEEN. Then the rest by domain,
best-effort sites batched. Each PR re-freezes the ratchet baseline
downward in its own commit, with the before and after counts in the PR body.


## Closing (2026-09-17) — #108 is finished

The ratchet's baseline is **0**. Every discarded write error the scan can see is
gone, across eight pull requests: #112 (helpers, ratchet, buy-now pilot), #114
(`marketplacePayments.ts`), #115 (`marketplaceOrders.ts` + the order-fields
route), #116 (the must-succeed stragglers), #118 (jobs), #119 (study) and this
one (community and misc).

### Final counts by class

Counted by walking the tree for helper calls, not from memory:

| class | call sites | what it does |
|---|---:|---|
| **must-succeed** (`mustWrite`) | 16 | throws a typed `WriteFailedError`; nothing external has happened yet |
| **best-effort, error level** (`bestEffortWrite(…, 'error')`) | 25 | request succeeds; a person may need to repair something |
| **best-effort, warn level** (`bestEffortWrite`) | 39 | request succeeds; self-healing or cosmetic |
| **reconcile-later** (`reconcileLaterWrite`) | 11 | money or an external effect already happened; never throws |
| **deleted** | 1 | `voidOrphanPendingTransaction`, which had no caller |
| total | 92 | |

That is 91 helper calls for 89 fixed writes plus one deletion: two writes carry
TWO call sites each, because `finalizeOrderPayout` and `markPaymentPaidOut`
take a mode — `mustWrite` when a `transfer.success` webhook drives them (so
Paystack retries) and `reconcileLaterWrite` when the inline caller does (so a
buyer's confirm-received is not 500'd for a payout that worked).

Nineteen dead `try/catch` blocks were found along the way — code that logged a
failure it could never observe, because a failed supabase-js write resolves.
Two writes changed their ANSWER, not just their logging: `ensureCode` returns
null instead of a referral code the profile does not carry, and
`PATCH /orders/:id` refuses instead of reporting success for fields that did not
save.

### Sentry fingerprints, and what to do when one fires

Every one of these means the request SUCCEEDED and a row did not.

| fingerprint | what happened | what to do |
|---|---|---|
| `money-moved-write-failed:<table>:<op>` | Paystack moved money — a refund paid, a transfer sent — and the row recording it did not update | reconcile that payment/order against Paystack; #113 tracks the job that should do this automatically |
| `audit-log-write-failed` | an admin action happened and its audit row did not | recover the action from the admin's own logs; a compliance gap, not an outage |
| `idempotency-failure-marker-write-failed` | a failed handler's key is stuck at `__processing__` and will answer 409 forever | tell the user to retry with a new key (most clients derive one); clear the row if it recurs |
| `orphaned-listing-cleanup-failed` | a marketplace listing exists whose study pack or question bank does not — it is PURCHASABLE | take the listing down by hand, urgently |
| `jobs-application-row-write-failed` | someone applied through an external link and no application row exists | tell the employer; the candidate must re-apply |
| `jobs-pipeline-stamp-write-failed` | an interview, offer or hire happened and the candidate's stage did not move | set the stage by hand |
| `jobs-company-owner-membership-write-failed` | a company exists with nobody named its owner | insert the owner membership by hand |
| `studypack-draft-job-link-failed` | a paid draft does not name its job | find it by user and draft id; refund if it never ran |
| `studypack-draft-status-write-failed` | a draft is stuck at `generating`, or a generated pack never became `ready` | credits were spent — resolve the draft or refund |
| `community-membership-write-failed` | a community exists whose creator is not a member or admin of it | insert the admin membership by hand |
| `referral-code-write-failed` | a referral code was minted and not stored; the user was given nothing | none needed — the next request mints and stores another |
| `creator-verification-write-failed` | a creator earned a verification level the profile does not record | re-run the check, or set the level by hand |
| `dm-thread-state-write-failed` | a DM was sent and the thread's preview and REQUEST state did not update | check whether a message request is missing for the recipient |
| `companion-transcript-write-failed` | an AI companion turn is missing from the transcript | nothing to repair; the student may re-ask |
| `gotrue-signout-failed` *(warn, no fingerprint)* | the GoTrue global sign-out failed | nothing: `setUserSessionCutoff` runs FIRST and is what revokes the tokens |

### What the guard still cannot see

The ratchet is a floor, not a proof. It reads text, so these shapes pass it:

- **A write behind a value it cannot type.** It knows a helper resolves with
  `{ error }` only from that helper's own `: Promise<{ error … }>` annotation.
  An unannotated helper, one typed through an alias, an interface method, or a
  generic wrapper is invisible — and so is every caller of it.
- **A promise that leaves the function.** Returned, stored in a variable or an
  array, or passed as an argument and awaited somewhere else. The `chain`
  detector catches only the one-file version of this.
- **`Promise.all([...writes])` and friends.** The elements are expressions, not
  statements, so no element is a bare awaited statement.
- **A `void`-ed or floating write.** `void db.from(…).update(…)` and a write
  with no `await` at all are not awaited statements; the latter is a different
  bug (an unhandled rejection) that this guard was never aimed at.
- **An `error` that is read but not acted on.** `const { error } = await …;`
  followed by `if (error) { /* TODO */ }` counts as checked.
- **An `error` read only in dead code**, or read in a nested closure the brace
  walk mis-bounds.
- **Anything outside the scan.** Only `routes`, `services`, `middleware`,
  `queue` and `utils` under `apps/api-server/src`, and never a `.test.ts`. The
  web and mobile apps are not scanned at all.

The honest summary: this lane fixed every discarded write error of the shapes a
static scan can find, and the guard stops those shapes coming back. A discarded
write reached through an abstraction the scan cannot follow would still ship
silently, and the only defence against that one is the convention — read the
`error`, and say which of the three things you mean.
