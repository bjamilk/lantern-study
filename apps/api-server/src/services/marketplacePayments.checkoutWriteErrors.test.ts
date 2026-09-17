/**
 * What the OTHER two charge-creation flows do when one of their writes FAILS
 * (#108, Phase B). The buy-now pilot is in
 * `marketplacePayments.writeErrors.test.ts`; this file is its two siblings:
 *
 *  - `createCheckoutCharge` — the unified cart checkout. Three bare writes:
 *    the checkout's `payment_id` mirror, the orders' `payment_id` +
 *    `awaiting_payment` link, and the access code stored after Paystack
 *    answers.
 *  - `createCheckoutForExistingOrder` — offer-accept, and the resume path that
 *    `getCheckoutSessionForOrder` defers to. Three bare writes: retiring a
 *    stale payment row BEFORE its replacement is inserted, the order link, and
 *    the access code.
 *
 * Each test drives a whole flow with exactly one write failing. Failure is
 * modelled as supabase-js really behaves — the await RESOLVES, nothing rejects
 * — so a `try/catch` would not see it either.
 *
 * ## What each failure now does
 *
 * Retiring a stale session and linking the orders are MUST-SUCCEED: nothing
 * external has happened yet, so the request stops and no charge is opened. The
 * checkout mirror and the access code are BEST-EFFORT: the first is a display
 * field, and the second is written when the Paystack session is already live,
 * where throwing would strand a real charge.
 *
 * ## The gotcha
 *
 * Both flows write to `marketplace_payments` more than once, and the resume
 * flow also READS it. "Which call is this?" is answered by the operation and
 * the payload keys together, never by the table alone; `which()` below is
 * deliberately narrow, because widening it would quietly start failing a
 * different write than the test names.
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
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };

const PAYMENT_ROW = { id: 'pay_new', buyer_id: 'buyer_1', seller_id: 'seller_1', order_id: 'ord_1' };

/**
 * The open session the resume flow finds. Its split is deliberately NOT what
 * the resolver produces today, which is what sends the flow down the
 * "retire it and mint a replacement" branch this file is about.
 */
const STALE_PAYMENT = {
  id: 'pay_old',
  status: 'initialized',
  paystack_access_code: 'acc_old',
  paystack_reference: 'ls_off_old',
  item_amount_kobo: 1,
  total_charged_kobo: 1,
  seller_payout_kobo: 1,
  currency: 'NGN',
  metadata: { authorizationUrl: 'https://checkout.paystack.com/acc_old' },
};

type FailingWrite =
  | 'none'
  | 'checkout_link'
  | 'order_link'
  | 'access_code'
  | 'supersede';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'other' {
  if (call.table === 'marketplace_checkouts') {
    const patch = writePayload(call, 'update');
    if (patch && 'payment_id' in patch) return 'checkout_link';
    return 'other';
  }
  if (call.table === 'marketplace_orders') {
    const patch = writePayload(call, 'update');
    if (patch && 'payment_id' in patch) return 'order_link';
    return 'other';
  }
  if (call.table === 'marketplace_payments') {
    const patch = writePayload(call, 'update');
    if (!patch) return 'other';
    if ('paystack_access_code' in patch) return 'access_code';
    if (patch.status === 'failed') return 'supersede';
  }
  return 'other';
}

function buildService(failOn: FailingWrite) {
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    if (call.table === 'marketplace_seller_payout_profiles') {
      return { data: { user_id: 'seller_1', status: 'active' }, error: null };
    }
    if (call.table === 'marketplace_listings') {
      return { data: { listing_kind: 'physical' }, error: null };
    }
    if (call.table === 'marketplace_payments') {
      if (call.ops.some((op) => op.fn === 'insert')) return { data: PAYMENT_ROW, error: null };
      if (call.ops.some((op) => op.fn === 'select')) return { data: STALE_PAYMENT, error: null };
    }
    return { data: null, error: null };
  });

  const host = {
    getClient: () => client,
    marketplace: {
      getMarketplaceListingById: jest.fn(async () => ({
        id: 'listing_1',
        user_id: 'seller_1',
        listing_kind: 'physical',
        price: 1000,
      })),
    },
  } as never;

  return { host, calls };
}

async function serviceFor(failOn: FailingWrite) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(failOn);
  return { service: new MarketplacePaymentsService(host), calls };
}

const CART_INPUT = {
  checkoutId: 'chk_1',
  buyerId: 'buyer_1',
  buyerEmail: 'buyer@example.test',
  orders: [
    { id: 'ord_1', seller_id: 'seller_1', listing_id: 'listing_1', amount: 1000, quantity: 1 },
    { id: 'ord_2', seller_id: 'seller_1', listing_id: 'listing_2', amount: 500, quantity: 1 },
  ],
  itemAmountKobo: 150_000,
  shippingAmountKobo: 0,
  totalChargeKobo: 150_000,
};

const EXISTING_ORDER = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  listing_id: 'listing_1',
  amount: 1000,
  quantity: 1,
  status: 'awaiting_payment',
  payment_id: 'pay_old',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  mockGetOrderById.mockResolvedValue(EXISTING_ORDER);
  mockInitializePaystackTransaction.mockResolvedValue({
    accessCode: 'acc_new',
    authorizationUrl: 'https://checkout.paystack.com/acc_new',
    reference: 'ls_test_ref',
  });
});

describe('unified cart checkout, with every write succeeding', () => {
  it('returns the session and reports nothing', async () => {
    const { service } = await serviceFor('none');
    const session = await service.createCheckoutCharge(CART_INPUT);
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_new');
    expect(session.paymentId).toBe('pay_new');
    expect(mockInitializePaystackTransaction).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('unified cart checkout, one write failing', () => {
  it('still sends the buyer to Paystack when the checkout MIRROR fails, and warns', async () => {
    // BEST EFFORT: `checkouts.payment_id` is a display field. Fulfilment walks
    // `payments.checkout_id` → orders, so nothing about settlement depends on
    // it.
    const { service } = await serviceFor('checkout_link');
    const session = await service.createCheckoutCharge(CART_INPUT);
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_new');
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_checkouts', checkoutId: 'chk_1', code: '40001' }),
    );
  });

  it('does NOT call Paystack when the order link fails', async () => {
    // MUST SUCCEED: unlinked orders are never advanced by the webhook, so the
    // buyer would pay and nothing would move. `createFromCart` cancels the
    // orders and fails the checkout when this throws.
    const { service } = await serviceFor('order_link');
    await expect(service.createCheckoutCharge(CART_INPUT)).rejects.toThrow(/marketplace_orders/);
    expect(mockInitializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('throws a typed WriteFailedError naming the checkout and both orders', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { service } = await serviceFor('order_link');
    const error = await service.createCheckoutCharge(CART_INPUT).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).code).toBe('40001');
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({ checkoutId: 'chk_1', paymentId: 'pay_new', orderCount: 2 }),
    );
  });

  it('still returns the URL when the access-code store fails, and warns', async () => {
    const { service } = await serviceFor('access_code');
    const session = await service.createCheckoutCharge(CART_INPUT);
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_new');
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_payments', paymentId: 'pay_new' }),
    );
  });
});

describe('resume / offer-accept, with every write succeeding', () => {
  it('retires the stale session, mints a replacement and reports nothing', async () => {
    const { service, calls } = await serviceFor('none');
    const session = await service.createCheckoutForExistingOrder({
      orderId: 'ord_1',
      buyerId: 'buyer_1',
      buyerEmail: 'buyer@example.test',
    });
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_new');
    expect(session.payment.id).toBe('pay_new');
    const retire = calls.find((call) => which(call) === 'supersede');
    expect(retire).toBeDefined();
    expect(retire?.ops).toContainEqual({ fn: 'eq', args: ['status', 'initialized'] });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('resume / offer-accept, one write failing', () => {
  it('does NOT insert a replacement or call Paystack when retiring the stale row fails', async () => {
    // MUST SUCCEED: the whole point of retiring first is that a late
    // charge.success on the old reference must not settle the order on the old
    // split. Carrying on would leave the order with TWO live sessions.
    const { service, calls } = await serviceFor('supersede');
    await expect(
      service.createCheckoutForExistingOrder({
        orderId: 'ord_1',
        buyerId: 'buyer_1',
        buyerEmail: 'buyer@example.test',
      }),
    ).rejects.toThrow(/marketplace_payments/);
    expect(calls.some((call) => call.ops.some((op) => op.fn === 'insert'))).toBe(false);
    expect(mockInitializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('names the stale payment and the order it belonged to', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { service } = await serviceFor('supersede');
    const error = await service
      .createCheckoutForExistingOrder({
        orderId: 'ord_1',
        buyerId: 'buyer_1',
        buyerEmail: 'buyer@example.test',
      })
      .catch((err: unknown) => err);
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({
        paymentId: 'pay_old',
        orderId: 'ord_1',
        reason: 'supersede_stale_session',
      }),
    );
  });

  it('does NOT call Paystack when the order link fails', async () => {
    const { service } = await serviceFor('order_link');
    await expect(
      service.createCheckoutForExistingOrder({
        orderId: 'ord_1',
        buyerId: 'buyer_1',
        buyerEmail: 'buyer@example.test',
      }),
    ).rejects.toThrow(/marketplace_orders/);
    expect(mockInitializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('still returns the URL when the access-code store fails, and warns', async () => {
    const { service } = await serviceFor('access_code');
    const session = await service.createCheckoutForExistingOrder({
      orderId: 'ord_1',
      buyerId: 'buyer_1',
      buyerEmail: 'buyer@example.test',
    });
    expect(session.authorizationUrl).toBe('https://checkout.paystack.com/acc_new');
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_payments', paymentId: 'pay_new' }),
    );
  });
});
