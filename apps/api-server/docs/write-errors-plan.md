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
   | `helper` — bare awaited call to a function returning `Promise<{ error … }>` | return-type annotations, then call sites | 2 (`routes/auth.ts:525`, `:559` → `signOutUserGlobally`, #110) |
   | `chain` — a write chain parked in a variable, awaited through an expression | identifiers assigned a write chain (functions excluded), then bare awaits naming them | 1 (`routes/marketplace/orders.ts:336`, #111) |
   | `unread` — destructured, `error` never read in the enclosing scope or never bound | brace-counted scope walk | **0** |

   The true floor is **90 in 30 files**, of which this PR fixes 3. `unread` being zero is a
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
already marked `KNOWN ISSUE`: `routes/auth.ts` 2 (`signOutUserGlobally`, **BE** — the
session cutoff written first is what actually revokes, so this is a reporting gap, not an
integrity one) and `routes/marketplace/orders.ts` 1 (`updateOrderFieldsAsParty`, **MS** —
the handler answers success for a meeting point and note that may have saved nothing).

## Order of work

A (this PR): helpers + ratchet + the buy-now pilot. B: the rest of `marketplacePayments.ts`,
then `marketplaceOrders.ts`, one PR per file, every write test-first. Then the rest by
domain, best-effort sites batched.
