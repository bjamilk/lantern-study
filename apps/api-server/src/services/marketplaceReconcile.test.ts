/**
 * The reconciliation planner, per class (#113).
 *
 * The planner is the one piece of this job that decides anything, so it is
 * tested the way a money decision should be: our rows say X, Paystack says Y,
 * and exactly one finding — with exactly one proposed repair, or none — must
 * come out.
 *
 * The negative cases matter more than the positive ones and are here in full:
 * a row too young is never a candidate; a row whose state moved on produces
 * nothing; Paystack unreachable produces a report and NEVER a repair; and the
 * dangerous direction — our row says the seller was paid, Paystack says the
 * transfer failed or does not exist — produces `needs-human` with
 * `proposedRepair: null`, because that is the direction where a wrong guess
 * moves money.
 *
 * The Paystack reader is a fake. No test in this repo may reach the live
 * Paystack API, and the planner is written against an interface precisely so
 * that this one cannot.
 */
import {
  CLAIM_STALE_MINUTES,
  planMarketplaceReconcile,
  type PaystackReconcileReader,
  type ReconcileQueries,
  type ReaderCharge,
  type ReaderRefund,
  type ReaderTransfer,
} from './marketplaceReconcile';
import type {
  ReconcileOrderRow,
  ReconcilePaymentRow,
} from './data/marketplaceReconcile';

const NOW = new Date('2026-09-17T12:00:00.000Z');

/** `minutes` ago, as an ISO string. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60000).toISOString();
}

const STALE = ago(CLAIM_STALE_MINUTES + 30);

function payment(over: Partial<ReconcilePaymentRow> = {}): ReconcilePaymentRow {
  return {
    id: 'pay-1',
    order_id: 'order-1',
    checkout_id: null,
    status: 'refunding',
    paystack_reference: 'ls_mkt_ref_1',
    paystack_transaction_id: null,
    payout_transfer_code: null,
    payout_attempt: 0,
    refund_reference: null,
    total_charged_kobo: 500000,
    metadata: {},
    created_at: ago(5000),
    updated_at: STALE,
    ...over,
  };
}

function order(over: Partial<ReconcileOrderRow> = {}): ReconcileOrderRow {
  return {
    id: 'order-1',
    payment_id: 'pay-1',
    checkout_id: 'checkout-1',
    status: 'paid',
    payout_status: 'paying',
    payout_reference: 'ls_po_abc',
    payout_transfer_code: null,
    payout_attempt: 0,
    created_at: ago(5000),
    updated_at: STALE,
    ...over,
  };
}

type Rows = {
  refunding?: ReconcilePaymentRow[];
  payoutPending?: ReconcilePaymentRow[];
  orphans?: ReconcilePaymentRow[];
  unsettled?: ReconcilePaymentRow[];
  paying?: ReconcileOrderRow[];
  holds?: ReconcileOrderRow[];
  payments?: Record<string, ReconcilePaymentRow>;
  siblings?: Array<{ id: string; status: string; payout_status: string }>;
  siblingsError?: boolean;
};

/**
 * Queries over fixed rows. The candidate SELECTION (age, state) is the data
 * module's job and is pinned by its own query-shape test; here the rows handed
 * in are by definition the candidates, so a test that wants "too young" says so
 * by handing in a young row and asserting the planner still says nothing about
 * it once its state does not match.
 */
function queries(rows: Rows): ReconcileQueries {
  const ok = <T>(data: T) => Promise.resolve({ data, error: null });
  return {
    listStuckRefundingPayments: () => ok(rows.refunding ?? []),
    listStuckPayoutPendingPayments: () => ok(rows.payoutPending ?? []),
    listOrphanInitializedPayments: () => ok(rows.orphans ?? []),
    listUnsettledInitializedPayments: () => ok(rows.unsettled ?? []),
    listStuckPayingOrders: () => ok(rows.paying ?? []),
    listStuckRefundHoldOrders: () => ok(rows.holds ?? []),
    getPaymentForReconcile: (id: string) => ok(rows.payments?.[id] ?? null),
    listCheckoutSiblingOrders: () =>
      rows.siblingsError
        ? Promise.resolve({ data: null, error: new Error('read failed') })
        : ok(rows.siblings ?? []),
  };
}

type FakeReaderOptions = {
  transfer?: ReaderTransfer | (() => never);
  refunds?: ReaderRefund[] | (() => never);
  charge?: ReaderCharge | (() => never);
};

const NOT_FOUND: ReaderTransfer = {
  found: false,
  status: null,
  transferCode: null,
  amountKobo: null,
};

function reader(options: FakeReaderOptions = {}): PaystackReconcileReader {
  const answer = <T>(value: T | (() => never) | undefined, fallback: T): Promise<T> => {
    if (typeof value === 'function') return Promise.resolve().then(value as () => never);
    return Promise.resolve(value === undefined ? fallback : value);
  };
  return {
    getTransferByReference: () => answer(options.transfer, NOT_FOUND),
    listRefundsForTransaction: () => answer(options.refunds, []),
    verifyCharge: () => answer(options.charge, { found: false, status: null, amountKobo: null }),
  };
}

const throws = () => {
  throw new Error('Paystack request failed (503)');
};

async function plan(rows: Rows, paystack: PaystackReconcileReader) {
  return planMarketplaceReconcile(queries(rows), paystack, { now: NOW });
}

describe('the reconciliation planner — the repairs it proposes', () => {
  it('a refund Paystack paid, on a row still saying refunding: stamp it refunded', async () => {
    const report = await plan(
      { refunding: [payment()] },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 500000 }] }),
    );
    expect(report.findings).toHaveLength(1);
    const [finding] = report.findings;
    expect(finding.class).toBe('refund-paid-not-stamped');
    expect(finding.paymentId).toBe('pay-1');
    expect(finding.ageMinutes).toBe(CLAIM_STALE_MINUTES + 30);
    expect(finding.proposedRepair).toContain("status: 'refunded'");
    expect(finding.proposedRepair).toContain("status = 'refunding'");
  });

  it('a refund claim Paystack is not backing: release it to paid', async () => {
    const report = await plan({ refunding: [payment()] }, reader({ refunds: [] }));
    expect(report.findings.map((f) => f.class)).toEqual(['refund-claim-not-backed']);
    expect(report.findings[0].proposedRepair).toContain("status: 'paid'");
  });

  it('a FAILED refund is not an accepted one: the claim is still not backed', async () => {
    const report = await plan(
      { refunding: [payment()] },
      reader({ refunds: [{ id: 'rf_1', status: 'failed', amountKobo: 500000 }] }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['refund-claim-not-backed']);
  });

  it('a cart refund with two siblings still open: release the shared row to paid', async () => {
    const report = await plan(
      {
        refunding: [payment({ checkout_id: 'checkout-1', order_id: null })],
        siblings: [
          { id: 'order-1', status: 'paid', payout_status: 'pending' },
          { id: 'order-2', status: 'paid', payout_status: 'pending' },
        ],
      },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 100000 }] }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['refund-claim-sibling-open']);
    expect(report.findings[0].proposedRepair).toContain("status: 'paid'");
  });

  it('a cart refund it cannot attribute to one order is left to a person', async () => {
    const report = await plan(
      {
        refunding: [payment({ checkout_id: 'checkout-1', order_id: null })],
        siblings: [{ id: 'order-1', status: 'paid', payout_status: 'pending' }],
      },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 100000 }] }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['needs-human']);
    expect(report.findings[0].proposedRepair).toBeNull();
  });

  it('an order at paying with no transfer at Paystack: release the claim', async () => {
    const report = await plan({ paying: [order()] }, reader({ transfer: NOT_FOUND }));
    expect(report.findings.map((f) => f.class)).toEqual(['order-paying-not-backed']);
    expect(report.findings[0].proposedRepair).toContain("payout_status: 'pending'");
    expect(report.findings[0].proposedRepair).toContain("payout_status = 'paying'");
  });

  it('an order at paying whose transfer succeeded: settle it paid_out', async () => {
    const report = await plan(
      { paying: [order()] },
      reader({
        transfer: { found: true, status: 'success', transferCode: 'TRF_1', amountKobo: 400000 },
      }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['order-paying-transfer-succeeded']);
    expect(report.findings[0].proposedRepair).toContain("payout_status IN ('paying','pending')");
  });

  it('a payment holding a claim marker with no transfer: roll the claim back', async () => {
    const report = await plan(
      {
        payoutPending: [
          payment({ status: 'payout_pending', payout_transfer_code: 'claim:ls_po_abc' }),
        ],
      },
      reader({ transfer: NOT_FOUND }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['payout-claim-not-backed']);
    expect(report.findings[0].proposedRepair).toContain('payout_transfer_code: null');
  });

  it('a payment whose transfer succeeded behind an unstamped claim: stamp AND settle', async () => {
    const report = await plan(
      {
        payoutPending: [
          payment({ status: 'payout_pending', payout_transfer_code: 'claim:ls_po_abc' }),
        ],
      },
      reader({
        transfer: { found: true, status: 'success', transferCode: 'TRF_9', amountKobo: 400000 },
      }),
    );
    expect(report.findings.map((f) => f.class)).toEqual([
      'payout-transfer-code-not-stamped',
      'payment-payout-succeeded-not-settled',
    ]);
    expect(report.findings[1].proposedRepair).toContain("status: 'paid_out'");
  });

  it('an order at refund_hold the buyer was refunded for: mark it skipped', async () => {
    const report = await plan(
      {
        holds: [order({ payout_status: 'refund_hold', checkout_id: null })],
        payments: { 'pay-1': payment({ status: 'refunded', checkout_id: null }) },
      },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 500000 }] }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['order-refund-hold-refunded']);
    expect(report.findings[0].proposedRepair).toContain("payout_status: 'skipped'");
  });

  it('an order at refund_hold with no refund behind it: give the hold back', async () => {
    const report = await plan(
      {
        holds: [order({ payout_status: 'refund_hold', checkout_id: null })],
        payments: { 'pay-1': payment({ status: 'paid', checkout_id: null }) },
      },
      reader({ refunds: [] }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['order-refund-hold-not-backed']);
    expect(report.findings[0].proposedRepair).toContain("payout_status: 'pending'");
  });
});

describe('the reconciliation planner — what it refuses to decide', () => {
  it('proposes nothing for a candidate whose state has already moved on', async () => {
    const report = await plan(
      {
        refunding: [payment({ status: 'refunded' })],
        paying: [order({ payout_status: 'pending' })],
      },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 1 }] }),
    );
    expect(report.findings).toEqual([]);
    // The rows were still SCANNED — the count is how a reader sees that the
    // query is finding rows even when nothing is proposed.
    expect(report.scanned.refundingPayments).toBe(1);
    expect(report.scanned.payingOrders).toBe(1);
  });

  it('reports Paystack being unreachable and proposes nothing at all', async () => {
    const report = await plan(
      { refunding: [payment()], paying: [order()] },
      reader({ refunds: throws, transfer: throws }),
    );
    expect(report.findings.map((f) => f.class)).toEqual([
      'paystack-unreachable',
      'paystack-unreachable',
    ]);
    expect(report.findings.every((f) => f.proposedRepair === null)).toBe(true);
  });

  it('never proposes a repair in the dangerous direction: we say paid_out, Paystack says failed', async () => {
    const report = await plan(
      {
        paying: [order({ payout_status: 'paid_out' })],
        payoutPending: [payment({ status: 'paid_out', payout_transfer_code: 'TRF_7' })],
      },
      reader({
        transfer: { found: true, status: 'failed', transferCode: 'TRF_7', amountKobo: 400000 },
      }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['needs-human', 'needs-human']);
    expect(report.findings.every((f) => f.proposedRepair === null)).toBe(true);
    expect(report.findings[0].paystackSays).toBe('transfer failed');
  });

  it('refuses to release a claim when a REAL transfer code is stamped and Paystack has no such transfer', async () => {
    const report = await plan(
      { paying: [order({ payout_transfer_code: 'TRF_LIVE' })] },
      reader({ transfer: NOT_FOUND }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['needs-human']);
    expect(report.findings[0].proposedRepair).toBeNull();
  });

  it('leaves a transfer Paystack has accepted and not yet confirmed completely alone', async () => {
    const report = await plan(
      { paying: [order()] },
      reader({
        transfer: { found: true, status: 'pending', transferCode: 'TRF_2', amountKobo: 400000 },
      }),
    );
    expect(report.findings).toEqual([]);
  });

  it('a failed transfer is the transfer.failed webhook\'s to unwind, not this job\'s', async () => {
    const report = await plan(
      { paying: [order()] },
      reader({
        transfer: { found: true, status: 'reversed', transferCode: 'TRF_3', amountKobo: 400000 },
      }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['needs-human']);
    expect(report.findings[0].proposedRepair).toBeNull();
  });

  it('reports a captured charge that never settled, and proposes no repair for it', async () => {
    const report = await plan(
      { unsettled: [payment({ status: 'initialized' })] },
      reader({ charge: { found: true, status: 'success', amountKobo: 500000 } }),
    );
    expect(report.findings.map((f) => f.class)).toEqual(['charge-paid-not-settled']);
    expect(report.findings[0].proposedRepair).toBeNull();
  });

  it('says nothing about an initialized payment Paystack never captured', async () => {
    const report = await plan(
      { unsettled: [payment({ status: 'initialized' })] },
      reader({ charge: { found: false, status: null, amountKobo: null } }),
    );
    expect(report.findings).toEqual([]);
  });

  it('reports the orphan rows without asking Paystack anything', async () => {
    const getTransferByReference = jest.fn();
    const listRefundsForTransaction = jest.fn();
    const verifyCharge = jest.fn();
    const report = await plan(
      { orphans: [payment({ status: 'initialized', order_id: null })] },
      { getTransferByReference, listRefundsForTransaction, verifyCharge },
    );
    expect(report.findings.map((f) => f.class)).toEqual(['orphan-initialized-payment']);
    expect(report.findings[0].proposedRepair).toBeNull();
    expect(getTransferByReference).not.toHaveBeenCalled();
    expect(listRefundsForTransaction).not.toHaveBeenCalled();
    expect(verifyCharge).not.toHaveBeenCalled();
  });

  it('reports a failed candidate query instead of reporting an empty, healthy platform', async () => {
    const base = queries({});
    const failing: ReconcileQueries = {
      ...base,
      listStuckPayingOrders: () => Promise.resolve({ data: null, error: new Error('boom') }),
    };
    const report = await planMarketplaceReconcile(failing, reader(), { now: NOW });
    expect(report.queryErrors).toEqual(['payingOrders']);
    expect(report.findings).toEqual([]);
  });

  it('says when a per-class cap cut the scan short', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      order({ id: `order-${i}`, payout_reference: `ls_po_${i}` }),
    );
    const report = await planMarketplaceReconcile(queries({ paying: rows }), reader(), {
      now: NOW,
      limit: 3,
    });
    expect(report.truncated).toBe(true);
    expect(report.scanned.payingOrders).toBe(3);
  });
});

describe('the reconciliation planner — the rules it must keep', () => {
  it('never proposes a repair for needs-human or paystack-unreachable', async () => {
    const report = await plan(
      {
        refunding: [payment()],
        paying: [order({ payout_transfer_code: 'TRF_LIVE' })],
      },
      reader({ refunds: throws, transfer: NOT_FOUND }),
    );
    for (const finding of report.findings) {
      if (finding.class === 'needs-human' || finding.class === 'paystack-unreachable') {
        expect(finding.proposedRepair).toBeNull();
      }
    }
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('every proposed repair names its compare-and-swap filter', async () => {
    const report = await plan(
      {
        refunding: [payment()],
        paying: [order()],
      },
      reader({
        refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 1 }],
        transfer: { found: true, status: 'success', transferCode: 'TRF_4', amountKobo: 1 },
      }),
    );
    const repairs = report.findings.map((f) => f.proposedRepair).filter(Boolean) as string[];
    expect(repairs.length).toBe(2);
    for (const repair of repairs) expect(repair).toMatch(/WHERE .*(=|IN)/);
  });

  it('carries only ids, state names and amounts — never an email or a token', async () => {
    const report = await plan(
      { refunding: [payment()] },
      reader({ refunds: [{ id: 'rf_1', status: 'processed', amountKobo: 500000 }] }),
    );
    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/sk_(test|live)_/);
  });
});
