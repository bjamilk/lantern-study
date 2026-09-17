/**
 * The manual repair path, against the Phase B test bar (#113).
 *
 * `docs/marketplace-reconcile.md` states the bar and this file is it. Per class:
 * the repair applies; a second apply is a no-op that SAYS so; the state moving
 * on between the plan and the apply refuses; the flag being off refuses;
 * Paystack being unreachable refuses; a wrong phrase refuses; the audit row is
 * written with no secrets; and a cart-shaped row refuses even when an admin
 * names it explicitly.
 *
 * The three claim-release classes carry two more, because they are the ones
 * that could let a second transfer out: a Paystack 5xx or timeout NEVER
 * releases, and a row carrying a real transfer code NEVER releases.
 *
 * The fake Paystack reader is a Proxy that THROWS on any member other than the
 * three reads, so a call that moved money could not be written here even by
 * accident — which is the test-level half of the GET-only rule (the type-level
 * half is that the repair code receives nothing but the reader).
 */
import {
  applyReconcileRepair,
  isRepairEnabled,
  repairFlagName,
  RECONCILE_REPAIR_CONFIRMATION,
  REPAIRABLE_CLASSES,
  type RepairableClass,
  type ReconcileRepairPorts,
} from './marketplaceReconcileRepair';
import type {
  PaystackReconcileReader,
  ReaderCharge,
  ReaderRefund,
  ReaderTransfer,
} from './marketplaceReconcile';
import type {
  ReconcileOrderRow,
  ReconcilePaymentRow,
  RepairResult,
} from './data/marketplaceReconcile';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const STALE = new Date(NOW.getTime() - 120 * 60000).toISOString();
const ACTOR = 'admin-1';

const REFUND: ReaderRefund = { id: 'rf_1', status: 'processed', amountKobo: 500000 };
const TRANSFER_OK: ReaderTransfer = {
  found: true,
  status: 'success',
  transferCode: 'TRF_9',
  amountKobo: 400000,
};
const TRANSFER_PENDING: ReaderTransfer = {
  found: true,
  status: 'pending',
  transferCode: 'TRF_9',
  amountKobo: 400000,
};
const NO_TRANSFER: ReaderTransfer = {
  found: false,
  status: null,
  transferCode: null,
  amountKobo: null,
};
const NO_CHARGE: ReaderCharge = { found: false, status: null, amountKobo: null };

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
    created_at: STALE,
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
    created_at: STALE,
    updated_at: STALE,
    ...over,
  };
}

/** A reader that answers the three reads and throws on anything else. */
function reader(
  answers: {
    transfer?: ReaderTransfer | Error;
    refunds?: ReaderRefund[] | Error;
    charge?: ReaderCharge | Error;
  } = {},
): PaystackReconcileReader {
  const give = <T>(value: T | Error | undefined, fallback: T): Promise<T> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value ?? fallback);
  const impl: PaystackReconcileReader = {
    getTransferByReference: () => give(answers.transfer, NO_TRANSFER),
    listRefundsForTransaction: () => give(answers.refunds, []),
    verifyCharge: () => give(answers.charge, NO_CHARGE),
  };
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof PaystackReconcileReader];
      throw new Error(
        `The reconciliation reader is GET-only; it has no '${String(prop)}'. Nothing here may move money.`,
      );
    },
  });
}

type Writes = Record<string, jest.Mock>;

/** `matched` rows come back from every repair write unless a test says otherwise. */
function writes(matched = 1): Writes {
  const result = (): Promise<RepairResult> =>
    Promise.resolve({
      data: Array.from({ length: matched }, (_, i) => ({ id: `row-${i}` })),
      error: null,
    });
  const names = [
    'stampPaymentRefunded',
    'releasePaymentRefundClaim',
    'markOrderRefundedNotPayable',
    'releaseOrderRefundHold',
    'releaseOrderPayoutClaim',
    'settleOrderPayout',
    'releasePaymentPayoutClaim',
    'stampPaymentTransferCode',
    'settlePaymentPaidOut',
  ];
  return Object.fromEntries(names.map((n) => [n, jest.fn(result)])) as Writes;
}

function ports(input: {
  payment?: ReconcilePaymentRow | null;
  order?: ReconcileOrderRow | null;
  paystack?: PaystackReconcileReader;
  matched?: number;
  audit?: jest.Mock;
}): ReconcileRepairPorts & { writes: Writes; audit: jest.Mock } {
  const ok = <T>(data: T) => Promise.resolve({ data, error: null });
  const w = writes(input.matched ?? 1);
  const audit = input.audit ?? jest.fn(async () => undefined);
  const queries = {
    listStuckRefundingPayments: () => ok([]),
    listStuckPayoutPendingPayments: () => ok([]),
    listOrphanInitializedPayments: () => ok([]),
    listUnsettledInitializedPayments: () => ok([]),
    listStuckPayingOrders: () => ok([]),
    listStuckRefundHoldOrders: () => ok([]),
    getPaymentForReconcile: () => ok(input.payment ?? null),
    getOrderForReconcile: () => ok(input.order ?? null),
    listCheckoutSiblingOrders: () => ok([]),
    ...w,
  };
  return {
    queries: queries as unknown as ReconcileRepairPorts['queries'],
    paystack: input.paystack ?? reader(),
    audit: audit as unknown as ReconcileRepairPorts['audit'] & jest.Mock,
    writes: w,
  } as ReconcileRepairPorts & { writes: Writes; audit: jest.Mock };
}

/** Every repairable class on, unless a test turns one off. */
function allOn(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    (Object.keys(REPAIRABLE_CLASSES) as RepairableClass[]).map((c) => [repairFlagName(c), 'true']),
  );
}

function apply(
  p: ReconcileRepairPorts,
  cls: string,
  ids: { orderId?: string; paymentId?: string },
  over: { phrase?: string | null; env?: NodeJS.ProcessEnv } = {},
) {
  return applyReconcileRepair(
    p,
    {
      class: cls,
      ...ids,
      confirmationPhrase: over.phrase === undefined ? RECONCILE_REPAIR_CONFIRMATION : over.phrase,
      actorId: ACTOR,
    },
    { now: NOW, env: over.env ?? allOn() },
  );
}

/** The nine classes, with the rows and Paystack answers that produce each. */
const CASES: Array<{
  cls: RepairableClass;
  ids: { orderId?: string; paymentId?: string };
  build: () => Parameters<typeof ports>[0];
  write: string;
  /** A row state that makes the finding no longer hold. */
  movedOn: () => Parameters<typeof ports>[0];
  /** The same row, cart-shaped. Undefined where the class cannot be a cart. */
  cart?: () => Parameters<typeof ports>[0];
}> = [
  {
    cls: 'refund-paid-not-stamped',
    ids: { paymentId: 'pay-1' },
    build: () => ({ payment: payment(), paystack: reader({ refunds: [REFUND] }) }),
    write: 'stampPaymentRefunded',
    movedOn: () => ({ payment: payment({ status: 'refunded' }), paystack: reader({ refunds: [REFUND] }) }),
    cart: () => ({
      payment: payment({ checkout_id: 'checkout-1' }),
      paystack: reader({ refunds: [REFUND] }),
    }),
  },
  {
    cls: 'refund-claim-not-backed',
    ids: { paymentId: 'pay-1' },
    build: () => ({ payment: payment(), paystack: reader({ refunds: [] }) }),
    write: 'releasePaymentRefundClaim',
    movedOn: () => ({ payment: payment({ status: 'paid' }), paystack: reader({ refunds: [] }) }),
    cart: () => ({
      payment: payment({ checkout_id: 'checkout-1' }),
      paystack: reader({ refunds: [] }),
    }),
  },
  {
    cls: 'order-refund-hold-refunded',
    ids: { orderId: 'order-1' },
    build: () => ({
      order: order({ payout_status: 'refund_hold' }),
      payment: payment({ status: 'refunded', checkout_id: null }),
      paystack: reader({ refunds: [REFUND] }),
    }),
    write: 'markOrderRefundedNotPayable',
    movedOn: () => ({
      order: order({ payout_status: 'skipped' }),
      payment: payment({ status: 'refunded', checkout_id: null }),
      paystack: reader({ refunds: [REFUND] }),
    }),
    cart: () => ({
      order: order({ payout_status: 'refund_hold' }),
      payment: payment({ status: 'refunded', checkout_id: 'checkout-1' }),
      paystack: reader({ refunds: [REFUND] }),
    }),
  },
  {
    cls: 'order-refund-hold-not-backed',
    ids: { orderId: 'order-1' },
    build: () => ({
      order: order({ payout_status: 'refund_hold' }),
      payment: payment({ status: 'paid', checkout_id: null }),
      paystack: reader({ refunds: [] }),
    }),
    write: 'releaseOrderRefundHold',
    movedOn: () => ({
      order: order({ payout_status: 'pending' }),
      payment: payment({ status: 'paid', checkout_id: null }),
      paystack: reader({ refunds: [] }),
    }),
    cart: () => ({
      order: order({ payout_status: 'refund_hold' }),
      payment: payment({ status: 'paid', checkout_id: 'checkout-1' }),
      paystack: reader({ refunds: [] }),
    }),
  },
  {
    cls: 'order-paying-not-backed',
    ids: { orderId: 'order-1' },
    build: () => ({ order: order(), paystack: reader({ transfer: NO_TRANSFER }) }),
    write: 'releaseOrderPayoutClaim',
    movedOn: () => ({
      order: order({ payout_status: 'pending' }),
      paystack: reader({ transfer: NO_TRANSFER }),
    }),
  },
  {
    cls: 'order-paying-transfer-succeeded',
    ids: { orderId: 'order-1' },
    build: () => ({ order: order(), paystack: reader({ transfer: TRANSFER_OK }) }),
    write: 'settleOrderPayout',
    movedOn: () => ({
      order: order({ payout_status: 'skipped' }),
      paystack: reader({ transfer: TRANSFER_OK }),
    }),
  },
  {
    cls: 'payout-claim-not-backed',
    ids: { paymentId: 'pay-1' },
    build: () => ({
      payment: payment({ status: 'payout_pending', payout_transfer_code: 'claim:ls_po_abc' }),
      paystack: reader({ transfer: NO_TRANSFER }),
    }),
    write: 'releasePaymentPayoutClaim',
    movedOn: () => ({
      payment: payment({ status: 'paid', payout_transfer_code: null }),
      paystack: reader({ transfer: NO_TRANSFER }),
    }),
    cart: () => ({
      payment: payment({
        status: 'payout_pending',
        payout_transfer_code: 'claim:ls_po_abc',
        checkout_id: 'checkout-1',
      }),
      paystack: reader({ transfer: NO_TRANSFER }),
    }),
  },
  {
    cls: 'payout-transfer-code-not-stamped',
    ids: { paymentId: 'pay-1' },
    build: () => ({
      payment: payment({ status: 'payout_pending', payout_transfer_code: 'claim:ls_po_abc' }),
      paystack: reader({ transfer: TRANSFER_PENDING }),
    }),
    write: 'stampPaymentTransferCode',
    movedOn: () => ({
      payment: payment({ status: 'payout_pending', payout_transfer_code: 'TRF_9' }),
      paystack: reader({ transfer: TRANSFER_PENDING }),
    }),
    cart: () => ({
      payment: payment({
        status: 'payout_pending',
        payout_transfer_code: 'claim:ls_po_abc',
        checkout_id: 'checkout-1',
      }),
      paystack: reader({ transfer: TRANSFER_PENDING }),
    }),
  },
  {
    cls: 'payment-payout-succeeded-not-settled',
    ids: { paymentId: 'pay-1' },
    build: () => ({
      payment: payment({ status: 'payout_pending', payout_transfer_code: 'TRF_9' }),
      paystack: reader({ transfer: TRANSFER_OK }),
    }),
    write: 'settlePaymentPaidOut',
    movedOn: () => ({
      payment: payment({ status: 'paid_out', payout_transfer_code: 'TRF_9' }),
      paystack: reader({ transfer: TRANSFER_OK }),
    }),
    cart: () => ({
      payment: payment({
        status: 'payout_pending',
        payout_transfer_code: 'TRF_9',
        checkout_id: 'checkout-1',
      }),
      paystack: reader({ transfer: TRANSFER_OK }),
    }),
  },
];

describe.each(CASES)('repairing $cls', ({ cls, ids, build, write, movedOn, cart }) => {
  it('applies the original write and reports a repair', async () => {
    const p = ports(build());
    const outcome = await apply(p, cls, ids);
    expect(outcome.outcome).toBe('repaired');
    expect(outcome.class).toBe(cls);
    expect(p.writes[write]).toHaveBeenCalledTimes(1);
    // Exactly one write ran: a repair touches one row, by one original write.
    const called = Object.entries(p.writes).filter(([, fn]) => fn.mock.calls.length > 0);
    expect(called.map(([name]) => name)).toEqual([write]);
  });

  it('a second apply is a no-op that says so', async () => {
    // The CAS matches nothing the second time; that must never read as success.
    const p = ports({ ...build(), matched: 0 });
    const outcome = await apply(p, cls, ids);
    expect(outcome.outcome).toBe('no_op');
    expect(outcome.message).toMatch(/already repaired|state moved on/i);
    expect(outcome.after).toEqual({});
  });

  it('refuses when the state moved on between the plan and the apply', async () => {
    const p = ports(movedOn());
    await expect(apply(p, cls, ids)).rejects.toMatchObject({ statusCode: 409 });
    expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('refuses when the class flag is off, naming the flag', async () => {
    const p = ports(build());
    const env = allOn();
    delete env[repairFlagName(cls)];
    await expect(apply(p, cls, ids, { env })).rejects.toMatchObject({ statusCode: 403 });
    await expect(apply(p, cls, ids, { env })).rejects.toThrow(repairFlagName(cls));
    expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('refuses when Paystack is unreachable, and writes nothing', async () => {
    const unreachable = reader({
      transfer: new Error('Paystack request failed (503)'),
      refunds: new Error('Paystack request failed (503)'),
    });
    const p = ports({ ...build(), paystack: unreachable });
    await expect(apply(p, cls, ids)).rejects.toMatchObject({ statusCode: 503 });
    expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('refuses a wrong confirmation phrase before reading anything', async () => {
    const p = ports(build());
    await expect(apply(p, cls, ids, { phrase: 'yes please' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(apply(p, cls, ids, { phrase: null })).rejects.toMatchObject({ statusCode: 400 });
    expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('writes one audit row, with the before and after and no secrets', async () => {
    const audit = jest.fn(async () => undefined);
    const p = ports({ ...build(), audit });
    await apply(p, cls, ids);
    expect(audit).toHaveBeenCalledTimes(1);
    const [entry] = audit.mock.calls[0] as unknown as [Record<string, any>];
    expect(entry.action).toBe('marketplace_reconcile_repair');
    expect(entry.actorId).toBe(ACTOR);
    expect(entry.metadata.class).toBe(cls);
    expect(entry.metadata.outcome).toBe('repaired');
    expect(entry.metadata).toHaveProperty('before');
    expect(entry.metadata).toHaveProperty('after');
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/sk_(test|live)_/);
  });

  if (cart) {
    it('refuses a cart-shaped row even when an admin names it', async () => {
      const p = ports(cart());
      await expect(apply(p, cls, ids)).rejects.toMatchObject({ statusCode: 409 });
      expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    });
  }
});

describe('the claim-release classes carry two more rails', () => {
  const RELEASES: Array<{
    cls: RepairableClass;
    ids: { orderId?: string; paymentId?: string };
    /** The same row, but carrying a real transfer code rather than a claim. */
    stamped: () => Parameters<typeof ports>[0];
    /** The same row, with Paystack failing rather than answering 404. */
    blip: () => Parameters<typeof ports>[0];
  }> = [
    {
      cls: 'order-refund-hold-not-backed',
      ids: { orderId: 'order-1' },
      stamped: () => ({
        order: order({ payout_status: 'refund_hold', payout_transfer_code: 'TRF_LIVE' }),
        payment: payment({ status: 'paid', checkout_id: null }),
        paystack: reader({ refunds: [REFUND] }),
      }),
      blip: () => ({
        order: order({ payout_status: 'refund_hold' }),
        payment: payment({ status: 'paid', checkout_id: null }),
        paystack: reader({ refunds: new Error('Paystack request failed (500)') }),
      }),
    },
    {
      cls: 'order-paying-not-backed',
      ids: { orderId: 'order-1' },
      stamped: () => ({
        order: order({ payout_transfer_code: 'TRF_LIVE' }),
        paystack: reader({ transfer: NO_TRANSFER }),
      }),
      blip: () => ({
        order: order(),
        paystack: reader({ transfer: new Error('socket hang up') }),
      }),
    },
    {
      cls: 'payout-claim-not-backed',
      ids: { paymentId: 'pay-1' },
      stamped: () => ({
        payment: payment({ status: 'payout_pending', payout_transfer_code: 'TRF_LIVE' }),
        paystack: reader({ transfer: NO_TRANSFER }),
      }),
      blip: () => ({
        payment: payment({ status: 'payout_pending', payout_transfer_code: 'claim:ls_po_abc' }),
        paystack: reader({ transfer: new Error('socket hang up') }),
      }),
    },
  ];

  it.each(RELEASES)('$cls never releases on a Paystack failure', async ({ cls, ids, blip }) => {
    const p = ports(blip());
    await expect(apply(p, cls, ids)).rejects.toMatchObject({ statusCode: 503 });
    expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it.each(RELEASES)(
    '$cls never releases a row carrying a real transfer code',
    async ({ cls, ids, stamped }) => {
      const p = ports(stamped());
      await expect(apply(p, cls, ids)).rejects.toMatchObject({ statusCode: 409 });
      expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    },
  );
});

describe('the rules that hold for every class', () => {
  it('has no repair path at all for the report-only classes', async () => {
    for (const cls of [
      'refund-claim-sibling-open',
      'charge-paid-not-settled',
      'orphan-initialized-payment',
      'needs-human',
      'paystack-unreachable',
    ]) {
      expect(Object.keys(REPAIRABLE_CLASSES)).not.toContain(cls);
      const p = ports({ payment: payment() });
      await expect(apply(p, cls, { paymentId: 'pay-1' })).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(Object.values(p.writes).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    }
  });

  it('every flag defaults OFF, and only an explicit truth turns one on', () => {
    for (const cls of Object.keys(REPAIRABLE_CLASSES) as RepairableClass[]) {
      const flag = repairFlagName(cls);
      expect(flag).toMatch(/^MARKETPLACE_RECONCILE_REPAIR_[A-Z_]+$/);
      expect(isRepairEnabled(cls, {})).toBe(false);
      expect(isRepairEnabled(cls, { [flag]: '' })).toBe(false);
      expect(isRepairEnabled(cls, { [flag]: 'false' })).toBe(false);
      expect(isRepairEnabled(cls, { [flag]: 'off' })).toBe(false);
      expect(isRepairEnabled(cls, { [flag]: 'true' })).toBe(true);
      expect(isRepairEnabled(cls, { [flag]: 'on' })).toBe(true);
      expect(isRepairEnabled(cls, { [flag]: '1' })).toBe(true);
    }
  });

  it('answers 404 for a row that does not exist', async () => {
    const missingPayment = ports({ payment: null });
    await expect(
      apply(missingPayment, 'refund-paid-not-stamped', { paymentId: 'nope' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const missingOrder = ports({ order: null });
    await expect(
      apply(missingOrder, 'order-paying-not-backed', { orderId: 'nope' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('requires the id the class is named by', async () => {
    const p = ports({ payment: payment() });
    await expect(apply(p, 'refund-paid-not-stamped', { orderId: 'order-1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(apply(p, 'order-paying-not-backed', { paymentId: 'pay-1' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('the Paystack reader is GET-only: anything else throws', () => {
    const r = reader() as unknown as Record<string, unknown>;
    expect(typeof r.getTransferByReference).toBe('function');
    expect(typeof r.listRefundsForTransaction).toBe('function');
    expect(typeof r.verifyCharge).toBe('function');
    for (const forbidden of [
      'initiatePaystackTransfer',
      'refundPaystackTransaction',
      'initializePaystackTransaction',
      'createPaystackTransferRecipient',
    ]) {
      expect(() => r[forbidden]).toThrow(/GET-only/);
    }
  });

  it('no reconcile module imports a Paystack call that moves money', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      'marketplaceReconcile.ts',
      'marketplaceReconcileRepair.ts',
      path.join('data', 'marketplaceReconcile.ts'),
    ];
    // `createPaystackReconcileReader` is the one place the real client is
    // touched at all, and it reaches only the three reads.
    const moneyMovers = [
      'initiatePaystackTransfer',
      'refundPaystackTransaction',
      'initializePaystackTransaction',
      'createPaystackTransferRecipient',
    ];
    for (const file of files) {
      const source: string = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const mover of moneyMovers) {
        expect(source).not.toContain(mover);
      }
    }
  });
});
