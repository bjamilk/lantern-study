/**
 * What the buy-now charge path does when one of its writes FAILS (#108).
 *
 * ## Why this suite exists
 *
 * supabase-js resolves a failed write with `{ data, error }` instead of
 * throwing, and three writes in `createBuyNowCheckoutSession` are bare awaits:
 *
 *   1. `marketplace_orders` ← `awaiting_payment`, right after the create RPC;
 *   2. `marketplace_orders` ← `payment_id` + `awaiting_payment`, the link that
 *      points the order at the payment row, BEFORE Paystack is called;
 *   3. `marketplace_payments` ← `paystack_access_code`, after Paystack answers.
 *
 * Each test drives the whole flow with exactly one of them failing. The stub is
 * the money suites' recording client, so a failure is modelled the way the real
 * one behaves: the await RESOLVES, nothing rejects, nothing catches.
 *
 * ## The gotcha
 *
 * Every write in this flow goes to one of two tables, so "which call is this?"
 * cannot be answered by table alone — the resolver matches on the payload keys
 * as well. `failOn` below is deliberately narrow for that reason: widening it
 * would quietly start failing a different write than the test names.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

const mockInitializePaystackTransaction = jest.fn();

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: (...args: unknown[]) => mockInitializePaystackTransaction(...args),
  initiatePaystackTransfer: jest.fn(),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: jest.fn(),
  verifyPaystackTransaction: jest.fn(),
}));

const mockGetOrderById = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = jest.fn();
    releaseEscrow = jest.fn();
    notifyOrderParty = jest.fn();
    stampOrderPaidAt = jest.fn();
  }
  return {
    MarketplaceOrdersService,
    invalidateSellerAnalyticsCache: jest.fn(),
    resolveEffectivePrice: () => 1000,
  };
});

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as {
  logger: { error: jest.Mock; warn: jest.Mock };
};

const LISTING = { id: 'listing_1', user_id: 'seller_1', listing_kind: 'physical', price: 1000 };
const ORDER = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  listing_id: 'listing_1',
  amount: 1000,
  quantity: 1,
  status: 'awaiting_payment',
};
const PAYMENT_ROW = { id: 'pay_1', buyer_id: 'buyer_1', seller_id: 'seller_1', order_id: 'ord_1' };

/** Which of the three writes a given test makes fail. */
type FailingWrite = 'none' | 'order_status' | 'order_link' | 'access_code';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'other' {
  if (call.table === 'marketplace_orders') {
    const patch = writePayload(call, 'update');
    if (!patch) return 'other';
    if ('payment_id' in patch) return 'order_link';
    if ('status' in patch) return 'order_status';
    return 'other';
  }
  if (call.table === 'marketplace_payments') {
    const patch = writePayload(call, 'update');
    if (patch && 'paystack_access_code' in patch) return 'access_code';
  }
  return 'other';
}

function buildService(failOn: FailingWrite) {
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    if (call.table === 'rpc:marketplace_create_buy_now_order') {
      return { data: [{ order_id: 'ord_1' }], error: null };
    }
    if (call.table === 'marketplace_seller_payout_profiles') {
      return { data: { user_id: 'seller_1', status: 'active' }, error: null };
    }
    if (call.table === 'marketplace_payments' && call.ops.some((op) => op.fn === 'insert')) {
      return { data: PAYMENT_ROW, error: null };
    }
    return { data: null, error: null };
  });

  const host = {
    getClient: () => client,
    marketplace: { getMarketplaceListingById: jest.fn(async () => LISTING) },
  } as never;

  return { host, calls };
}

async function buyNow(failOn: FailingWrite) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(failOn);
  const service = new MarketplacePaymentsService(host);
  const run = () =>
    service.createBuyNowCheckoutSession({
      listingId: 'listing_1',
      buyerId: 'buyer_1',
      buyerEmail: 'buyer@example.test',
    });
  return { run, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  mockGetOrderById.mockResolvedValue(ORDER);
  mockInitializePaystackTransaction.mockResolvedValue({
    accessCode: 'acc_1',
    authorizationUrl: 'https://checkout.paystack.com/acc_1',
    reference: 'ls_buy_test_ref',
  });
});

describe('buy-now checkout, with every write succeeding', () => {
  it('sends the buyer to Paystack and reports nothing', async () => {
    const { run } = await buyNow('none');
    const session = await run();
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_1');
    expect(session.payment.id).toBe('pay_1');
    expect(mockInitializePaystackTransaction).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('the order-status write after the create RPC fails', () => {
  // BEST-EFFORT: the RPC creates the order as `pending_payment`, and every
  // reader on the payment path accepts both spellings, so the charge must go
  // ahead — but the failure must be reported.
  it('still sends the buyer to Paystack', async () => {
    const { run } = await buyNow('order_status');
    const session = await run();
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_1');
    expect(mockInitializePaystackTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports the failure', async () => {
    const { run } = await buyNow('order_status');
    await run();
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_orders', op: 'update', code: '40001' }),
    );
  });
});

describe('the order → payment link fails', () => {
  // MUST-SUCCEED: nothing external has happened yet. Sending the buyer to pay
  // for an order that does not point at the payment row means the webhook
  // later settles a payment whose order was never linked.
  it('does not call Paystack', async () => {
    const { run } = await buyNow('order_link');
    await expect(run()).rejects.toThrow(/marketplace_orders/);
    expect(mockInitializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('throws a typed WriteFailedError carrying the PostgREST code', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { run } = await buyNow('order_link');
    const error = await run().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).code).toBe('40001');
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({ orderId: 'ord_1', paymentId: 'pay_1' }),
    );
  });

  it('is not a PublicError, so the buyer is not told this was their mistake', async () => {
    const { PublicError } = await import('../utils/safeError');
    const { run } = await buyNow('order_link');
    const error = await run().catch((err: unknown) => err);
    expect(error).not.toBeInstanceOf(PublicError);
  });

  it('leaves the already-inserted payment row alone', async () => {
    // Decided in docs/write-errors-plan.md: `initialized` already means "no
    // money captured", nothing can settle a reference no session was opened
    // for, and a second write on a failing path would have the same problem.
    const { run, calls } = await buyNow('order_link');
    await run().catch(() => undefined);
    const paymentWrites = calls.filter(
      (call) => call.table === 'marketplace_payments' && call.ops.some((op) => op.fn === 'update'),
    );
    expect(paymentWrites).toHaveLength(0);
  });
});

describe('the access-code write after Paystack answers fails', () => {
  // BEST-EFFORT: the session is live and the response already carries the URL.
  // Throwing here would strand a real Paystack charge the buyer never sees.
  it('still returns the authorization URL', async () => {
    const { run } = await buyNow('access_code');
    const session = await run();
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_1');
    expect(session.accessCode).toBe('acc_1');
  });

  it('reports the failure, because resume degrades without the stored code', async () => {
    const { run } = await buyNow('access_code');
    await run();
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({
        table: 'marketplace_payments',
        op: 'update',
        paymentId: 'pay_1',
        code: '40001',
      }),
    );
  });
});
