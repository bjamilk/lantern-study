/**
 * Marketplace money reconciliation, step 2: APPLY one repair, by hand (#113).
 *
 * ## Purpose
 *
 * Phase A found the rows whose money moved and whose record of it did not. This
 * is the half that puts one of them right — one row, named by an admin, with a
 * typed confirmation, behind a flag that is OFF by default.
 *
 * There is deliberately NO cron here and no batch. A repeatable job is a later,
 * separate change per class, once manual repairs have run cleanly on that class
 * (founder decision, 2026-09-17; see `docs/marketplace-reconcile.md`).
 *
 * ## The four rails
 *
 * 1. **It re-plans.** The caller sends the finding's IDENTITY only — a class and
 *    an order or payment id. This module re-reads our row and re-asks Paystack
 *    and reaches its own verdict through the SAME classifiers the report used.
 *    A finding payload from a client is never trusted, and a finding that no
 *    longer holds is refused with nothing written.
 * 2. **It applies the ORIGINAL write with the ORIGINAL compare-and-swap
 *    filters**, through `mustWrite`. A CAS that matches nothing is reported as
 *    `no_op` — "already repaired, or the state moved on" — never as a fresh
 *    success.
 * 3. **It never moves money.** Every Paystack call it can make arrives through
 *    `PaystackReconcileReader`, which is three `GET`s; no money-moving Paystack
 *    function is imported into this file, and a test asserts that.
 * 4. **It is per class, behind a flag.** Nine classes have a repair; classes 2
 *    (cart refunds), 11, 12, 13 and 14 have NO repair code path at all. Each
 *    flag is read PER REQUEST, like `ENABLE_ADMIN_ROLE_MANAGEMENT`, so what an
 *    operator sets and what the endpoint does can never disagree.
 *
 * ## What it touches
 *
 * Nothing directly: the queries, the repair writes, the Paystack reader and the
 * audit writer all arrive as ports, which is what lets every case in the test
 * bar be exercised without a database or a network.
 *
 * ## Gotcha
 *
 * A cart charge is one payment row over many orders, so its refunds cannot be
 * attributed and its payout state is not one seller's. The planner already
 * strips `proposedRepair` from a cart-shaped finding, and this module refuses
 * anything whose re-planned `proposedRepair` is null — which is the single
 * invariant that keeps a cart row unrepairable even when an admin names it.
 */
import { PublicError } from '../utils/safeError';
import { mustWrite } from './data/writeResult';
import type { RepairResult } from './data/marketplaceReconcile';
import {
  createReconcileClassifiers,
  type PaystackReconcileReader,
  type ReconcileFinding,
  type ReconcileFindingClass,
  type ReconcileQueries,
} from './marketplaceReconcile';

/** The phrase an admin must type. Same shape as the role route's (#113). */
export const RECONCILE_REPAIR_CONFIRMATION = 'CONFIRM_MARKETPLACE_RECONCILE_REPAIR';

/** The nine classes with a repair, and which row each one is named by. */
export const REPAIRABLE_CLASSES = {
  'refund-paid-not-stamped': 'payment',
  'refund-claim-not-backed': 'payment',
  'order-refund-hold-refunded': 'order',
  'order-refund-hold-not-backed': 'order',
  'order-paying-not-backed': 'order',
  'order-paying-transfer-succeeded': 'order',
  'payout-claim-not-backed': 'payment',
  'payout-transfer-code-not-stamped': 'payment',
  'payment-payout-succeeded-not-settled': 'payment',
} as const;

export type RepairableClass = keyof typeof REPAIRABLE_CLASSES;

export function isRepairableClass(value: string): value is RepairableClass {
  return Object.prototype.hasOwnProperty.call(REPAIRABLE_CLASSES, value);
}

/** `refund-paid-not-stamped` → `MARKETPLACE_RECONCILE_REPAIR_REFUND_PAID_NOT_STAMPED`. */
export function repairFlagName(cls: RepairableClass): string {
  return `MARKETPLACE_RECONCILE_REPAIR_${cls.replace(/-/g, '_').toUpperCase()}`;
}

/**
 * Flags default OFF — the opposite of `ENABLE_ADMIN_ROLE_MANAGEMENT`, and
 * deliberately so: an unset variable must never repair a money row. Only an
 * explicit `true` / `1` / `on` enables a class.
 */
export function isRepairEnabled(
  cls: RepairableClass,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env[repairFlagName(cls)] ?? '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/** The nine repair writes, bound (satisfied by `dataLayer.marketplaceReconcile`). */
export type ReconcileRepairWrites = {
  stampPaymentRefunded(input: {
    paymentId: string;
    refundReference: string;
    nowIso: string;
  }): Promise<RepairResult>;
  releasePaymentRefundClaim(input: { paymentId: string; nowIso: string }): Promise<RepairResult>;
  markOrderRefundedNotPayable(input: { orderId: string }): Promise<RepairResult>;
  releaseOrderRefundHold(input: { orderId: string }): Promise<RepairResult>;
  releaseOrderPayoutClaim(input: { orderId: string; reason: string }): Promise<RepairResult>;
  settleOrderPayout(input: { orderId: string }): Promise<RepairResult>;
  releasePaymentPayoutClaim(input: {
    paymentId: string;
    claimMarker: string;
    reason: string;
    nowIso: string;
  }): Promise<RepairResult>;
  stampPaymentTransferCode(input: {
    paymentId: string;
    claimMarker: string;
    transferCode: string;
    nowIso: string;
  }): Promise<RepairResult>;
  settlePaymentPaidOut(input: { paymentId: string; nowIso: string }): Promise<RepairResult>;
};

/** The one audit call this module makes, injected so a test can read it. */
export type ReconcileAuditWriter = (params: {
  actorId: string;
  action: 'marketplace_reconcile_repair';
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type ReconcileRepairPorts = {
  queries: ReconcileQueries & ReconcileRepairWrites;
  paystack: PaystackReconcileReader;
  audit: ReconcileAuditWriter;
};

export type RepairRequest = {
  class: string;
  orderId?: string | null;
  paymentId?: string | null;
  confirmationPhrase?: string | null;
  /** The platform admin who asked. The audit row's actor — never the job. */
  actorId: string;
};

export type RepairOutcome = {
  outcome: 'repaired' | 'no_op';
  class: RepairableClass;
  orderId: string | null;
  paymentId: string | null;
  paystackRef: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** Free text for the admin: what happened, in one sentence. */
  message: string;
};

export type RepairOptions = {
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

function fail(message: string, statusCode: number): never {
  throw Object.assign(new PublicError(message), { statusCode });
}

/**
 * Apply ONE named finding, or refuse and write nothing.
 *
 * @throws PublicError with a 4xx/503 statusCode for every refusal — a wrong
 * phrase, a report-only class, a flag that is off, a missing row, a finding
 * that no longer holds, or Paystack being unreadable.
 */
export async function applyReconcileRepair(
  ports: ReconcileRepairPorts,
  request: RepairRequest,
  options: RepairOptions = {},
): Promise<RepairOutcome> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const env = options.env ?? process.env;

  if (request.confirmationPhrase !== RECONCILE_REPAIR_CONFIRMATION) {
    fail('Missing or invalid confirmation phrase.', 400);
  }
  if (!isRepairableClass(request.class)) {
    fail(
      `This finding class has no repair: ${String(request.class)}. It is report-only and a person decides it.`,
      400,
    );
  }
  const cls: RepairableClass = request.class;
  if (!isRepairEnabled(cls, env)) {
    fail(`Repairs for ${cls} are switched off on this server (${repairFlagName(cls)}).`, 403);
  }

  const shape = REPAIRABLE_CLASSES[cls];
  const orderId = request.orderId?.trim() || null;
  const paymentId = request.paymentId?.trim() || null;
  if (shape === 'payment' && !paymentId) fail('paymentId is required for this class.', 400);
  if (shape === 'order' && !orderId) fail('orderId is required for this class.', 400);

  // --- Re-plan, from our rows and Paystack ---------------------------------
  const classifiers = createReconcileClassifiers(ports.queries, ports.paystack, now);
  let findings: ReconcileFinding[];
  let before: Record<string, unknown>;
  let claimMarker: string | null = null;

  if (shape === 'payment') {
    const { data: payment, error } = await ports.queries.getPaymentForReconcile(paymentId as string);
    if (error) fail('The payment row could not be read.', 503);
    if (!payment) fail('Payment not found.', 404);
    before = {
      status: payment.status,
      payout_transfer_code: payment.payout_transfer_code,
      refund_reference: payment.refund_reference,
      checkout_id: payment.checkout_id,
    };
    claimMarker = payment.payout_transfer_code?.startsWith('claim:')
      ? payment.payout_transfer_code
      : null;
    findings =
      payment.status === 'refunding'
        ? await classifiers.classifyRefundingPayment(payment)
        : await classifiers.classifyPayoutPendingPayment(payment);
  } else {
    const { data: order, error } = await ports.queries.getOrderForReconcile(orderId as string);
    if (error) fail('The order row could not be read.', 503);
    if (!order) fail('Order not found.', 404);
    before = {
      payout_status: order.payout_status,
      payout_transfer_code: order.payout_transfer_code,
      payout_reference: order.payout_reference,
    };
    findings =
      order.payout_status === 'refund_hold'
        ? await classifiers.classifyRefundHoldOrder(order)
        : await classifiers.classifyPayingOrder(order);
  }

  if (findings.some((f) => f.class === 'paystack-unreachable')) {
    fail('Paystack could not be read, so nothing was changed. Try again later.', 503);
  }

  const finding = findings.find((f) => f.class === cls && f.proposedRepair !== null);
  if (!finding) {
    const seen = findings.map((f) => f.class).join(', ') || 'nothing';
    fail(
      `That finding no longer holds: re-planning this row now says ${seen}. Nothing was changed.`,
      409,
    );
  }

  // --- Apply the original write, with the original CAS ----------------------
  const { result, after, table } = await applyWrite(ports.queries, cls, {
    orderId: finding.orderId ?? orderId,
    paymentId: finding.paymentId ?? paymentId,
    paystackRef: finding.paystackRef,
    claimMarker,
    nowIso,
  });

  mustWrite(result, {
    table,
    op: 'update',
    ...(finding.orderId ? { orderId: finding.orderId } : {}),
    ...(finding.paymentId ? { paymentId: finding.paymentId } : {}),
    reason: `reconcile_repair:${cls}`,
  });

  const matched = (result.data ?? []).length > 0;
  const outcome: RepairOutcome = {
    outcome: matched ? 'repaired' : 'no_op',
    class: cls,
    orderId: finding.orderId ?? orderId,
    paymentId: finding.paymentId ?? paymentId,
    paystackRef: finding.paystackRef,
    before,
    after: matched ? after : {},
    message: matched
      ? `Repaired: ${cls}.`
      : 'Nothing to do: the compare-and-swap matched no row, so this was already repaired or the state moved on.',
  };

  // The audit row is must-be-SEEN, not must-block: `logAdminAction` reports its
  // own failure under `audit-log-write-failed` and never throws, because a lost
  // audit row must not turn a repair that HAPPENED into an error the admin
  // reads as "it did not".
  await ports.audit({
    actorId: request.actorId,
    action: 'marketplace_reconcile_repair',
    targetType: shape === 'payment' ? 'marketplace_payment' : 'marketplace_order',
    targetId: (shape === 'payment' ? outcome.paymentId : outcome.orderId) ?? undefined,
    metadata: {
      class: cls,
      outcome: outcome.outcome,
      paystackRef: finding.paystackRef,
      paystackSays: finding.paystackSays,
      before,
      after: outcome.after,
      orderId: outcome.orderId,
      paymentId: outcome.paymentId,
    },
  });

  return outcome;
}

/** The class → original write map. The only place a repair chooses a write. */
async function applyWrite(
  writes: ReconcileRepairWrites,
  cls: RepairableClass,
  input: {
    orderId: string | null;
    paymentId: string | null;
    paystackRef: string | null;
    claimMarker: string | null;
    nowIso: string;
  },
): Promise<{ result: RepairResult; after: Record<string, unknown>; table: string }> {
  const payments = 'marketplace_payments';
  const orders = 'marketplace_orders';
  const paymentId = input.paymentId as string;
  const orderId = input.orderId as string;

  switch (cls) {
    case 'refund-paid-not-stamped': {
      const refundReference = input.paystackRef;
      if (!refundReference) fail('The refund reference is missing; nothing was changed.', 409);
      return {
        result: await writes.stampPaymentRefunded({ paymentId, refundReference, nowIso: input.nowIso }),
        after: { status: 'refunded', refund_reference: refundReference },
        table: payments,
      };
    }
    case 'refund-claim-not-backed':
      return {
        result: await writes.releasePaymentRefundClaim({ paymentId, nowIso: input.nowIso }),
        after: { status: 'paid' },
        table: payments,
      };
    case 'order-refund-hold-refunded':
      return {
        result: await writes.markOrderRefundedNotPayable({ orderId }),
        after: { payout_status: 'skipped', payout_failed_reason: 'refunded' },
        table: orders,
      };
    case 'order-refund-hold-not-backed':
      return {
        result: await writes.releaseOrderRefundHold({ orderId }),
        after: { payout_status: 'pending' },
        table: orders,
      };
    case 'order-paying-not-backed': {
      const reason = 'Reconciliation (#113): Paystack has no transfer for this payout reference.';
      return {
        result: await writes.releaseOrderPayoutClaim({ orderId, reason }),
        after: { payout_status: 'pending', payout_failed_reason: reason },
        table: orders,
      };
    }
    case 'order-paying-transfer-succeeded':
      return {
        result: await writes.settleOrderPayout({ orderId }),
        after: { payout_status: 'paid_out', payout_failed_reason: null },
        table: orders,
      };
    case 'payout-claim-not-backed': {
      // The claim marker is the CAS: without it this release could clear a
      // transfer another caller has stamped as live.
      if (!input.claimMarker) fail('This payment no longer holds a payout claim marker.', 409);
      const reason = 'Reconciliation (#113): Paystack has no transfer for this claim.';
      return {
        result: await writes.releasePaymentPayoutClaim({
          paymentId,
          claimMarker: input.claimMarker,
          reason,
          nowIso: input.nowIso,
        }),
        after: { status: 'paid', payout_transfer_code: null, payout_failed_reason: reason },
        table: payments,
      };
    }
    case 'payout-transfer-code-not-stamped': {
      if (!input.claimMarker) fail('This payment no longer holds a payout claim marker.', 409);
      const transferCode = input.paystackRef;
      if (!transferCode) fail('Paystack returned no transfer code; nothing was changed.', 409);
      return {
        result: await writes.stampPaymentTransferCode({
          paymentId,
          claimMarker: input.claimMarker,
          transferCode,
          nowIso: input.nowIso,
        }),
        after: { payout_transfer_code: transferCode },
        table: payments,
      };
    }
    case 'payment-payout-succeeded-not-settled':
      return {
        result: await writes.settlePaymentPaidOut({ paymentId, nowIso: input.nowIso }),
        after: { status: 'paid_out', payout_at: input.nowIso },
        table: payments,
      };
  }
}
