/**
 * Security-focused unit tests for Paystack marketplace settlement.
 * Mocks Supabase + Paystack so we can assert authorization and amount checks.
 */

const mockVerifyPaystackTransaction = jest.fn();
const mockInitiatePaystackTransfer = jest.fn();
const mockVerifyPaystackSignature = jest.fn();

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: jest.fn(),
  initiatePaystackTransfer: (...args: unknown[]) => mockInitiatePaystackTransfer(...args),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: (...args: unknown[]) => mockVerifyPaystackSignature(...args),
  verifyPaystackTransaction: (...args: unknown[]) => mockVerifyPaystackTransaction(...args),
}));

const mockGetOrderById = jest.fn();
const mockReleaseEscrow = jest.fn();
const mockNotifyOrderParty = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = jest.fn();
    releaseEscrow = mockReleaseEscrow;
    notifyOrderParty = mockNotifyOrderParty;
  }
  return {
    MarketplaceOrdersService,
    invalidateSellerAnalyticsCache: jest.fn(),
    resolveEffectivePrice: () => 1000,
  };
});

function chainable(result: { data: unknown; error?: unknown | null }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.in = self;
  api.or = self;
  api.update = self;
  api.insert = self;
  api.maybeSingle = async () => result;
  api.single = async () => result;
  return api;
}

describe('marketplacePayments security', () => {
  beforeEach(() => {
    process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
  });

  it('webhook handler rejects invalid signatures (unsigned)', async () => {
    mockVerifyPaystackSignature.mockReturnValue(false);
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({
      getClient: () => ({ from: () => chainable({ data: null }) }),
    } as any);

    await expect(svc.handleWebhook('{"event":"charge.success"}', undefined)).rejects.toThrow(
      /Invalid Paystack webhook signature/i
    );
    expect(mockVerifyPaystackSignature).toHaveBeenCalled();
  });

  it('rejects verify when Paystack amount does not match server total_charged_kobo', async () => {
    const payment = {
      id: 'pay_1',
      buyer_id: 'buyer_1',
      seller_id: 'seller_1',
      order_id: 'ord_1',
      paystack_reference: 'ls_buy_ref',
      status: 'initialized',
      total_charged_kobo: 105_000,
      item_amount_kobo: 100_000,
      service_fee_kobo: 5_000,
    };

    const supabaseService = {
      getClient: () => ({
        from: () => chainable({ data: payment, error: null }),
      }),
    } as any;

    mockVerifyPaystackTransaction.mockResolvedValue({
      status: 'success',
      reference: 'ls_buy_ref',
      amount: 99_000, // tampered / client-supplied amount
      currency: 'NGN',
      id: 1,
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService(supabaseService);

    await expect(svc.verifyPaymentByReference('ls_buy_ref', 'buyer_1')).rejects.toThrow(
      /amount mismatch/i
    );
  });

  it('rejects confirm/payout when actor is not the buyer', async () => {
    mockGetOrderById.mockResolvedValue({
      id: 'ord_1',
      buyer_id: 'buyer_1',
      seller_id: 'seller_1',
      payment_id: 'pay_1',
      status: 'ready_for_pickup',
      amount: 1000,
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({
      getClient: () => ({ from: () => chainable({ data: null }) }),
    } as any);

    await expect(svc.payoutOnConfirmReceived('ord_1', 'seller_1')).rejects.toThrow(
      /Only the buyer can confirm receipt/i
    );
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalled();
  });

  it('double payout is a no-op when payment already paid_out', async () => {
    const payment = {
      id: 'pay_1',
      status: 'paid_out',
      item_amount_kobo: 100_000,
      total_charged_kobo: 105_000,
    };
    mockGetOrderById.mockResolvedValue({
      id: 'ord_1',
      buyer_id: 'buyer_1',
      seller_id: 'seller_1',
      payment_id: 'pay_1',
      status: 'ready_for_pickup',
      amount: 1000,
    });
    mockReleaseEscrow.mockResolvedValue({ id: 'ord_1', status: 'completed' });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({
      getClient: () => ({ from: () => chainable({ data: payment, error: null }) }),
    } as any);

    await svc.payoutOnConfirmReceived('ord_1', 'buyer_1');
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalled();
    expect(mockReleaseEscrow).toHaveBeenCalledWith('ord_1', 'buyer_1');
  });
});

/**
 * Hotfix H4: the money-losing races.
 *
 * Every test below models one way the old code paid a seller twice, stranded a
 * paid order, or refunded money that had already left the account.
 */

type Op = { fn: string; args: unknown[] };
type Call = { table: string; ops: Op[]; terminal: string };

/**
 * Chain stub that records the whole filter chain, so a test can assert on a
 * compare-and-set (which filters it used) and not merely on the payload.
 */
function scriptedDb(resolve: (call: Call) => { data: unknown; error?: unknown } | undefined) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'neq', 'in', 'or', 'is', 'not', 'update', 'insert', 'delete', 'order', 'limit']) {
        chain[fn] = (...args: unknown[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call) ?? { data: null, error: null });
      };
      chain.single = () => settle('single');
      chain.maybeSingle = () => settle('maybeSingle');
      chain.then = (ok: any, err: any) => settle('then').then(ok, err);
      return chain;
    },
  };
  return { client, calls };
}

const has = (call: Call, fn: string, ...args: unknown[]) =>
  call.ops.some((op) => op.fn === fn && args.every((a, i) => op.args[i] === a));

const payload = (call: Call, fn: string) =>
  (call.ops.find((op) => op.fn === fn)?.args[0] ?? {}) as Record<string, unknown>;

const CHECKOUT_PAYMENT = {
  id: 'pay_c1',
  checkout_id: 'chk_1',
  order_id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  status: 'paid',
  currency: 'NGN',
  total_charged_kobo: 100_000,
  item_amount_kobo: 100_000,
  seller_payout_kobo: 95_000,
  metadata: {},
};

const ACTIVE_PROFILE = { paystack_recipient_code: 'RCP_1', status: 'active' };

const transferSellerPayout = (svc: unknown, orderId = 'ord_1', payment: unknown = CHECKOUT_PAYMENT) =>
  (svc as any).transferSellerPayout(orderId, 'seller_1', payment);

describe('per-order payout is claimed before money moves (finding 1)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_1',
      status: 'pending',
      reference: 'ls_po_deterministic',
    });
  });

  it('claims the order with a compare-and-set on payout_status before transferring', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000, payout_status: 'paying' }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(transferSellerPayout(svc)).resolves.toBe('transferred');

    const claim = calls.find(
      (c) => c.table === 'marketplace_orders' && (payload(c, 'update') as any).payout_status === 'paying',
    );
    expect(claim).toBeDefined();
    // The CAS: only a row still 'pending' may be claimed.
    expect(has(claim!, 'eq', 'payout_status', 'pending')).toBe(true);
    expect(mockInitiatePaystackTransfer).toHaveBeenCalledTimes(1);
  });

  it('a second concurrent payout for the same order loses the claim and never transfers', async () => {
    let claimsGranted = 0;
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        // Only the first CAS finds a 'pending' row; the loser gets no row back.
        claimsGranted += 1;
        return claimsGranted === 1
          ? { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null }
          : { data: null, error: null };
      }
      if (call.table === 'marketplace_orders' && has(call, 'select', 'payout_status')) {
        return { data: { payout_status: 'paying' }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    const [first, second] = await Promise.all([transferSellerPayout(svc), transferSellerPayout(svc)]);
    expect([first, second].sort()).toEqual(['in_flight', 'transferred']);
    expect(mockInitiatePaystackTransfer).toHaveBeenCalledTimes(1);
  });

  /**
   * REPLACED (G3 · H1). The old version asserted that the reference is a
   * function of the order id ALONE, which is precisely the defect: Paystack
   * refuses a reference it has already seen, so the retry that
   * transfer.failed / transfer.reversed exists to enable could never succeed
   * and the seller was never paid for that order. The guarantee that matters is
   * narrower — deterministic per (order, ATTEMPT) — and that is what is asserted
   * now.
   */
  it('uses a transfer reference derived from the order id AND the attempt', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000, payout_attempt: 0 }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await transferSellerPayout(svc);

    expect(mockInitiatePaystackTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: orderPayoutReference('ord_1', 0) }),
    );
    // Deterministic per attempt: a duplicate of the SAME attempt still collides
    // at Paystack, which is the last line of defence against a double pay.
    expect(orderPayoutReference('ord_1', 0)).toBe(orderPayoutReference('ord_1', 0));
    expect(orderPayoutReference('ord_1', 2)).toBe(orderPayoutReference('ord_1', 2));
    expect(orderPayoutReference('ord_1', 0)).not.toBe(orderPayoutReference('ord_2', 0));
    // ...and a burnt attempt yields a NEW reference, so a reversed payout is
    // retryable instead of permanently stuck.
    expect(orderPayoutReference('ord_1', 1)).not.toBe(orderPayoutReference('ord_1', 0));
    // Attempt 0 keeps the original spelling, so a payout in flight across the
    // deploy still matches its stored reference.
    expect(orderPayoutReference('ord_1', 0)).toMatch(/^ls_po_[0-9a-f]{32}$/);
  });

  it('a retry after a reversal sends the NEXT attempt reference, not the burnt one', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        // The row a transfer.reversed left behind: back to pending, attempt bumped.
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000, payout_attempt: 1 }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await transferSellerPayout(svc);

    expect(mockInitiatePaystackTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: orderPayoutReference('ord_1', 1) }),
    );
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalledWith(
      expect.objectContaining({ reference: orderPayoutReference('ord_1', 0) }),
    );
  });

  it('a refund hold on the order blocks the payout outright (H3)', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: null, error: null }; // the CAS finds no 'pending' row
      }
      if (call.table === 'marketplace_orders' && has(call, 'select', 'payout_status')) {
        return { data: { payout_status: 'refund_hold' }, error: null };
      }
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(transferSellerPayout(svc)).rejects.toThrow(/refund is in progress/i);
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalled();
  });

  it('rolls the claim back to pending when the transfer call fails', async () => {
    mockInitiatePaystackTransfer.mockRejectedValue(new Error('Paystack balance too low'));
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(transferSellerPayout(svc)).rejects.toThrow(/balance too low/i);

    const rollback = calls.find(
      (c) => c.table === 'marketplace_orders' && (payload(c, 'update') as any).payout_status === 'pending',
    );
    expect(rollback).toBeDefined();
    expect((payload(rollback!, 'update') as any).payout_failed_reason).toMatch(/balance too low/i);
    // Never marked paid out.
    expect(
      calls.some((c) => (payload(c, 'update') as any).payout_status === 'paid_out'),
    ).toBe(false);
  });
});

describe('webhook dedupe is two-phase (finding 2)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
  });

  const EVENT = JSON.stringify({
    event: 'transfer.failed',
    data: { id: 77, transfer_code: 'TRF_DEAD' },
  });

  it('claims the event unprocessed and stamps processed_at only after handling', async () => {
    const { client, calls } = scriptedDb(() => ({ data: null, error: null }));
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.handleWebhook(EVENT, 'sig')).resolves.toEqual(
      expect.objectContaining({ duplicate: false }),
    );

    const claim = calls.find((c) => c.table === 'paystack_webhook_events' && has(c, 'insert'));
    expect((payload(claim!, 'insert') as any).processed_at).toBeNull();
    const stamp = calls.find((c) => c.table === 'paystack_webhook_events' && has(c, 'update'));
    expect((payload(stamp!, 'update') as any).processed_at).toEqual(expect.any(String));
    // The stamp comes after the work, not before it.
    expect(calls.indexOf(stamp!)).toBeGreaterThan(
      calls.findIndex((c) => c.table === 'marketplace_payments'),
    );
  });

  it('re-processes a retry whose previous attempt died before stamping processed_at', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'paystack_webhook_events' && has(call, 'insert')) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      if (call.table === 'paystack_webhook_events' && has(call, 'select')) {
        // The claim exists but was never completed.
        return { data: { event_key: 'transfer.failed:77', processed_at: null }, error: null };
      }
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    const result = await svc.handleWebhook(EVENT, 'sig');
    expect(result).toEqual(expect.objectContaining({ duplicate: false }));
    // It actually did the work rather than short-circuiting.
    expect(calls.some((c) => c.table === 'marketplace_payments')).toBe(true);
  });

  it('still short-circuits a genuine duplicate (processed_at already stamped)', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'paystack_webhook_events' && has(call, 'insert')) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      if (call.table === 'paystack_webhook_events' && has(call, 'select')) {
        return {
          data: { event_key: 'transfer.failed:77', processed_at: '2026-09-15T10:00:00.000Z' },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.handleWebhook(EVENT, 'sig')).resolves.toEqual({ ok: true, duplicate: true });
    expect(calls.some((c) => c.table === 'marketplace_payments')).toBe(false);
  });
});

describe('a failed transfer clears the in-flight code (finding 3)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
  });

  it.each(['transfer.failed', 'transfer.reversed'])(
    '%s nulls payout_transfer_code so the next payout is not mistaken for one in flight',
    async (event) => {
      const { client, calls } = scriptedDb(() => ({ data: null, error: null }));
      const { MarketplacePaymentsService } = await import('./marketplacePayments');
      const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

      await svc.handleWebhook(
        JSON.stringify({ event, data: { id: 5, transfer_code: 'TRF_DEAD' } }),
        'sig',
      );

      const reset = calls.find(
        (c) => c.table === 'marketplace_payments' && (payload(c, 'update') as any).status === 'paid',
      );
      expect(reset).toBeDefined();
      expect((payload(reset!, 'update') as any).payout_transfer_code).toBeNull();
      expect((payload(reset!, 'update') as any).payout_failed_reason).toBe(`paystack_${event}`);
    },
  );
});

describe('refund respects the per-order payout state (finding 4)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
  });

  const CART_BUYER_ORDER = {
    id: 'ord_1',
    buyer_id: 'buyer_1',
    seller_id: 'seller_1',
    payment_id: 'pay_c1',
    status: 'paid',
    amount: 1000,
  };

  it.each(['paid_out', 'paying'])(
    'refuses a unified-checkout refund when the order payout is %s, even though the payment still reads paid',
    async (orderPayoutStatus) => {
      mockGetOrderById.mockResolvedValue(CART_BUYER_ORDER);
      const { client } = scriptedDb((call) => {
        if (call.table === 'marketplace_payments') return { data: CHECKOUT_PAYMENT, error: null };
        // The refund's own CAS (pending -> refund_hold) finds nothing...
        if (call.table === 'marketplace_orders' && has(call, 'update')) {
          return { data: null, error: null };
        }
        // ...and the row says why.
        if (call.table === 'marketplace_orders') {
          return { data: { payout_status: orderPayoutStatus }, error: null };
        }
        return { data: null, error: null };
      });

      const { MarketplacePaymentsService } = await import('./marketplacePayments');
      const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

      await expect(svc.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(
        /after seller payout/i,
      );
      const { refundPaystackTransaction } = await import('./paystack');
      expect(refundPaystackTransaction).not.toHaveBeenCalled();
    },
  );

  /**
   * REPLACED (G3 · H3). The old version only proved that a refund runs when a
   * plain READ of payout_status says 'pending' — the read-then-act race itself:
   * the payout job could CAS pending -> paying immediately afterwards and
   * transfer, and the refund would go ahead anyway. It now asserts the CLAIM.
   */
  it('takes a refund_hold claim on the order before refunding, so a payout cannot start', async () => {
    mockGetOrderById.mockResolvedValue(CART_BUYER_ORDER);
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') return { data: CHECKOUT_PAYMENT, error: null };
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: { id: 'ord_1' }, error: null };
      }
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { refundPaystackTransaction } = await import('./paystack');
    (refundPaystackTransaction as jest.Mock).mockResolvedValue({ id: 'rf_1', status: 'processed' });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.refundPaymentForOrder('ord_1', 'buyer_1')).resolves.toBeUndefined();
    expect(refundPaystackTransaction).toHaveBeenCalled();

    const hold = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'refund_hold',
    );
    expect(hold).toBeDefined();
    // The CAS: only a row still 'pending' may be held — the same slot the
    // payout CAS competes for.
    expect(has(hold!, 'eq', 'payout_status', 'pending')).toBe(true);
    expect(calls.indexOf(hold!)).toBeLessThan(
      calls.findIndex((c) => c.table === 'marketplace_payments' && has(c, 'update')),
    );
    // Once the buyer has their money back the order must never pay out.
    const done = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'skipped',
    );
    expect(done).toBeDefined();
    expect(has(done!, 'eq', 'payout_status', 'refund_hold')).toBe(true);
  });

  it('refuses when another refund already holds the order (H3)', async () => {
    mockGetOrderById.mockResolvedValue(CART_BUYER_ORDER);
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') return { data: CHECKOUT_PAYMENT, error: null };
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: null, error: null };
      }
      if (call.table === 'marketplace_orders') {
        return { data: { payout_status: 'refund_hold' }, error: null };
      }
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(svc.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(
      /already in progress/i,
    );
    const { refundPaystackTransaction } = await import('./paystack');
    expect(refundPaystackTransaction).not.toHaveBeenCalled();
  });

  it('gives the hold back when Paystack refuses the refund, so a retry can run', async () => {
    mockGetOrderById.mockResolvedValue(CART_BUYER_ORDER);
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') return { data: CHECKOUT_PAYMENT, error: null };
      if (call.table === 'marketplace_orders' && has(call, 'update')) {
        return { data: { id: 'ord_1' }, error: null };
      }
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });
    const { refundPaystackTransaction } = await import('./paystack');
    (refundPaystackTransaction as jest.Mock).mockRejectedValue(new Error('Paystack refused'));

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(svc.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(/refused/i);

    const release = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'pending',
    );
    expect(release).toBeDefined();
    expect(has(release!, 'eq', 'payout_status', 'refund_hold')).toBe(true);
    const unclaim = calls.find(
      (c) =>
        c.table === 'marketplace_payments' && (payload(c, 'update') as any).status === 'paid',
    );
    expect(unclaim).toBeDefined();
    expect(has(unclaim!, 'eq', 'status', 'refunding')).toBe(true);
  });
});

/**
 * G3 · H2: two refunds must not both reach Paystack.
 *
 * `services/paystack.ts` sends no idempotency key with a refund, so nothing
 * downstream catches a duplicate: a buyer double-tapping cancel, or a
 * buyer-cancel racing an admin refund, were refunded twice.
 */
describe('refund is compare-and-set claimed (H2)', () => {
  const SOLO_ORDER = {
    id: 'ord_solo',
    buyer_id: 'buyer_1',
    seller_id: 'seller_1',
    payment_id: 'pay_solo',
    status: 'paid',
    amount: 1000,
  };
  const SOLO_PAID = {
    id: 'pay_solo',
    checkout_id: null,
    order_id: 'ord_solo',
    buyer_id: 'buyer_1',
    seller_id: 'seller_1',
    status: 'paid',
    currency: 'NGN',
    total_charged_kobo: 100_000,
    item_amount_kobo: 100_000,
    seller_payout_kobo: 95_000,
    metadata: {},
  };

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockGetOrderById.mockResolvedValue(SOLO_ORDER);
  });

  it('claims paid -> refunding before calling Paystack, and only then writes refunded', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        return { data: { id: 'pay_solo' }, error: null };
      }
      if (call.table === 'marketplace_payments') return { data: SOLO_PAID, error: null };
      return { data: null, error: null };
    });
    const { refundPaystackTransaction } = await import('./paystack');
    (refundPaystackTransaction as jest.Mock).mockResolvedValue({ id: 'rf_9', status: 'processed' });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(svc.refundPaymentForOrder('ord_solo', 'buyer_1')).resolves.toBeUndefined();

    const claim = calls.find(
      (c) =>
        c.table === 'marketplace_payments' &&
        (payload(c, 'update') as any).status === 'refunding',
    );
    expect(claim).toBeDefined();
    expect(has(claim!, 'eq', 'status', 'paid')).toBe(true);
    const settle = calls.find(
      (c) =>
        c.table === 'marketplace_payments' &&
        (payload(c, 'update') as any).status === 'refunded',
    );
    expect(settle).toBeDefined();
    expect(has(settle!, 'eq', 'status', 'refunding')).toBe(true);
    expect((payload(settle!, 'update') as any).refund_reference).toBe('rf_9');
  });

  it('the loser of the claim never reaches Paystack', async () => {
    let claimsGranted = 0;
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        claimsGranted += 1;
        return claimsGranted === 1
          ? { data: { id: 'pay_solo' }, error: null }
          : { data: null, error: null };
      }
      if (call.table === 'marketplace_payments') return { data: SOLO_PAID, error: null };
      return { data: null, error: null };
    });
    const { refundPaystackTransaction } = await import('./paystack');
    (refundPaystackTransaction as jest.Mock).mockResolvedValue({ id: 'rf_9', status: 'processed' });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    const results = await Promise.allSettled([
      svc.refundPaymentForOrder('ord_solo', 'buyer_1'),
      svc.refundPaymentForOrder('ord_solo', 'buyer_1'),
    ]);

    expect(refundPaystackTransaction).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejection.reason?.message)).toMatch(/already in progress/i);
  });

  it('refuses outright when the row is already held as refunding', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') {
        return { data: { ...SOLO_PAID, status: 'refunding' }, error: null };
      }
      return { data: null, error: null };
    });
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(svc.refundPaymentForOrder('ord_solo', 'buyer_1')).rejects.toThrow(
      /already in progress/i,
    );
    const { refundPaystackTransaction } = await import('./paystack');
    expect(refundPaystackTransaction).not.toHaveBeenCalled();
  });

  it('a payout cannot start on a payment held for refund', async () => {
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({
      getClient: () => scriptedDb(() => ({ data: null, error: null })).client,
    } as any);
    await expect(
      transferSellerPayout(svc, 'ord_solo', { ...SOLO_PAID, status: 'refunding' }),
    ).rejects.toThrow(/cannot be paid out/i);
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalled();
  });
});

describe('multi-order fulfilment resumes (finding 5)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
  });

  it('re-runs the order loop for a payment already marked paid, touching only unfulfilled orders', async () => {
    const orders = [
      // The first order settled on the attempt that crashed.
      { id: 'ord_1', listing_id: 'lst_1', buyer_id: 'buyer_1', seller_id: 'seller_1', status: 'paid' },
      // These two never got past awaiting_payment.
      { id: 'ord_2', listing_id: 'lst_2', buyer_id: 'buyer_1', seller_id: 'seller_2', status: 'awaiting_payment' },
      { id: 'ord_3', listing_id: 'lst_3', buyer_id: 'buyer_1', seller_id: 'seller_3', status: 'awaiting_payment' },
      // Cancelled orders are terminal and must stay untouched.
      { id: 'ord_4', listing_id: 'lst_4', buyer_id: 'buyer_1', seller_id: 'seller_4', status: 'cancelled' },
    ];
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') return { data: CHECKOUT_PAYMENT, error: null };
      if (call.table === 'marketplace_orders' && call.terminal === 'then') {
        return { data: orders, error: null };
      }
      if (call.table === 'marketplace_listings') return { data: { listing_kind: 'textbook' }, error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    (svc as any).orders.stampOrderPaidAt = jest.fn(async () => {});

    await svc.markPaymentPaid('pay_c1', 'txn_1', '2026-09-15T10:00:00.000Z');

    const flips = calls.filter(
      (c) => c.table === 'marketplace_orders' && (payload(c, 'update') as any).status === 'paid',
    );
    const flipped = flips.flatMap((c) =>
      c.ops.filter((op) => op.fn === 'eq' && op.args[0] === 'id').map((op) => op.args[1]),
    );
    expect(flipped.sort()).toEqual(['ord_2', 'ord_3']);
    // The already-paid order is not re-notified; the cancelled one is untouched.
    const notified = mockNotifyOrderParty.mock.calls.map((c: unknown[]) => (c[1] as any).data.orderId);
    expect(new Set(notified)).toEqual(new Set(['ord_2', 'ord_3']));
  });
});

/**
 * Hotfix H4b: the residual money holes H4 left behind.
 */

describe('a cart payout records which transfer paid it (H4b · 1)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_CART',
      status: 'pending',
      reference: 'ls_po_ord_1',
    });
  });

  const cartDb = () =>
    scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_status', 'pending')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

  it('stamps payout_transfer_code and payout_reference on the order row', async () => {
    const { client, calls } = cartDb();
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(transferSellerPayout(svc)).resolves.toBe('transferred');

    const stamp = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_transfer_code === 'TRF_CART',
    );
    expect(stamp).toBeDefined();
    expect((payload(stamp!, 'update') as any).payout_reference).toBe('ls_po_ord_1');
    expect(has(stamp!, 'eq', 'id', 'ord_1')).toBe(true);
  });

  it('does not settle the order while the transfer is still pending at Paystack', async () => {
    const { client, calls } = cartDb();
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await transferSellerPayout(svc);

    expect(
      calls.some((c) => (payload(c, 'update') as any).payout_status === 'paid_out'),
    ).toBe(false);
  });

  it('settles immediately when Paystack answers success outright', async () => {
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_CART',
      status: 'success',
      reference: 'ls_po_ord_1',
    });
    const { client, calls } = cartDb();
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await transferSellerPayout(svc);

    expect(
      calls.some((c) => (payload(c, 'update') as any).payout_status === 'paid_out'),
    ).toBe(true);
  });

  it.each(['transfer.failed', 'transfer.reversed'])(
    '%s un-settles the order the transfer code belongs to, so returned money is not read as paid',
    async (event) => {
      const { client, calls } = scriptedDb((call) => {
        if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_transfer_code', 'TRF_CART')) {
          return { data: { id: 'ord_1', checkout_id: 'chk_1', payment_id: 'pay_c1' }, error: null };
        }
        return { data: null, error: null };
      });
      const { MarketplacePaymentsService } = await import('./marketplacePayments');
      const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

      await svc.handleWebhook(
        JSON.stringify({ event, data: { id: 9, transfer_code: 'TRF_CART' } }),
        'sig',
      );

      const unwind = calls.find(
        (c) =>
          c.table === 'marketplace_orders' &&
          (payload(c, 'update') as any).payout_status === 'pending',
      );
      expect(unwind).toBeDefined();
      expect((payload(unwind!, 'update') as any).payout_transfer_code).toBeNull();
      expect((payload(unwind!, 'update') as any).payout_failed_reason).toBe(`paystack_${event}`);
      // A payout that already reached paid_out must be reversible too.
      expect(
        unwind!.ops.some(
          (op) =>
            op.fn === 'in' &&
            op.args[0] === 'payout_status' &&
            (op.args[1] as string[]).includes('paid_out'),
        ),
      ).toBe(true);
    },
  );
});

describe('transfer.success matches the payout reference, not the charge reference (H4b · 2)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
  });

  it('finds the payment by metadata.payoutReference when the event carries no transfer_code', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (
        call.table === 'marketplace_payments' &&
        has(call, 'eq', 'metadata->>payoutReference', 'ls_po_ord_1')
      ) {
        return { data: { ...CHECKOUT_PAYMENT, status: 'payout_pending' }, error: null };
      }
      return { data: null, error: null };
    });
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await svc.handleWebhook(
      JSON.stringify({ event: 'transfer.success', data: { id: 11, reference: 'ls_po_ord_1' } }),
      'sig',
    );

    // The charge reference column is never used to match a transfer.
    expect(calls.some((c) => has(c, 'eq', 'paystack_reference', 'ls_po_ord_1'))).toBe(false);
    expect(
      calls.some(
        (c) =>
          c.table === 'marketplace_payments' &&
          (payload(c, 'update') as any).status === 'paid_out',
      ),
    ).toBe(true);
  });

  it('falls through to the order row for a cart payout, and builds no .or() filter', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_transfer_code', 'TRF_CART')) {
        return { data: { id: 'ord_1', checkout_id: 'chk_1', payment_id: 'pay_c1' }, error: null };
      }
      if (call.table === 'marketplace_orders' && call.terminal === 'then') {
        return { data: [{ id: 'ord_1', status: 'completed', payout_status: 'paid_out' }], error: null };
      }
      return { data: null, error: null };
    });
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await svc.handleWebhook(
      JSON.stringify({
        event: 'transfer.success',
        data: { id: 12, transfer_code: 'TRF_CART', reference: 'ls_po_ord_1' },
      }),
      'sig',
    );

    const settle = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'paid_out',
    );
    expect(settle).toBeDefined();
    expect(has(settle!, 'eq', 'id', 'ord_1')).toBe(true);
    // No PostgREST .or() string is ever built from webhook-controlled text.
    expect(calls.some((c) => c.ops.some((op) => op.fn === 'or'))).toBe(false);
  });
});

describe('a transfer in flight blocks a refund (H4b · 3)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockGetOrderById.mockResolvedValue({
      id: 'ord_solo',
      buyer_id: 'buyer_1',
      seller_id: 'seller_1',
      payment_id: 'pay_solo',
      status: 'paid',
      amount: 1000,
    });
  });

  const SOLO_PAYMENT = {
    id: 'pay_solo',
    checkout_id: null,
    order_id: 'ord_solo',
    buyer_id: 'buyer_1',
    seller_id: 'seller_1',
    currency: 'NGN',
    total_charged_kobo: 100_000,
    item_amount_kobo: 100_000,
    seller_payout_kobo: 95_000,
    metadata: {},
  };

  it('refuses a single-order refund while payout_pending still holds a transfer code', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') {
        return {
          data: { ...SOLO_PAYMENT, status: 'payout_pending', payout_transfer_code: 'TRF_LIVE' },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.refundPaymentForOrder('ord_solo', 'buyer_1')).rejects.toThrow(
      /payout in progress/i,
    );
    const { refundPaystackTransaction } = await import('./paystack');
    expect(refundPaystackTransaction).not.toHaveBeenCalled();
  });

  /**
   * REPLACED (G3 · H4). The old test asserted that `payout_pending` with a NULL
   * transfer code is refundable — which pinned the defect open. That state is
   * not "the transfer failed"; it is also the window between the payout CAS and
   * the code stamp, roughly the duration of the Paystack transfer call. A refund
   * landing there paid the buyer back while the transfer went on to succeed.
   *
   * A genuinely failed transfer does not leave the row there: transfer.failed /
   * transfer.reversed put the payment back to 'paid', which the test below this
   * one covers.
   */
  it('refuses a single-order refund at payout_pending even with NO transfer code yet', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments') {
        return {
          data: { ...SOLO_PAYMENT, status: 'payout_pending', payout_transfer_code: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { refundPaystackTransaction } = await import('./paystack');

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.refundPaymentForOrder('ord_solo', 'buyer_1')).rejects.toThrow(
      /payout in progress/i,
    );
    expect(refundPaystackTransaction).not.toHaveBeenCalled();
  });

  it('allows the refund once a failed transfer has put the payment back to paid', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        return { data: { id: 'pay_solo' }, error: null };
      }
      if (call.table === 'marketplace_payments') {
        return {
          data: {
            ...SOLO_PAYMENT,
            status: 'paid',
            payout_transfer_code: null,
            payout_failed_reason: 'paystack_transfer.failed',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { refundPaystackTransaction } = await import('./paystack');
    (refundPaystackTransaction as jest.Mock).mockResolvedValue({ id: 'rf_2', status: 'processed' });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(svc.refundPaymentForOrder('ord_solo', 'buyer_1')).resolves.toBeUndefined();
    expect(refundPaystackTransaction).toHaveBeenCalled();
  });

  /**
   * G3 · H4, the other half: the claim itself closes the window. A legacy
   * single-order payout claims the row by stamping a `claim:<reference>` marker
   * into payout_transfer_code in the SAME write that flips the status, so there
   * is no instant where the row is payout_pending with nothing recorded.
   */
  it('stamps a claim marker in the same write that flips the payment to payout_pending', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_seller_payout_profiles') {
        return { data: ACTIVE_PROFILE, error: null };
      }
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        return { data: { ...SOLO_PAYMENT, status: 'payout_pending' }, error: null };
      }
      return { data: null, error: null };
    });
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_SOLO',
      status: 'pending',
      reference: 'ls_po_solo',
    });

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(
      transferSellerPayout(svc, 'ord_solo', { ...SOLO_PAYMENT, status: 'paid' }),
    ).resolves.toBe('transferred');

    const claim = calls.find(
      (c) =>
        c.table === 'marketplace_payments' &&
        (payload(c, 'update') as any).status === 'payout_pending',
    );
    expect(claim).toBeDefined();
    expect((payload(claim!, 'update') as any).payout_transfer_code).toBe(
      `claim:${orderPayoutReference('ord_solo', 0)}`,
    );
    // The CAS: a payable status AND nothing already claimed.
    expect(claim!.ops.some((op) => op.fn === 'is' && op.args[0] === 'payout_transfer_code')).toBe(
      true,
    );
  });

  /**
   * G3 · H11. A second caller entering at `payout_pending` used to walk past
   * the claim entirely, transfer again, be rejected by Paystack for the
   * duplicate reference, and then roll back — wiping the FIRST caller's live
   * transfer code. The real transfer settled later, matched nothing, and the
   * payment stayed 'paid' and refundable while the seller had the money.
   */
  it('a duplicate legacy attempt loses the claim and never touches the live tracking columns', async () => {
    let claimsGranted = 0;
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_seller_payout_profiles') {
        return { data: ACTIVE_PROFILE, error: null };
      }
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        claimsGranted += 1;
        return claimsGranted === 1
          ? { data: { ...SOLO_PAYMENT, status: 'payout_pending' }, error: null }
          : { data: null, error: null };
      }
      // The loser re-reads and sees a transfer in flight.
      if (call.table === 'marketplace_payments') {
        return {
          data: { ...SOLO_PAYMENT, status: 'payout_pending', payout_transfer_code: 'TRF_SOLO' },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_SOLO',
      status: 'pending',
      reference: 'ls_po_solo',
    });

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    const [a, b] = await Promise.all([
      transferSellerPayout(svc, 'ord_solo', { ...SOLO_PAYMENT, status: 'payout_pending' }),
      transferSellerPayout(svc, 'ord_solo', { ...SOLO_PAYMENT, status: 'payout_pending' }),
    ]);
    expect([a, b].sort()).toEqual(['in_flight', 'transferred']);
    expect(mockInitiatePaystackTransfer).toHaveBeenCalledTimes(1);

    // Every write after the claim is filtered on THIS attempt's marker, so a
    // duplicate cannot clobber the live transfer's tracking.
    const marker = `claim:${orderPayoutReference('ord_solo', 0)}`;
    const stamp = calls.find(
      (c) =>
        c.table === 'marketplace_payments' &&
        (payload(c, 'update') as any).payout_transfer_code === 'TRF_SOLO',
    );
    expect(stamp).toBeDefined();
    expect(has(stamp!, 'eq', 'payout_transfer_code', marker)).toBe(true);
  });

  it('a rollback after a failed transfer is conditional on this attempt s claim', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_seller_payout_profiles') {
        return { data: ACTIVE_PROFILE, error: null };
      }
      if (call.table === 'marketplace_payments' && has(call, 'update')) {
        return { data: { ...SOLO_PAYMENT, status: 'payout_pending' }, error: null };
      }
      return { data: null, error: null };
    });
    mockInitiatePaystackTransfer.mockRejectedValue(new Error('Paystack balance too low'));

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(
      transferSellerPayout(svc, 'ord_solo', { ...SOLO_PAYMENT, status: 'paid' }),
    ).rejects.toThrow(/balance too low/i);

    const rollback = calls.find(
      (c) =>
        c.table === 'marketplace_payments' && (payload(c, 'update') as any).status === 'paid',
    );
    expect(rollback).toBeDefined();
    expect(
      has(rollback!, 'eq', 'payout_transfer_code', `claim:${orderPayoutReference('ord_solo', 0)}`),
    ).toBe(true);
  });
});

/**
 * G3 · H10: a reversal must unwind a payment that already reached paid_out.
 */
describe('transfer.reversed unwinds a settled payout (H10)', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
  });

  it.each(['transfer.failed', 'transfer.reversed'])(
    '%s puts a paid_out payment back to paid and clears payout_at',
    async (event) => {
      const { client, calls } = scriptedDb((call) => {
        if (call.table === 'marketplace_payments' && has(call, 'select')) {
          return { data: { id: 'pay_solo', status: 'paid_out', payout_attempt: 0 }, error: null };
        }
        return { data: null, error: null };
      });
      const { MarketplacePaymentsService } = await import('./marketplacePayments');
      const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

      await svc.handleWebhook(
        JSON.stringify({ event, data: { id: 31, transfer_code: 'TRF_GONE' } }),
        'sig',
      );

      const reset = calls.find(
        (c) => c.table === 'marketplace_payments' && (payload(c, 'update') as any).status === 'paid',
      );
      expect(reset).toBeDefined();
      // An already-settled payout is reversible, not only one still pending.
      expect(
        reset!.ops.some(
          (op) =>
            op.fn === 'in' &&
            op.args[0] === 'status' &&
            (op.args[1] as string[]).includes('paid_out'),
        ),
      ).toBe(true);
      // A paid_out timestamp left behind is the same lie in another column.
      expect((payload(reset!, 'update') as any).payout_at).toBeNull();
      // And the burnt attempt is counted, so the retry uses a new reference (H1).
      expect((payload(reset!, 'update') as any).payout_attempt).toBe(1);
    },
  );

  it('bumps the order attempt counter when a cart payout is reversed', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_transfer_code', 'TRF_CART')) {
        return { data: { id: 'ord_1', checkout_id: 'chk_1', payment_id: 'pay_c1' }, error: null };
      }
      if (call.table === 'marketplace_orders' && call.terminal === 'maybeSingle') {
        return { data: { id: 'ord_1', payout_attempt: 2 }, error: null };
      }
      return { data: null, error: null };
    });
    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await svc.handleWebhook(
      JSON.stringify({ event: 'transfer.reversed', data: { id: 32, transfer_code: 'TRF_CART' } }),
      'sig',
    );

    const unwind = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'pending',
    );
    expect(unwind).toBeDefined();
    expect((payload(unwind!, 'update') as any).payout_attempt).toBe(3);
  });
});

/**
 * Hotfix H4c: the stamp itself is a failure path.
 *
 * supabase-js reports errors in the result rather than throwing, so an
 * unchecked `.update()` is indistinguishable from a successful one. The most
 * likely way it fails is the ordinary one: the code deploys before its
 * migration is hand-applied, so `payout_transfer_code` / `payout_reference` do
 * not exist yet.
 */

describe('the payout reference survives a failed stamp (H4c)', () => {
  const MISSING_COLUMN = { message: 'column "payout_reference" does not exist', code: '42703' };

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
    mockVerifyPaystackSignature.mockReturnValue(true);
    mockInitiatePaystackTransfer.mockResolvedValue({
      transferCode: 'TRF_CART',
      status: 'pending',
      reference: 'ls_po_ord_1',
    });
  });

  it('writes the deterministic reference BEFORE the transfer, while the money is still ours', async () => {
    let referenceStampedAt = -1;
    let transferAt = -1;
    let step = 0;
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_status', 'pending')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null };
      }
      if (
        call.table === 'marketplace_orders' &&
        typeof (payload(call, 'update') as any).payout_reference === 'string' &&
        (payload(call, 'update') as any).payout_transfer_code === undefined
      ) {
        referenceStampedAt = step++;
        return { data: null, error: null };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });
    mockInitiatePaystackTransfer.mockImplementation(async () => {
      transferAt = step++;
      return { transferCode: 'TRF_CART', status: 'pending', reference: 'ls_po_ord_1' };
    });

    const { MarketplacePaymentsService, orderPayoutReference } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);
    await expect(transferSellerPayout(svc)).resolves.toBe('transferred');

    expect(referenceStampedAt).toBeGreaterThanOrEqual(0);
    expect(referenceStampedAt).toBeLessThan(transferAt);
    // The reference written up front is the same one Paystack is given.
    expect(mockInitiatePaystackTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: orderPayoutReference('ord_1') }),
    );
  });

  it('releases the claim and moves no money when the reference write errors', async () => {
    const { client, calls } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_status', 'pending')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null };
      }
      if (
        call.table === 'marketplace_orders' &&
        typeof (payload(call, 'update') as any).payout_reference === 'string'
      ) {
        return { data: null, error: MISSING_COLUMN };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(transferSellerPayout(svc)).rejects.toMatchObject({ code: '42703' });
    // Nothing moved, and the order is back where another attempt can claim it.
    expect(mockInitiatePaystackTransfer).not.toHaveBeenCalled();
    const release = calls.find(
      (c) => c.table === 'marketplace_orders' && (payload(c, 'update') as any).payout_status === 'pending',
    );
    expect(release).toBeDefined();
    expect((payload(release!, 'update') as any).payout_failed_reason).toMatch(/payout reference/i);
  });

  it('still reports transferred when the post-transfer stamp errors — the money already moved', async () => {
    const { client } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_status', 'pending')) {
        return { data: { id: 'ord_1', seller_payout_kobo: 95_000 }, error: null };
      }
      if (
        call.table === 'marketplace_orders' &&
        (payload(call, 'update') as any).payout_transfer_code === 'TRF_CART'
      ) {
        return { data: null, error: MISSING_COLUMN };
      }
      if (call.table === 'marketplace_seller_payout_profiles') return { data: ACTIVE_PROFILE, error: null };
      if (call.table === 'marketplace_orders') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await expect(transferSellerPayout(svc)).resolves.toBe('transferred');
    // A throw here would invite a retry, and a retry can move money twice.
    expect(mockInitiatePaystackTransfer).toHaveBeenCalledTimes(1);
  });

  it('a transfer webhook still finds the order by scanning in-flight payouts when the columns are absent', async () => {
    const { orderPayoutReference } = await import('./marketplacePayments');
    const reference = orderPayoutReference('ord_1');

    const { client, calls } = scriptedDb((call) => {
      // Both exact matches fail the way a missing column does.
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_transfer_code', 'TRF_CART')) {
        return { data: null, error: MISSING_COLUMN };
      }
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_reference', reference)) {
        return { data: null, error: MISSING_COLUMN };
      }
      // The bounded scan over orders still claimed as 'paying'.
      if (call.table === 'marketplace_orders' && has(call, 'eq', 'payout_status', 'paying')) {
        return {
          data: [
            { id: 'ord_other', checkout_id: 'chk_2', payment_id: 'pay_c2' },
            { id: 'ord_1', checkout_id: 'chk_1', payment_id: 'pay_c1' },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => client } as any);

    await svc.handleWebhook(
      JSON.stringify({
        event: 'transfer.success',
        data: { id: 21, transfer_code: 'TRF_CART', reference },
      }),
      'sig',
    );

    const settle = calls.find(
      (c) =>
        c.table === 'marketplace_orders' &&
        (payload(c, 'update') as any).payout_status === 'paid_out',
    );
    expect(settle).toBeDefined();
    // The right order, not the other in-flight one.
    expect(has(settle!, 'eq', 'id', 'ord_1')).toBe(true);
    // The scan is bounded.
    const scan = calls.find((c) => has(c, 'eq', 'payout_status', 'paying'));
    expect(scan!.ops.some((op) => op.fn === 'limit')).toBe(true);
  });
});
