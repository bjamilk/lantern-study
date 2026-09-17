# Marketplace money reconciliation (#113) — design

`reconcileLaterWrite` (`services/data/writeResult.ts`, decided in #108) exists for the writes
that fail AFTER Paystack has moved money: throwing would tell a buyer their refund failed when
it did not, and on a webhook path a retry could move money twice. The price is a row that
disagrees with the money, and today a Sentry event is the only record. This job is what puts
the row right.

**Three rules it is built on.**

1. The source of truth for what happened to the money is **PAYSTACK**, asked by reference.
   Never our own row, never a Sentry event — the events are the cross-check that the queries
   find the right rows, not the input.
2. A repair re-applies the **ORIGINAL write with the ORIGINAL compare-and-swap filters**, so a
   replay against a row that moved on is a no-op. It goes through `mustWrite` and writes an
   admin audit row naming the job as the actor.
3. A repair **never calls Paystack to move money**. No transfer, no refund, no charge. It reads
   Paystack and corrects our record, or releases a claim Paystack proves is backing nothing.

## Candidate classes

Candidates are found BY STATE, in the tables (`services/data/marketplaceReconcile.ts`), never by
parsing Sentry. Ages are measured on `updated_at` for the claim states (the claim write itself
bumps it; `marketplace_orders` has a trigger, the payments writes set it explicitly) and on
`created_at` for the two `initialized` classes, which are never updated before settlement.

| # | state signature | originating failure (the `reconcileLaterWrite` site) | what Paystack decides it | repair write + CAS filter | left to a person |
|---|---|---|---|---|---|
| 1 | `payments.status = 'refunding'`, single order, > 60 min | the `refunded` + `refund_reference` stamp, `marketplacePayments.ts:2017` | `GET /refund?transaction=` → an accepted refund exists | `update {status:'refunded', refund_reference}` WHERE `id` AND `status='refunding'` | >1 accepted refund on one charge |
| 2 | same, cart (`checkout_id` set), ≥2 siblings still open | the sibling-open release back to `paid`, `:2046` | same | `update {status:'paid'}` WHERE `id` AND `status='refunding'` | a cart with <2 open siblings: the refund cannot be attributed to one order |
| 3 | `payments.status = 'refunding'`, > 60 min | the refund rollback, `:1983` | `GET /refund?transaction=` → **no** accepted refund | `update {status:'paid'}` WHERE `id` AND `status='refunding'` | — |
| 4 | `orders.payout_status = 'refund_hold'`, > 60 min, single-order payment | the `skipped` stamp, `:2071` | an accepted refund exists | `update {payout_status:'skipped', payout_failed_reason:'refunded'}` WHERE `id` AND `payout_status='refund_hold'` | a cart charge: which order was refunded is not readable |
| 5 | same, no accepted refund | `releaseRefundHold`, `:2119` | no refund | `update {payout_status:'pending'}` WHERE `id` AND `payout_status='refund_hold'` | — |
| 6 | `orders.payout_status = 'paying'`, no transfer code, > 60 min | `releaseOrderPayoutClaim`, `:1629` | `GET /transfer/verify/:ref` → 404 | `update {payout_status:'pending', payout_failed_reason}` WHERE `id` AND `payout_status='paying'` | a REAL transfer code is stamped and Paystack has no such transfer |
| 7 | `orders.payout_status = 'paying'`, > 60 min | `finalizeOrderPayout`, `:1672` | transfer `success` | `update {payout_status:'paid_out', payout_failed_reason:null}` WHERE `id` AND `payout_status IN ('paying','pending')` | — (the payment roll-up settles on a later run) |
| 8 | `payments.status = 'payout_pending'`, code still `claim:<ref>`, > 60 min | the payout rollback, `:1581` | transfer 404 | `update {status:'paid', payout_transfer_code:null}` WHERE `id` AND `status='payout_pending'` AND `payout_transfer_code='claim:<ref>'` | — |
| 9 | same, transfer exists | the post-transfer code stamp, `:1546` | transfer found (any status) | `update {payout_transfer_code}` WHERE `id` AND `payout_transfer_code='claim:<ref>'` | — |
| 10 | `payments.status = 'payout_pending'`, > 60 min | `markPaymentPaidOut`, `:1825` | transfer `success` | `update {status:'paid_out', payout_at}` WHERE `id` AND `status IN ('payout_pending','paid')` | — |
| 11 | `payments.status = 'initialized'` with an order, > 3 h | no write failed: the `charge.success` webhook never landed | `GET /transaction/verify` → `success` | **none** | all of it: settlement grants entitlements, delivers digital goods and splits fees |
| 12 | `payments.status = 'initialized'`, no order and no checkout, > 24 h | the order → payment link, left deliberately by #112 | not asked (no session was ever opened) | **none** | counted only |
| 13 | any candidate whose Paystack fact contradicts a row in the money-losing direction | — | any | **none** (`needs-human`) | all of it |
| 14 | any candidate Paystack could not be read for | — | — | **none** (`paystack-unreachable`) | re-run later |

Class 13 is the rule, not a query: where our row says the seller was paid and Paystack says the
transfer failed, does not exist, or is still pending, the job proposes nothing. Unwinding a
payout burns a `payout_attempt` and belongs to the `transfer.failed` webhook.

**Deliberately not covered.** The `reconcileLaterWrite` sites in `marketplaceOrders.ts` (listing
stock not restored after a cancellation) and `referrals.ts`: no Paystack fact decides them, so
they are a different job. Nothing in this job changes the #108 classification, and nothing here
pages.

## Thresholds, and why

| threshold | value | why it must be at least this |
|---|---|---|
| claim staleness (classes 1–10) | **60 min** | The four claim states are held only across ONE Paystack call inside ONE HTTP request. When that request ends — returned, thrown, or the process died — the claim was either released or never will be: no webhook is coming, because no transfer or refund exists to fire one, and nothing sweeps these slots. 60 min is an order of magnitude past the request budget and past any retry burst. |
| transfer still pending | **72 h** | An ACCEPTED transfer may legitimately sit `pending` at Paystack for days (bank queues, weekends). It is not a stuck claim and is never treated as one; past 72 h it becomes a `needs-human`, not a repair. |
| settlement (class 11) | **3 h** | Past Paystack's own webhook retries and past a buyer returning through the verify route. |
| orphan (class 12) | **24 h** | Long enough that no open checkout page is being called abandoned. |

## How it runs

**Step 1 (this PR): report-only, on demand.** `GET /api/v1/admin/marketplace/reconcile/findings`,
behind the existing admin stack (`authMiddleware` → `requirePlatformAdmin` → `adminRateLimit`),
audited as `marketplace_reconcile_view` BEFORE the scan runs. The planner
(`services/marketplaceReconcile.ts`) is a pure function of (queries, Paystack reader, clock) and
writes nothing.

**Rate limiting and caps.** Each candidate costs one or two Paystack `GET`s. Every query is
capped per class (default 25, settlement 10, clamped to 100) and ordered oldest-first, and the
Paystack calls are issued sequentially, so one run's worst case is a bounded, serial burst. A run
that hits a cap sets `truncated`, so a short list is never mistaken for a healthy platform.

**Step 2 (Phase B).** Manual repairs only — see the decisions below. No cron.

**Failure handling.** Paystack unreachable → the candidate is reported as `paystack-unreachable`
and skipped; nothing is guessed and nothing is written. A failed candidate query is reported in
`queryErrors` rather than answered as "no findings". A repair that fails is reported at error
level with the `money-moved-write-failed` fingerprint family and retried on the next run, because
it is a no-op if the state moved on.

**Logging.** Ids, state names and kobo amounts only — no email, no address, no token, no payload,
exactly as `writeResult.ts` requires. The planner's own output is pinned to that rule by a test.

## What this job deliberately does NOT do

- It never initiates a transfer, a refund or a charge. The reader interface has no way to.
- It never settles a captured charge (class 11): settlement grants entitlements and delivers
  goods, and that is a person running the settlement path knowingly.
- It never unwinds a failed or reversed transfer: that burns a `payout_attempt` and is the
  `transfer.failed` webhook's job.
- It never invents a status. The orphan `initialized` row keeps the shape #112 left it in; the
  `metadata` marker #113 floated is not needed, because "no order, no checkout, older than a day"
  already identifies it without a migration.
- It never guesses which order of a cart a refund belonged to.
- It does not page, and it does not change the #108 throw/report classification.

## Decisions (2026-09-17)

Founder decisions on Phase A. Phase A (the report-only planner and the admin findings
endpoint) is approved as built; these settle what Phase B is.

**1. Phase B is MANUAL REPAIRS FIRST. There is no cron in it.** A repeatable job is a later,
separate PR per class, once manual repairs have run cleanly on that class. Phase B is:

- a repair per safe class, each behind its own env flag `MARKETPLACE_RECONCILE_REPAIR_<CLASS>`,
  **defaulting OFF**;
- `POST /api/v1/admin/marketplace/reconcile/apply`, which applies exactly ONE named finding.
  The client sends only the finding's IDENTITY — the class and the order or payment id — and
  never a finding payload: the endpoint **re-plans that finding at apply time**, re-reading our
  rows and re-asking Paystack, and refuses if the finding no longer holds, if its class flag is
  off, or if Paystack cannot be read. It takes the typed-confirmation the role-change route
  requires;
- the write goes through `mustWrite` with the ORIGINAL CAS filters, so a second apply of the
  same finding is a no-op, and the response says so rather than reporting a repair that did not
  happen;
- every apply writes an `admin_audit_log` row (`marketplace_reconcile_repair`, actor = the
  admin, not the job) carrying the before and after values and the Paystack reference. Ids,
  state names and kobo amounts only.

**2. Cart refunds are ALWAYS `needs-human` in the first repairing version.** Class 2 gets NO
repair, the "≥2 siblings still open" case included. Repairs exist for classes **1, 3, 4, 5, 6,
7, 8, 9, 10**; classes **2, 11, 12, 13, 14** stay report-only. Wherever one payment row can
cover several orders, the repair is restricted to SINGLE-ORDER, and this is how each class
tells them apart:

| class | the rows it writes | single-order test |
|---|---|---|
| 1, 3 | the payment row | `marketplace_payments.checkout_id IS NULL`. A cart charge is one row over many orders, so a refund on it cannot be attributed. |
| 4, 5 | the order's own `payout_status` | the order's payment: `payments.checkout_id IS NULL`, read through `orders.payment_id`. The order row is per-order, but the REFUND that decides the direction lives on the shared charge. |
| 6, 7 | the order's own `payout_status` | none needed, and none is applied. These are the unified-checkout per-order payout claims: each order holds its OWN claim and its own deterministic transfer reference, so nothing is shared and nothing is ambiguous. The roll-up to the shared payment row is deliberately excluded from both repairs — a later run's class 10 settles it. |
| 8, 9, 10 | the payment row's payout state | `marketplace_payments.checkout_id IS NULL`. The payment-row payout claim exists only for the single-order shape; a cart's payout state lives on the orders. Class 10 can also settle a cart parent row, and is restricted for that reason. |

Class 5's cart case (no refund accepted for the WHOLE charge, so no order was refunded) is
unambiguous and may be worth promoting later. It is NOT in this version; it needs its own
decision.

**3. The claim-release rule.** A claim is released only on a POSITIVE Paystack answer — a 404
for the transfer reference, or no accepted refund for the charge — AND only while the row still
holds its claim: the `claim:<reference>` marker on a payment, or no `payout_transfer_code` on an
order. A 5xx, a timeout, an unreachable host, or a real transfer code already stamped never
releases anything.
