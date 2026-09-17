/**
 * What SETTLEMENT does when one of its writes FAILS (#108, Phase B).
 *
 * `charge.success` arrives, the signature checks out, the amount and currency
 * match, and `markPaymentPaid` runs. Four bare awaited writes on that path:
 *
 *  1. `marketplace_checkouts` ← `status: paid` — a display mirror;
 *  2. `marketplace_cart_items` ← delete — clearing the bought cart;
 *  3. `marketplace_orders` ← `status: paid`, `payment_id` — the authoritative
 *     "this order is paid", and the one everything downstream reads;
 *  4. `paystack_webhook_events` ← `processed_at` — the second half of the
 *     two-phase dedupe.
 *
 * ## Why (3) is different from every other site in this lane
 *
 * It is driven by a VERIFIED webhook, and Paystack retries a non-2xx. So the
 * right answer to a failed state write is to fail the request and let Paystack
 * deliver again — but only because re-running is safe, and it is: the dedupe
 * claim row is stamped `processed_at` ONLY after processing returns, so an
 * unfinished claim is re-processed rather than skipped, and each order is
 * re-selected by its own unfulfilled status, so a second run is a no-op rather
 * than a duplicate. Both halves are asserted here.
 *
 * ## What each failure now does
 *
 * (1), (2) and (4) are BEST-EFFORT: a display mirror, a stale cart row, and a
 * dedupe stamp whose absence makes the next retry re-process — all safe
 * directions. (3) MUST SUCCEED, which on this path means answering a non-2xx.
 *
 * ## The gotcha
 *
 * `markPaymentPaid` is reached from the webhook AND from
 * `verifyPaymentByReference`, the buyer's browser returning from Paystack.
 * Throwing is right in both: the order genuinely is not paid, so answering the
 * buyer "paid" would be the lie. The webhook retry is what heals it.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: jest.fn(),
  initiatePaystackTransfer: jest.fn(),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: () => true,
  verifyPaystackTransaction: jest.fn(),
}));

const mockStampOrderPaidAt = jest.fn();
const mockNotifyOrderParty = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = jest.fn();
    getOrderByIdAdmin = jest.fn();
    releaseEscrow = jest.fn();
    notifyOrderParty = mockNotifyOrderParty;
    stampOrderPaidAt = mockStampOrderPaidAt;
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

const PAYMENT = {
  id: 'pay_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  order_id: 'ord_1',
  checkout_id: 'chk_1',
  paystack_reference: 'ls_cart_ref',
  status: 'initialized',
  paystack_mode: 'test',
  currency: 'NGN',
  total_charged_kobo: 150_000,
  item_amount_kobo: 150_000,
};

const SETTLED = { ...PAYMENT, status: 'paid' };

const CART_ORDERS = [
  { id: 'ord_1', listing_id: 'listing_1', buyer_id: 'buyer_1', seller_id: 'seller_1', status: 'awaiting_payment' },
  { id: 'ord_2', listing_id: 'listing_2', buyer_id: 'buyer_1', seller_id: 'seller_1', status: 'awaiting_payment' },
];

type FailingWrite = 'none' | 'checkout_status' | 'cart_clear' | 'order_paid' | 'processed_at';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'other' {
  if (call.table === 'marketplace_checkouts') {
    const patch = writePayload(call, 'update');
    if (patch && patch.status === 'paid') return 'checkout_status';
  }
  if (call.table === 'marketplace_cart_items' && call.ops.some((op) => op.fn === 'delete')) {
    return 'cart_clear';
  }
  if (call.table === 'marketplace_orders') {
    const patch = writePayload(call, 'update');
    if (patch && patch.status === 'paid') return 'order_paid';
  }
  if (call.table === 'paystack_webhook_events') {
    const patch = writePayload(call, 'update');
    if (patch && 'processed_at' in patch) return 'processed_at';
  }
  return 'other';
}

function buildService(failOn: FailingWrite) {
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    if (call.table === 'marketplace_payments') {
      // The settle flip is the only payments UPDATE on this path; it returns
      // the row it changed, which is what proves the caller won the CAS.
      if (call.ops.some((op) => op.fn === 'update')) return { data: SETTLED, error: null };
      return { data: PAYMENT, error: null };
    }
    if (call.table === 'marketplace_orders') {
      // The cart roster is an un-terminated chain (`then`); the single-order
      // read that digital fulfilment does terminates with `maybeSingle`.
      if (call.terminal === 'then' && call.ops.some((op) => op.fn === 'select')) {
        return { data: CART_ORDERS, error: null };
      }
      if (call.terminal === 'maybeSingle') return { data: CART_ORDERS[0], error: null };
    }
    if (call.table === 'marketplace_listings') {
      // Physical, so digital fulfilment declines and the meetup notifications
      // run — the ordinary cart case.
      return { data: { listing_kind: 'physical' }, error: null };
    }
    return { data: null, error: null };
  });

  const host = { getClient: () => client, marketplace: {} } as never;
  return { host, calls };
}

async function serviceFor(failOn: FailingWrite) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(failOn);
  return { service: new MarketplacePaymentsService(host), calls };
}

const CHARGE_SUCCESS = JSON.stringify({
  event: 'charge.success',
  data: { id: 99, reference: 'ls_cart_ref', amount: 150_000, currency: 'NGN', paid_at: '2026-09-17T00:00:00.000Z' },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
});

describe('a verified charge.success settles, with every write succeeding', () => {
  it('marks the orders paid, clears the cart, notifies both parties and reports nothing', async () => {
    const { service, calls } = await serviceFor('none');
    const result = await service.handleWebhook(CHARGE_SUCCESS, 'sig');

    expect(result).toEqual({ ok: true, duplicate: false, eventType: 'charge.success' });
    expect(calls.filter((call) => which(call) === 'order_paid')).toHaveLength(2);
    expect(calls.some((call) => which(call) === 'cart_clear')).toBe(true);
    expect(calls.some((call) => which(call) === 'processed_at')).toBe(true);
    expect(mockStampOrderPaidAt).toHaveBeenCalledTimes(2);
    expect(mockNotifyOrderParty).toHaveBeenCalledTimes(4);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('advances an order only from an unfulfilled status, which is what makes a retry a no-op', async () => {
    const { service, calls } = await serviceFor('none');
    await service.handleWebhook(CHARGE_SUCCESS, 'sig');
    for (const call of calls.filter((c) => which(c) === 'order_paid')) {
      expect(call.ops).toContainEqual({
        fn: 'in',
        args: ['status', ['awaiting_payment', 'pending_payment']],
      });
    }
  });

  it('stamps processed_at only AFTER processing, so a dead claim is re-processed', async () => {
    const { service, calls } = await serviceFor('none');
    await service.handleWebhook(CHARGE_SUCCESS, 'sig');
    const claim = calls.findIndex(
      (call) => call.table === 'paystack_webhook_events' && call.ops.some((op) => op.fn === 'insert'),
    );
    const stamp = calls.findIndex((call) => which(call) === 'processed_at');
    const lastOrderWrite = calls.map(which).lastIndexOf('order_paid');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(lastOrderWrite);
    expect(writePayload(calls[claim], 'insert')).toEqual(
      expect.objectContaining({ processed_at: null }),
    );
  });
});

describe('settlement with one write failing', () => {
  it('still settles when the checkout status mirror fails, and warns', async () => {
    const { service, calls } = await serviceFor('checkout_status');
    await expect(service.handleWebhook(CHARGE_SUCCESS, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    // The orders — the part that matters — still moved.
    expect(calls.filter((call) => which(call) === 'order_paid')).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_checkouts', checkoutId: 'chk_1' }),
    );
  });

  it('still settles when clearing the bought cart fails, and warns', async () => {
    const { service, calls } = await serviceFor('cart_clear');
    await expect(service.handleWebhook(CHARGE_SUCCESS, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(calls.filter((call) => which(call) === 'order_paid')).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'marketplace_cart_items', op: 'delete' }),
    );
  });

  it('REJECTS when the orders cannot be marked paid, so Paystack retries', async () => {
    const { service } = await serviceFor('order_paid');
    await expect(service.handleWebhook(CHARGE_SUCCESS, 'sig')).rejects.toThrow(
      /marketplace_orders/,
    );
  });

  it('does not stamp the event processed when it could not settle', async () => {
    // The whole retry contract rests on this: a stamped claim is a permanent
    // "already handled", so stamping an event that failed would strand the
    // order for good.
    const { service, calls } = await serviceFor('order_paid');
    await service.handleWebhook(CHARGE_SUCCESS, 'sig').catch(() => undefined);
    expect(calls.some((call) => which(call) === 'processed_at')).toBe(false);
  });

  it('throws a typed WriteFailedError naming the order, payment and checkout', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { service } = await serviceFor('order_paid');
    const error = await service.handleWebhook(CHARGE_SUCCESS, 'sig').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({ orderId: 'ord_1', paymentId: 'pay_1', checkoutId: 'chk_1' }),
    );
  });

  it('still answers ok when only the processed_at stamp fails, and warns', async () => {
    // Deliberately best-effort even here: an unstamped claim makes the next
    // retry RE-PROCESS, which every branch is built to survive. Failing the
    // request would guarantee that repeat instead of merely risking it.
    const { service } = await serviceFor('processed_at');
    await expect(service.handleWebhook(CHARGE_SUCCESS, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'paystack_webhook_events', eventType: 'charge.success' }),
    );
  });
});
