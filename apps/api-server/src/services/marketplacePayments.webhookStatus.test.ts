/**
 * The STATUS Paystack is answered with when a settlement write fails (#108,
 * Phase B).
 *
 * The retry contract only works end to end: `markPaymentPaid` throwing is
 * worthless if the route still answers 200, because Paystack never delivers
 * again and the paid order stays stranded. So this drives the real router over
 * a real HTTP server and asserts the status code, not the promise.
 *
 * It lives under `services/` rather than `routes/` on purpose: it changes
 * nothing there, and `routes/marketplace/**` was being edited by another lane
 * while this one ran.
 *
 * Gotcha: `getMarketplacePaymentsService` is a module-level singleton bound to
 * the FIRST host handed to it, so every case resets the module registry and
 * re-imports both the route and the service.
 */
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

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

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = jest.fn();
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

const PAYMENT = {
  id: 'pay_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  order_id: 'ord_1',
  paystack_reference: 'ls_buy_ref',
  status: 'initialized',
  paystack_mode: 'test',
  currency: 'NGN',
  total_charged_kobo: 105_000,
  item_amount_kobo: 100_000,
};

const ORDER = {
  id: 'ord_1',
  listing_id: 'listing_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  status: 'awaiting_payment',
};

const CHARGE_SUCCESS = {
  event: 'charge.success',
  data: { id: 99, reference: 'ls_buy_ref', amount: 105_000, currency: 'NGN' },
};

/** A client whose `marketplace_orders` status write optionally fails. */
function client(orderWriteFails: boolean) {
  const from = (table: string) => {
    const ops: string[] = [];
    const patches: Array<Record<string, unknown>> = [];
    const chain: any = {};
    for (const fn of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'delete']) {
      chain[fn] = () => {
        ops.push(fn);
        return chain;
      };
    }
    for (const fn of ['update', 'insert', 'upsert']) {
      chain[fn] = (payload: Record<string, unknown>) => {
        ops.push(fn);
        patches.push(payload || {});
        return chain;
      };
    }
    const settle = () => {
      const writing = ops.includes('update') || ops.includes('insert');
      if (
        orderWriteFails &&
        table === 'marketplace_orders' &&
        patches.some((patch) => patch.status === 'paid')
      ) {
        return Promise.resolve({ data: null, error: { message: 'deadlock detected', code: '40P01' } });
      }
      if (table === 'marketplace_payments') {
        return Promise.resolve({
          data: writing ? { ...PAYMENT, status: 'paid' } : PAYMENT,
          error: null,
        });
      }
      if (table === 'marketplace_orders' && !writing) return Promise.resolve({ data: ORDER, error: null });
      if (table === 'marketplace_listings') {
        return Promise.resolve({ data: { listing_kind: 'physical' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    chain.single = settle;
    chain.maybeSingle = settle;
    chain.then = (ok: any, err: any) => settle().then(ok, err);
    return chain;
  };
  return { from };
}

/** Mount the real router over a real server and POST one event to it. */
async function postWebhook(orderWriteFails: boolean): Promise<{ status: number; body: any }> {
  jest.resetModules();
  const routeModule = await import('../routes/paystackWebhook');
  routeModule.initializePaystackWebhookRoutes({
    getClient: () => client(orderWriteFails),
  } as never);

  const app = express();
  app.use(express.json());
  app.use('/webhooks/paystack', routeModule.default);
  // The production error handler is not mounted here; the route catches its own
  // failures by design, which is exactly the mapping under test.

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/paystack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': 'sig' },
      body: JSON.stringify(CHARGE_SUCCESS),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
});

it('answers 200 when settlement succeeds', async () => {
  const { status, body } = await postWebhook(false);
  expect(status).toBe(200);
  expect(body).toEqual(expect.objectContaining({ success: true }));
});

it('TODAY: answers 200 even when the order was never marked paid', async () => {
  // Paystack is told the event is handled. It will not deliver again, and the
  // order stays in `awaiting_payment` with the buyer's money taken.
  const { status, body } = await postWebhook(true);
  expect(status).toBe(200);
  expect(body).toEqual(expect.objectContaining({ success: true }));
});
