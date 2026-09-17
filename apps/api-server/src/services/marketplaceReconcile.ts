/**
 * Marketplace money reconciliation, step 1: FIND the wedged rows (#113).
 *
 * ## Purpose
 *
 * `reconcileLaterWrite` (see `data/writeResult.ts`) exists because a write that
 * fails AFTER Paystack has moved money must not throw — telling a buyer their
 * refund failed when it did not is a lie, and on a webhook path a retry can
 * move money twice. The cost of that decision is that the row is left
 * disagreeing with the money, and today a Sentry event is the only record.
 *
 * This module is the planner that closes the gap. It is REPORT-ONLY and it is a
 * pure function of (queries, Paystack reader, clock):
 *
 *   - it finds candidates BY STATE, from `data/marketplaceReconcile.ts`;
 *   - it asks PAYSTACK, by reference, what actually happened — never our own
 *     row, never a Sentry event (those are the cross-check that these queries
 *     find the right rows, not the input);
 *   - it returns a typed list of findings, each naming the ORIGINAL write and
 *     the ORIGINAL compare-and-swap filters that would repair it.
 *
 * It WRITES NOTHING, and it asks Paystack for nothing that moves money: no
 * transfer, no refund, no charge. Only `GET`s. Phase B adds the repairs, behind
 * an env flag and an admin action, per class; the repairs re-apply the original
 * write through `mustWrite` with the original CAS filters, so a replay against
 * a row that has moved on is a no-op.
 *
 * ## What it touches
 *
 * Nothing directly. The queries arrive as `ReconcileQueries` (satisfied by
 * `dataLayer.marketplaceReconcile`) and Paystack arrives as
 * `PaystackReconcileReader`, which is a real client in production and a fake in
 * every test. No test in this repo may reach the live Paystack API.
 *
 * ## The rules this file is built on
 *
 * 1. **Paystack decides.** A finding exists only where a Paystack fact
 *    contradicts a row. Where Paystack cannot be reached, the candidate is
 *    reported as `paystack-unreachable` and NOTHING is proposed — a guess about
 *    money is worse than a gap.
 * 2. **The dangerous direction is never repaired.** Where our row claims the
 *    money moved and Paystack says it did not (a `paid_out` row over a failed
 *    transfer, a `refunded` row with no refund), the class is `needs-human`
 *    with no proposed repair. Unwinding a payout is the `transfer.failed`
 *    webhook's job, with its `payout_attempt` counter; this job must never do
 *    it.
 * 3. **Ambiguity is a finding, not a coin toss.** A cart's refund cannot always
 *    be attributed to one of its orders. Where it cannot, the planner says so
 *    instead of picking.
 *
 * ## Gotcha
 *
 * Age is read from `updated_at` (see the data module for why), and every
 * threshold below must EXCEED the longest legitimate in-flight window for the
 * state it guards. The claim states are held only across a single Paystack call
 * inside one HTTP request; a transfer, by contrast, may sit `pending` at
 * Paystack for days, which is why a real transfer code is never treated as a
 * stuck claim.
 */
import {
  fetchPaystackTransferByReference,
  isPaystackNotFound,
  listPaystackRefundsForTransaction,
  verifyPaystackTransaction,
} from './paystack';
import { orderPayoutReference } from './marketplacePayments';
import type {
  ReconcileOrderRow,
  ReconcilePaymentRow,
} from './data/marketplaceReconcile';

// --- The ports ---------------------------------------------------------------

/** One Paystack transfer, as the planner needs it. */
export type ReaderTransfer = {
  found: boolean;
  /** Paystack's own transfer status; null when `found` is false. */
  status: string | null;
  transferCode: string | null;
  amountKobo: number | null;
};

/** One refund Paystack holds against a charge. */
export type ReaderRefund = {
  id: string;
  status: string;
  amountKobo: number | null;
};

/** One charge, as the planner needs it. */
export type ReaderCharge = {
  found: boolean;
  status: string | null;
  amountKobo: number | null;
};

/**
 * Everything the planner may ask Paystack. READS ONLY — there is deliberately
 * no way through this interface to initiate a transfer or a refund.
 *
 * An implementation THROWS when Paystack cannot be reached, and answers
 * `{found: false}` / `[]` when Paystack positively says there is no such
 * object. The planner treats those two as opposite facts.
 */
export type PaystackReconcileReader = {
  getTransferByReference(reference: string): Promise<ReaderTransfer>;
  listRefundsForTransaction(transactionIdOrReference: string): Promise<ReaderRefund[]>;
  verifyCharge(reference: string): Promise<ReaderCharge>;
};

/**
 * The production reader, over the real Paystack client. Three `GET`s and
 * nothing else.
 *
 * The one piece of judgement in it: Paystack answering 404 is the FACT "there
 * is no such transfer / charge", which becomes `{found: false}`; every other
 * failure — a 500, a timeout, an unreachable host — is rethrown, so the planner
 * reports `paystack-unreachable` rather than treating "we do not know" as "it
 * did not happen".
 *
 * No test may construct this: tests pass a fake reader, because a test must
 * never touch the live Paystack API.
 */
export function createPaystackReconcileReader(): PaystackReconcileReader {
  return {
    async getTransferByReference(reference) {
      try {
        const transfer = await fetchPaystackTransferByReference(reference);
        return {
          found: true,
          status: transfer.status,
          transferCode: transfer.transferCode,
          amountKobo: transfer.amountKobo,
        };
      } catch (err) {
        if (isPaystackNotFound(err)) {
          return { found: false, status: null, transferCode: null, amountKobo: null };
        }
        throw err;
      }
    },
    async listRefundsForTransaction(transactionIdOrReference) {
      return listPaystackRefundsForTransaction(transactionIdOrReference);
    },
    async verifyCharge(reference) {
      try {
        const charge = await verifyPaystackTransaction(reference);
        return { found: true, status: charge.status, amountKobo: charge.amount ?? null };
      } catch (err) {
        if (isPaystackNotFound(err)) return { found: false, status: null, amountKobo: null };
        throw err;
      }
    },
  };
}

type Window = { olderThanIso: string; limit: number };
type Read<T> = Promise<{ data: T | null; error: unknown }>;

/**
 * The queries the planner runs. Structurally satisfied by
 * `dataLayer.marketplaceReconcile`, so the composition root binds the client
 * and a test passes plain functions.
 */
export type ReconcileQueries = {
  listStuckRefundingPayments(w: Window): Read<ReconcilePaymentRow[]>;
  listStuckPayoutPendingPayments(w: Window): Read<ReconcilePaymentRow[]>;
  listOrphanInitializedPayments(w: Window): Read<ReconcilePaymentRow[]>;
  listUnsettledInitializedPayments(w: Window): Read<ReconcilePaymentRow[]>;
  listStuckPayingOrders(w: Window): Read<ReconcileOrderRow[]>;
  listStuckRefundHoldOrders(w: Window): Read<ReconcileOrderRow[]>;
  getPaymentForReconcile(paymentId: string): Read<ReconcilePaymentRow>;
  listCheckoutSiblingOrders(
    checkoutId: string,
  ): Read<Array<{ id: string; status: string; payout_status: string }>>;
};

// --- The findings ------------------------------------------------------------

export type ReconcileFindingClass =
  /** Paystack refunded the buyer; the payment still says `refunding`. */
  | 'refund-paid-not-stamped'
  /** A cart refund went through; the shared payment row was never released. */
  | 'refund-claim-sibling-open'
  /** The payment holds the refund claim and Paystack has no refund at all. */
  | 'refund-claim-not-backed'
  /** The order holds `refund_hold` and the buyer was refunded. */
  | 'order-refund-hold-refunded'
  /** The order holds `refund_hold` and no refund was ever accepted. */
  | 'order-refund-hold-not-backed'
  /** The order holds `paying` and Paystack has no such transfer. */
  | 'order-paying-not-backed'
  /** The transfer succeeded; the order never reached `paid_out`. */
  | 'order-paying-transfer-succeeded'
  /** The payment holds the payout claim and Paystack has no such transfer. */
  | 'payout-claim-not-backed'
  /** The transfer exists; the real transfer code was never stamped. */
  | 'payout-transfer-code-not-stamped'
  /** The transfer succeeded; the payment never reached `paid_out`. */
  | 'payment-payout-succeeded-not-settled'
  /** Paystack captured the charge and the order was never settled. */
  | 'charge-paid-not-settled'
  /** A payment row left at `initialized` with nothing behind it (#112). */
  | 'orphan-initialized-payment'
  /** Paystack could not be reached for this candidate. Nothing is proposed. */
  | 'paystack-unreachable'
  /** Decidable only by a person. NEVER carries a proposed repair. */
  | 'needs-human';

/**
 * One wedged row. IDs, state names and kobo amounts only — no email, no
 * address, no token, nothing that could be echoed into a log or a Sentry tag
 * and leak (`writeResult.ts` has the same rule for the same reason).
 */
export type ReconcileFinding = {
  class: ReconcileFindingClass;
  orderId: string | null;
  paymentId: string | null;
  /** How long the row has been in this state, from `updated_at`. */
  ageMinutes: number;
  /** What Paystack answered, in one short phrase. */
  paystackSays: string;
  /**
   * The repair Phase B would apply: the original write and its original CAS
   * filters, as one line. `null` means no repair may be proposed for this
   * finding — `needs-human`, `paystack-unreachable` and the report-only
   * classes always have `null`.
   */
  proposedRepair: string | null;
  /** Why, in one sentence, for the admin reading the list. */
  note: string;
};

export type ReconcileReport = {
  generatedAt: string;
  /** Candidate rows read per class, before Paystack was asked. */
  scanned: Record<string, number>;
  findings: ReconcileFinding[];
  /** True when a per-class cap cut the scan short, so a run saw only part. */
  truncated: boolean;
  /** Query failures, by candidate class. A run reports them; it never guesses. */
  queryErrors: string[];
};

// --- Thresholds --------------------------------------------------------------
//
// Each one must exceed the longest LEGITIMATE window for the state it guards.

/**
 * The three claim states — a payment at `refunding` or `payout_pending` behind
 * a `claim:` marker, an order at `paying` or `refund_hold` — are held only
 * across ONE Paystack call inside ONE request. When that request ends, in any
 * way at all, either the claim was released or it never will be: no webhook is
 * coming (no transfer or refund exists to fire one), and nothing else sweeps
 * these slots. 60 minutes is an order of magnitude beyond the request budget
 * and beyond any retry burst, so a claim this old is finished by definition.
 */
export const CLAIM_STALE_MINUTES = 60;

/**
 * A transfer Paystack has ACCEPTED may legitimately sit `pending` for days
 * (bank queues, weekends). It is not a stuck claim and is never treated as one.
 * Past 72 hours it is still not this job's to move — it is a person's to chase.
 */
export const TRANSFER_PENDING_STALE_MINUTES = 72 * 60;

/**
 * A captured charge settles by webhook, with Paystack's own retries, or when
 * the buyer returns through the verify route. Three hours is past both.
 */
export const SETTLEMENT_STALE_MINUTES = 3 * 60;

/**
 * An orphan `initialized` row (#112) is reported, never repaired. A day is long
 * enough that no open checkout page is being called abandoned.
 */
export const ORPHAN_STALE_MINUTES = 24 * 60;

/** Default per-class candidate cap. Each candidate costs a Paystack call. */
export const DEFAULT_CLASS_LIMIT = 25;

/** The settlement scan is the noisiest class, so it gets a smaller cap. */
export const DEFAULT_SETTLEMENT_LIMIT = 10;

export type PlanOptions = {
  /** Injected in tests; `new Date()` in production. */
  now?: Date;
  /** Per-class candidate cap, clamped to [1, 100]. */
  limit?: number;
};

// --- Small helpers -----------------------------------------------------------

/** Paystack states in which a refund has been ACCEPTED and money is going back. */
const ACCEPTED_REFUND_STATES = new Set(['pending', 'processing', 'processed', 'success']);

/** Paystack states in which a transfer has been accepted but not confirmed. */
const IN_FLIGHT_TRANSFER_STATES = new Set([
  'pending',
  'processing',
  'queued',
  'received',
  'otp',
]);

const FAILED_TRANSFER_STATES = new Set(['failed', 'reversed', 'abandoned']);

function minutesBetween(now: Date, iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((now.getTime() - then) / 60000));
}

function isoMinutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60000).toISOString();
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(limit as number)));
}

/** The charge key Paystack knows this payment by. */
function chargeKey(payment: ReconcilePaymentRow): string | null {
  return payment.paystack_transaction_id || payment.paystack_reference || null;
}

/** `claim:<reference>` is the payout claim marker; a real code never looks like it. */
function claimReference(payment: ReconcilePaymentRow): string | null {
  const code = payment.payout_transfer_code;
  if (!code || !code.startsWith('claim:')) return null;
  return code.slice('claim:'.length) || null;
}

/** The transfer reference for a single-order payout, best source first. */
function paymentTransferReference(payment: ReconcilePaymentRow): string | null {
  const fromClaim = claimReference(payment);
  if (fromClaim) return fromClaim;
  const metadataRef = payment.metadata?.payoutReference;
  if (typeof metadataRef === 'string' && metadataRef) return metadataRef;
  if (!payment.order_id) return null;
  const attempt = Math.max(0, Math.floor(Number(payment.payout_attempt ?? 0)) || 0);
  return orderPayoutReference(payment.order_id, attempt);
}

/** The transfer reference for a per-order payout, best source first. */
function orderTransferReference(order: ReconcileOrderRow): string {
  if (order.payout_reference) return order.payout_reference;
  const attempt = Math.max(0, Math.floor(Number(order.payout_attempt ?? 0)) || 0);
  return orderPayoutReference(order.id, attempt);
}

function unreachable(
  orderId: string | null,
  paymentId: string | null,
  ageMinutes: number,
  what: string,
): ReconcileFinding {
  return {
    class: 'paystack-unreachable',
    orderId,
    paymentId,
    ageMinutes,
    paystackSays: 'unreachable',
    proposedRepair: null,
    note: `Paystack could not be read (${what}); this row was left exactly as it is.`,
  };
}

function needsHuman(
  orderId: string | null,
  paymentId: string | null,
  ageMinutes: number,
  paystackSays: string,
  note: string,
): ReconcileFinding {
  return {
    class: 'needs-human',
    orderId,
    paymentId,
    ageMinutes,
    paystackSays,
    proposedRepair: null,
    note,
  };
}

// --- The planner -------------------------------------------------------------

/**
 * Read the wedged rows and say, per row, what Paystack proves and what the
 * repair would be. Writes nothing.
 */
export async function planMarketplaceReconcile(
  queries: ReconcileQueries,
  paystack: PaystackReconcileReader,
  options: PlanOptions = {},
): Promise<ReconcileReport> {
  const now = options.now ?? new Date();
  const limit = clampLimit(options.limit, DEFAULT_CLASS_LIMIT);
  const settlementLimit = Math.min(limit, DEFAULT_SETTLEMENT_LIMIT);

  const findings: ReconcileFinding[] = [];
  const scanned: Record<string, number> = {};
  const queryErrors: string[] = [];
  let truncated = false;

  async function scan<T>(name: string, run: () => Read<T[]>, cap: number): Promise<T[]> {
    const { data, error } = await run();
    if (error) {
      queryErrors.push(name);
      scanned[name] = 0;
      return [];
    }
    const rows = data ?? [];
    scanned[name] = rows.length;
    if (rows.length >= cap) truncated = true;
    return rows;
  }

  // 1. Payments holding the refund claim ------------------------------------
  const refunding = await scan(
    'refundingPayments',
    () =>
      queries.listStuckRefundingPayments({
        olderThanIso: isoMinutesAgo(now, CLAIM_STALE_MINUTES),
        limit,
      }),
    limit,
  );
  for (const payment of refunding) {
    findings.push(...(await classifyRefundingPayment(payment)));
  }

  // 2. Payments holding the payout claim -------------------------------------
  const payoutPending = await scan(
    'payoutPendingPayments',
    () =>
      queries.listStuckPayoutPendingPayments({
        olderThanIso: isoMinutesAgo(now, CLAIM_STALE_MINUTES),
        limit,
      }),
    limit,
  );
  for (const payment of payoutPending) {
    findings.push(...(await classifyPayoutPendingPayment(payment)));
  }

  // 3. Orders holding the per-order payout claim -----------------------------
  const paying = await scan(
    'payingOrders',
    () =>
      queries.listStuckPayingOrders({
        olderThanIso: isoMinutesAgo(now, CLAIM_STALE_MINUTES),
        limit,
      }),
    limit,
  );
  for (const order of paying) {
    findings.push(...(await classifyPayingOrder(order)));
  }

  // 4. Orders holding the per-order refund hold ------------------------------
  const holds = await scan(
    'refundHoldOrders',
    () =>
      queries.listStuckRefundHoldOrders({
        olderThanIso: isoMinutesAgo(now, CLAIM_STALE_MINUTES),
        limit,
      }),
    limit,
  );
  for (const order of holds) {
    findings.push(...(await classifyRefundHoldOrder(order)));
  }

  // 5. Charges that may have been captured without settling -------------------
  const unsettled = await scan(
    'unsettledPayments',
    () =>
      queries.listUnsettledInitializedPayments({
        olderThanIso: isoMinutesAgo(now, SETTLEMENT_STALE_MINUTES),
        limit: settlementLimit,
      }),
    settlementLimit,
  );
  for (const payment of unsettled) {
    findings.push(...(await classifyUnsettledPayment(payment)));
  }

  // 6. The orphan rows (#112) — reported, never repaired, never asked about ---
  const orphans = await scan(
    'orphanPayments',
    () =>
      queries.listOrphanInitializedPayments({
        olderThanIso: isoMinutesAgo(now, ORPHAN_STALE_MINUTES),
        limit,
      }),
    limit,
  );
  for (const payment of orphans) {
    findings.push({
      class: 'orphan-initialized-payment',
      orderId: null,
      paymentId: payment.id,
      ageMinutes: minutesBetween(now, payment.created_at),
      paystackSays: 'not asked',
      proposedRepair: null,
      note:
        'The order link failed before any Paystack session existed (#112), so there is nothing to settle and nothing to ask Paystack. Reported for counting only.',
    });
  }

  return {
    generatedAt: now.toISOString(),
    scanned,
    findings,
    truncated,
    queryErrors,
  };

  // --- per-class classifiers (closures over `now` and the ports) ------------

  async function classifyRefundingPayment(
    payment: ReconcilePaymentRow,
  ): Promise<ReconcileFinding[]> {
    const age = minutesBetween(now, payment.updated_at);
    // The state moved on between the query and here: nothing to say.
    if (payment.status !== 'refunding') return [];
    const key = chargeKey(payment);
    if (!key) {
      return [
        needsHuman(
          payment.order_id,
          payment.id,
          age,
          'not asked',
          'The payment row carries neither a Paystack reference nor a transaction id, so no refund can be looked up.',
        ),
      ];
    }

    let refunds: ReaderRefund[];
    try {
      refunds = await paystack.listRefundsForTransaction(key);
    } catch {
      return [unreachable(payment.order_id, payment.id, age, 'refund lookup')];
    }
    const accepted = refunds.filter((r) => ACCEPTED_REFUND_STATES.has(r.status));

    if (accepted.length === 0) {
      return [
        {
          class: 'refund-claim-not-backed',
          orderId: payment.order_id,
          paymentId: payment.id,
          ageMinutes: age,
          paystackSays: 'no refund accepted for this charge',
          proposedRepair:
            "marketplace_payments.update({status: 'paid'}) WHERE id = <paymentId> AND status = 'refunding'",
          note:
            'The refund call never took, and the rollback that should have given the claim back did not run. The row refuses every later refund and the payout until it is released.',
        },
      ];
    }

    if (!payment.checkout_id) {
      if (accepted.length > 1) {
        return [
          needsHuman(
            payment.order_id,
            payment.id,
            age,
            `${accepted.length} refunds accepted`,
            'A single-order charge with more than one accepted refund: which reference belongs on the row is not this job\'s to decide.',
          ),
        ];
      }
      return [
        {
          class: 'refund-paid-not-stamped',
          orderId: payment.order_id,
          paymentId: payment.id,
          ageMinutes: age,
          paystackSays: `refund ${accepted[0].status}`,
          proposedRepair:
            "marketplace_payments.update({status: 'refunded', refund_reference: <paystack refund id>}) WHERE id = <paymentId> AND status = 'refunding'",
          note:
            'Paystack has paid the buyer back and the stamp that records it failed. The buyer already has the money; only our record is wrong.',
        },
      ];
    }

    // A cart: the payment row covers several orders, so which order the refund
    // belongs to is not readable from the row.
    const { data: siblings, error } = await queries.listCheckoutSiblingOrders(payment.checkout_id);
    if (error) {
      return [
        needsHuman(
          payment.order_id,
          payment.id,
          age,
          `refund ${accepted[0].status}`,
          'The sibling orders of this cart could not be read, and the repair depends on whether one is still open.',
        ),
      ];
    }
    const open = (siblings ?? []).filter(
      (row) => !['cancelled', 'completed'].includes(row.status),
    );
    if (open.length >= 2) {
      // Whichever order was refunded, another is still open, so the original
      // write was the release back to `paid` — decidable without attribution.
      return [
        {
          class: 'refund-claim-sibling-open',
          orderId: null,
          paymentId: payment.id,
          ageMinutes: age,
          paystackSays: `refund ${accepted[0].status}`,
          proposedRepair:
            "marketplace_payments.update({status: 'paid'}) WHERE id = <paymentId> AND status = 'refunding'",
          note: `This order's share is back with the buyer and ${open.length} sibling orders are still open, so the charge as a whole is not refunded and the claim must go back to 'paid'.`,
        },
      ];
    }
    return [
      needsHuman(
        null,
        payment.id,
        age,
        `refund ${accepted[0].status}`,
        'A cart refund that cannot be attributed to one order: with fewer than two open siblings, whether the row should read `refunded` or go back to `paid` depends on which order was refunded.',
      ),
    ];
  }

  async function classifyPayoutPendingPayment(
    payment: ReconcilePaymentRow,
  ): Promise<ReconcileFinding[]> {
    const age = minutesBetween(now, payment.updated_at);
    if (payment.status !== 'payout_pending') {
      // The one state worth a Paystack call anyway: we say the money is out.
      if (payment.status === 'paid_out') {
        return dangerousDirectionForPayment(payment, age);
      }
      return [];
    }
    const reference = paymentTransferReference(payment);
    if (!reference) {
      return [
        needsHuman(
          payment.order_id,
          payment.id,
          age,
          'not asked',
          'No transfer reference can be derived for this payment, so Paystack cannot be asked what happened.',
        ),
      ];
    }

    let transfer: ReaderTransfer;
    try {
      transfer = await paystack.getTransferByReference(reference);
    } catch {
      return [unreachable(payment.order_id, payment.id, age, 'transfer lookup')];
    }

    const holdsClaimMarker = claimReference(payment) !== null;

    if (!transfer.found) {
      if (!holdsClaimMarker) {
        return [
          needsHuman(
            payment.order_id,
            payment.id,
            age,
            'no such transfer',
            'The row carries a real transfer code but Paystack has no transfer under its reference. Releasing this claim could let a second transfer go out.',
          ),
        ];
      }
      return [
        {
          class: 'payout-claim-not-backed',
          orderId: payment.order_id,
          paymentId: payment.id,
          ageMinutes: age,
          paystackSays: 'no such transfer',
          proposedRepair:
            "marketplace_payments.update({status: 'paid', payout_transfer_code: null}) WHERE id = <paymentId> AND status = 'payout_pending' AND payout_transfer_code = 'claim:<reference>'",
          note:
            'The transfer never reached Paystack and the rollback failed. Behind this claim marker the seller can never be paid and the buyer\'s refund is refused.',
        },
      ];
    }

    const out: ReconcileFinding[] = [];
    if (holdsClaimMarker) {
      out.push({
        class: 'payout-transfer-code-not-stamped',
        orderId: payment.order_id,
        paymentId: payment.id,
        ageMinutes: age,
        paystackSays: `transfer ${transfer.status}`,
        proposedRepair:
          "marketplace_payments.update({payout_transfer_code: <paystack transfer code>}) WHERE id = <paymentId> AND payout_transfer_code = 'claim:<reference>'",
        note:
          'The transfer exists at Paystack and the stamp that records its code failed, so no transfer webhook can match this row by code.',
      });
    }

    if (transfer.status === 'success') {
      out.push({
        class: 'payment-payout-succeeded-not-settled',
        orderId: payment.order_id,
        paymentId: payment.id,
        ageMinutes: age,
        paystackSays: 'transfer success',
        proposedRepair:
          "marketplace_payments.update({status: 'paid_out', payout_at: <now>}) WHERE id = <paymentId> AND status IN ('payout_pending','paid')",
        note: 'Paystack paid the seller and the settlement write failed.',
      });
      return out;
    }
    if (FAILED_TRANSFER_STATES.has(String(transfer.status))) {
      out.push(
        needsHuman(
          payment.order_id,
          payment.id,
          age,
          `transfer ${transfer.status}`,
          'The transfer failed or was reversed. Putting the row back is the transfer.failed webhook\'s job, because it also burns a payout attempt; this job must not do it.',
        ),
      );
      return out;
    }
    if (
      IN_FLIGHT_TRANSFER_STATES.has(String(transfer.status)) &&
      age > TRANSFER_PENDING_STALE_MINUTES
    ) {
      out.push(
        needsHuman(
          payment.order_id,
          payment.id,
          age,
          `transfer ${transfer.status}`,
          'The transfer has been pending at Paystack for over 72 hours. Nothing here is wedged by us; somebody should chase it.',
        ),
      );
    }
    return out;
  }

  async function dangerousDirectionForPayment(
    payment: ReconcilePaymentRow,
    age: number,
  ): Promise<ReconcileFinding[]> {
    const reference = paymentTransferReference(payment);
    if (!reference) return [];
    let transfer: ReaderTransfer;
    try {
      transfer = await paystack.getTransferByReference(reference);
    } catch {
      return [unreachable(payment.order_id, payment.id, age, 'transfer lookup')];
    }
    if (transfer.found && transfer.status === 'success') return [];
    return [
      needsHuman(
        payment.order_id,
        payment.id,
        age,
        transfer.found ? `transfer ${transfer.status}` : 'no such transfer',
        'The payment says the seller has been paid and Paystack does not agree. Nothing is proposed: this is the direction where a wrong guess moves money.',
      ),
    ];
  }

  async function classifyPayingOrder(order: ReconcileOrderRow): Promise<ReconcileFinding[]> {
    const age = minutesBetween(now, order.updated_at);
    if (order.payout_status !== 'paying') {
      if (order.payout_status === 'paid_out') {
        return dangerousDirectionForOrder(order, age);
      }
      return [];
    }
    const reference = orderTransferReference(order);

    let transfer: ReaderTransfer;
    try {
      transfer = await paystack.getTransferByReference(reference);
    } catch {
      return [unreachable(order.id, order.payment_id, age, 'transfer lookup')];
    }

    if (!transfer.found) {
      if (order.payout_transfer_code) {
        return [
          needsHuman(
            order.id,
            order.payment_id,
            age,
            'no such transfer',
            'The order carries a transfer code but Paystack has no transfer under its reference. Releasing the claim could let a second transfer go out.',
          ),
        ];
      }
      return [
        {
          class: 'order-paying-not-backed',
          orderId: order.id,
          paymentId: order.payment_id,
          ageMinutes: age,
          paystackSays: 'no such transfer',
          proposedRepair:
            "marketplace_orders.update({payout_status: 'pending', payout_failed_reason: <job reason>}) WHERE id = <orderId> AND payout_status = 'paying'",
          note:
            'No transfer was ever made and the claim release failed, so this order can never be claimed again and the seller is never paid.',
        },
      ];
    }

    if (transfer.status === 'success') {
      return [
        {
          class: 'order-paying-transfer-succeeded',
          orderId: order.id,
          paymentId: order.payment_id,
          ageMinutes: age,
          paystackSays: 'transfer success',
          proposedRepair:
            "marketplace_orders.update({payout_status: 'paid_out', payout_failed_reason: null}) WHERE id = <orderId> AND payout_status IN ('paying','pending')",
          note:
            'Paystack paid this seller and the settlement write failed. The parent payment row rolls up on a later run, once every sibling has settled.',
        },
      ];
    }
    if (FAILED_TRANSFER_STATES.has(String(transfer.status))) {
      return [
        needsHuman(
          order.id,
          order.payment_id,
          age,
          `transfer ${transfer.status}`,
          'The transfer failed or was reversed. Unwinding it burns a payout attempt and belongs to the transfer.failed webhook, not to this job.',
        ),
      ];
    }
    if (age > TRANSFER_PENDING_STALE_MINUTES) {
      return [
        needsHuman(
          order.id,
          order.payment_id,
          age,
          `transfer ${transfer.status}`,
          'The transfer has been pending at Paystack for over 72 hours.',
        ),
      ];
    }
    // Accepted and still in flight: legitimately waiting for transfer.success.
    return [];
  }

  async function dangerousDirectionForOrder(
    order: ReconcileOrderRow,
    age: number,
  ): Promise<ReconcileFinding[]> {
    let transfer: ReaderTransfer;
    try {
      transfer = await paystack.getTransferByReference(orderTransferReference(order));
    } catch {
      return [unreachable(order.id, order.payment_id, age, 'transfer lookup')];
    }
    if (transfer.found && transfer.status === 'success') return [];
    return [
      needsHuman(
        order.id,
        order.payment_id,
        age,
        transfer.found ? `transfer ${transfer.status}` : 'no such transfer',
        'The order says the seller has been paid and Paystack does not agree. Nothing is proposed: this is the direction where a wrong guess moves money.',
      ),
    ];
  }

  async function classifyRefundHoldOrder(order: ReconcileOrderRow): Promise<ReconcileFinding[]> {
    const age = minutesBetween(now, order.updated_at);
    if (order.payout_status !== 'refund_hold') return [];
    if (!order.payment_id) {
      return [
        needsHuman(
          order.id,
          null,
          age,
          'not asked',
          'The order holds a refund hold and names no payment, so there is no charge to ask Paystack about.',
        ),
      ];
    }
    const { data: payment, error } = await queries.getPaymentForReconcile(order.payment_id);
    if (error || !payment) {
      return [
        needsHuman(
          order.id,
          order.payment_id,
          age,
          'not asked',
          'The payment row behind this refund hold could not be read.',
        ),
      ];
    }
    const key = chargeKey(payment);
    if (!key) {
      return [
        needsHuman(
          order.id,
          payment.id,
          age,
          'not asked',
          'The payment carries no Paystack reference, so no refund can be looked up.',
        ),
      ];
    }

    let refunds: ReaderRefund[];
    try {
      refunds = await paystack.listRefundsForTransaction(key);
    } catch {
      return [unreachable(order.id, payment.id, age, 'refund lookup')];
    }
    const accepted = refunds.filter((r) => ACCEPTED_REFUND_STATES.has(r.status));

    if (accepted.length === 0) {
      return [
        {
          class: 'order-refund-hold-not-backed',
          orderId: order.id,
          paymentId: payment.id,
          ageMinutes: age,
          paystackSays: 'no refund accepted for this charge',
          proposedRepair:
            "marketplace_orders.update({payout_status: 'pending'}) WHERE id = <orderId> AND payout_status = 'refund_hold'",
          note:
            'No refund was ever accepted, and the hold that should have been given back was not. It blocks the payout and refuses every later refund for this order.',
        },
      ];
    }
    if (payment.checkout_id) {
      return [
        needsHuman(
          order.id,
          payment.id,
          age,
          `refund ${accepted[0].status}`,
          'A cart charge with an accepted refund: whether THIS order is the refunded one cannot be read from the rows, and marking the wrong order unpayable would cost a seller their money.',
        ),
      ];
    }
    return [
      {
        class: 'order-refund-hold-refunded',
        orderId: order.id,
        paymentId: payment.id,
        ageMinutes: age,
        paystackSays: `refund ${accepted[0].status}`,
        proposedRepair:
          "marketplace_orders.update({payout_status: 'skipped', payout_failed_reason: 'refunded'}) WHERE id = <orderId> AND payout_status = 'refund_hold'",
        note:
          'The buyer has been refunded, so this order must never pay out, and the write that records that failed.',
      },
    ];
  }

  async function classifyUnsettledPayment(
    payment: ReconcilePaymentRow,
  ): Promise<ReconcileFinding[]> {
    const age = minutesBetween(now, payment.created_at);
    if (payment.status !== 'initialized') return [];
    const reference = payment.paystack_reference;
    if (!reference) return [];

    let charge: ReaderCharge;
    try {
      charge = await paystack.verifyCharge(reference);
    } catch {
      return [unreachable(payment.order_id, payment.id, age, 'charge verify')];
    }
    if (!charge.found || charge.status !== 'success') return [];
    return [
      {
        class: 'charge-paid-not-settled',
        orderId: payment.order_id,
        paymentId: payment.id,
        ageMinutes: age,
        paystackSays: 'charge success',
        proposedRepair: null,
        note:
          'Paystack captured this charge and the order was never settled. Settlement grants entitlements, delivers digital goods and splits fees, so it is deliberately not something this job re-applies: a person runs the settlement path.',
      },
    ];
  }
}
