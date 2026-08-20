/**
 * Settlement hardening from the payments audit: currency is validated wherever
 * amount is, mismatches leave a visible reconciliation trail, and re-running
 * checkout reuses the open Paystack session instead of leaking orphan rows.
 */

export {}; // module scope — the security test declares the same mock names

const mockVerifyPaystackTransaction = jest.fn();
const mockVerifyPaystackSignature = jest.fn();
const mockInitializePaystackTransaction = jest.fn();

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_fresh_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: (...args: unknown[]) => mockInitializePaystackTransaction(...args),
  initiatePaystackTransfer: jest.fn(),
  isPaystackConfigured: () => true,
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: (...args: unknown[]) => mockVerifyPaystackSignature(...args),
  verifyPaystackTransaction: (...args: unknown[]) => mockVerifyPaystackTransaction(...args),
}));

const mockGetOrderById = jest.fn();
const mockStampOrderPaidAt = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = jest.fn();
    releaseEscrow = jest.fn();
    notifyOrderParty = jest.fn();
    stampOrderPaidAt = mockStampOrderPaidAt;
  }
  return {
    MarketplaceOrdersService,
    invalidateSellerAnalyticsCache: jest.fn(),
    resolveEffectivePrice: () => 1000,
  };
});

/** Chainable mock recording updates/inserts, with per-table read results. */
function makeDb(reads: Record<string, unknown>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const from = (table: string) => {
    const api: Record<string, any> = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.or = self;
    api.is = self;
    api.update = (payload: unknown) => {
      writes.push({ table, op: 'update', payload });
      return api;
    };
    api.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload });
      return api;
    };
    api.maybeSingle = async () => ({ data: reads[table] ?? null, error: null });
    api.single = async () => ({ data: reads[table] ?? null, error: null });
    api.then = (resolve: (v: unknown) => void) => resolve({ data: reads[table] ?? null, error: null });
    return api;
  };
  return { from, writes };
}

const PAYMENT = {
  id: 'pay_1',
  order_id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  paystack_reference: 'ls_buy_ref',
  status: 'initialized',
  currency: 'NGN',
  total_charged_kobo: 105_000,
  item_amount_kobo: 100_000,
  service_fee_kobo: 5_000,
  metadata: {},
};

describe('settlement hardening', () => {
  beforeEach(() => {
    process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    jest.clearAllMocks();
  });

  it('verify rejects a success in the wrong currency even when the amount matches', async () => {
    const db = makeDb({ marketplace_payments: { ...PAYMENT } });
    mockVerifyPaystackTransaction.mockResolvedValue({
      status: 'success',
      reference: 'ls_buy_ref',
      amount: 105_000, // matching minor units...
      currency: 'ZAR', // ...in the wrong currency
      id: 9,
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => db } as any);

    await expect(svc.verifyPaymentByReference('ls_buy_ref', 'buyer_1')).rejects.toThrow(
      /amount mismatch/i
    );
    // The mismatch is stamped for reconciliation, and the payment is never settled.
    expect(
      db.writes.some(
        (w) =>
          w.table === 'marketplace_payments' &&
          w.op === 'update' &&
          (w.payload as any)?.metadata?.settlement_mismatch?.gotCurrency === 'ZAR'
      )
    ).toBe(true);
    expect(db.writes.some((w) => (w.payload as any)?.status === 'paid')).toBe(false);
  });

  it('webhook amount mismatch leaves a reconciliation stamp instead of vanishing', async () => {
    mockVerifyPaystackSignature.mockReturnValue(true);
    const db = makeDb({
      marketplace_payments: { ...PAYMENT },
      paystack_webhook_events: null,
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => db } as any);

    const body = JSON.stringify({
      event: 'charge.success',
      data: { id: 42, reference: 'ls_buy_ref', amount: 999, currency: 'NGN' },
    });
    const result = await svc.handleWebhook(body, 'sig');

    expect(result.ok).toBe(true);
    const stamp = db.writes.find(
      (w) =>
        w.table === 'marketplace_payments' &&
        (w.payload as any)?.metadata?.settlement_mismatch
    );
    expect(stamp).toBeTruthy();
    expect((stamp!.payload as any).metadata.settlement_mismatch.gotAmount).toBe(999);
    // And the payment was NOT settled.
    expect(db.writes.some((w) => (w.payload as any)?.status === 'paid')).toBe(false);
  });

  it('re-running checkout reuses the open Paystack session instead of inserting a new payment row', async () => {
    const order = {
      id: 'ord_1',
      buyer_id: 'buyer_1',
      seller_id: 'seller_1',
      listing_id: 'lst_1',
      amount: 1000, // naira -> 100_000 kobo
      payment_id: 'pay_1',
      status: 'awaiting_payment',
    };
    mockGetOrderById.mockResolvedValue(order);
    const db = makeDb({
      marketplace_payments: {
        ...PAYMENT,
        item_amount_kobo: 100_000,
        paystack_access_code: 'AC_open',
        metadata: { authorizationUrl: 'https://checkout.paystack.com/AC_open' },
      },
      marketplace_seller_payout_profiles: { paystack_recipient_code: 'RCP_1', status: 'active' },
    });

    const { MarketplacePaymentsService } = await import('./marketplacePayments');
    const svc = new MarketplacePaymentsService({ getClient: () => db } as any);

    const result = await svc.createCheckoutForExistingOrder({
      orderId: 'ord_1',
      buyerId: 'buyer_1',
      buyerEmail: 'buyer@example.com',
    });

    expect(result.payment.reference).toBe('ls_buy_ref');
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/AC_open');
    // No new Paystack session, no orphan payment row.
    expect(mockInitializePaystackTransaction).not.toHaveBeenCalled();
    expect(db.writes.filter((w) => w.table === 'marketplace_payments' && w.op === 'insert')).toHaveLength(0);
  });
});
