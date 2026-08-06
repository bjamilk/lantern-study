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
