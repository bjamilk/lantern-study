/**
 * Hotfix H4, route half.
 *
 * 1. The fallback idempotency key (used when a client sends no Idempotency-Key)
 *    was a bare 5-minute wall-clock bucket, so two DIFFERENT requests from one
 *    user inside the same window shared a key — and the second was served the
 *    first one's cached response: the wrong cart, the wrong listing, the wrong
 *    amount.
 * 2. PATCH /orders/:id accepted `sellerNote` and `fulfillmentMode` from either
 *    party, letting a buyer rewrite the seller's note and change how the order
 *    is fulfilled after the fact, with no validation of the enum.
 */

const capturedKeys: string[] = [];

jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: (header: string | undefined) => header || null,
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    key: string,
    fn: () => Promise<unknown>,
  ) => {
    capturedKeys.push(key);
    return fn();
  },
}));

jest.mock('../services/marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: () => ({}),
}));

const mockListCart = jest.fn();
jest.mock('../services/marketplaceCart', () => ({
  getMarketplaceCartService: () => ({ listCart: mockListCart }),
}));

const mockGetOrderById = jest.fn();
const mockUpdateOrderStatus = jest.fn();
jest.mock('../services/marketplaceOrders', () => ({
  ...jest.requireActual('../services/marketplaceOrders'),
  getMarketplaceOrdersService: () => ({
    getOrderById: mockGetOrderById,
    updateOrderStatus: mockUpdateOrderStatus,
  }),
  invalidateSellerAnalyticsCache: jest.fn(async () => {}),
}));

import router, { initializeMarketplaceRoutes } from './marketplace';
import { routeLayers } from './marketplace/routeLayers';

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };

function fakeDb(resolve: (call: Call) => any) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'in', 'or', 'order', 'update', 'insert', 'delete', 'limit']) {
        chain[fn] = (...args: any[]) => {
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
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  };
  return { client, calls };
}

function init(resolve: (call: Call) => any = () => ({ data: null, error: null })) {
  const { client, calls } = fakeDb(resolve);
  const supabase: any = {
    getClient: () => client,
    createNotification: jest.fn(async () => ({ id: 'n1' })),
    boostMarketplaceListing: jest.fn(async () => ({ id: 'listing-1' })),
    getMarketplaceListingById: jest.fn(async () => null),
  };
  const cache: any = {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    delete: async () => {},
    deletePattern: async () => {},
  };
  initializeMarketplaceRoutes(supabase, cache);
  return { supabase, calls };
}

/**
 * Run the terminal handler of a route and wait for the response it writes.
 *
 * R5a gave PATCH /orders/:id an `idempotencyMiddleware` layer, which is what
 * attaches `req.runIdempotent`. These tests are about the handler body, not the
 * replay store, so the wrapper is stubbed as a passthrough — the dedicated
 * replay/409 coverage lives in marketplace.r5aRoutes.test.ts.
 */
async function runRoute(method: 'post' | 'patch', path: string, req: any) {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;
  if (typeof req.runIdempotent !== 'function') {
    req.runIdempotent = async (fn: () => Promise<unknown>) => fn();
  }

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler(req, res, (err: unknown) => reject(err));
    setTimeout(() => reject(new Error('route never responded')), 3000).unref?.();
  });
  return res;
}

const buyer = { id: 'buyer-1', email: 'b@x.com' };

beforeEach(() => {
  capturedKeys.length = 0;
  jest.clearAllMocks();
});

describe('fallback idempotency keys are derived from request content (finding 10)', () => {
  it('buy-now: two different listings in the same window get different keys', async () => {
    init();
    const call = (id: string, quantity: number) =>
      runRoute('post', '/listings/:id/buy-now', {
        params: { id },
        body: { quantity },
        headers: {},
        user: buyer,
      }).catch(() => undefined);

    await call('listing-a', 1);
    await call('listing-b', 1);
    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  it('buy-now: the same listing at a different quantity gets a different key', async () => {
    init();
    await runRoute('post', '/listings/:id/buy-now', {
      params: { id: 'listing-a' },
      body: { quantity: 1 },
      headers: {},
      user: buyer,
    }).catch(() => undefined);
    await runRoute('post', '/listings/:id/buy-now', {
      params: { id: 'listing-a' },
      body: { quantity: 3 },
      headers: {},
      user: buyer,
    }).catch(() => undefined);
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  it('buy-now: an identical repeat request in the window still shares a key', async () => {
    init();
    for (let i = 0; i < 2; i++) {
      await runRoute('post', '/listings/:id/buy-now', {
        params: { id: 'listing-a' },
        body: { quantity: 2 },
        headers: {},
        user: buyer,
      }).catch(() => undefined);
    }
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });

  it('cart checkout: editing the cart inside the window changes the key', async () => {
    init();
    mockListCart.mockResolvedValueOnce([{ listing_id: 'l1', quantity: 1, listing: { user_id: 's1' } }]);
    await runRoute('post', '/cart/checkout', { body: {}, headers: {}, user: buyer }).catch(
      () => undefined,
    );

    mockListCart.mockResolvedValueOnce([
      { listing_id: 'l1', quantity: 1, listing: { user_id: 's1' } },
      { listing_id: 'l2', quantity: 4, listing: { user_id: 's2' } },
    ]);
    await runRoute('post', '/cart/checkout', { body: {}, headers: {}, user: buyer }).catch(
      () => undefined,
    );

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  it('cart checkout: an explicit Idempotency-Key header still wins', async () => {
    init();
    mockListCart.mockResolvedValue([{ listing_id: 'l1', quantity: 1, listing: { user_id: 's1' } }]);
    await runRoute('post', '/cart/checkout', {
      body: {},
      headers: { 'idempotency-key': 'client-supplied-key' },
      user: buyer,
    }).catch(() => undefined);
    expect(capturedKeys[0]).toBe('client-supplied-key');
  });

  it('boost: a different duration in the same window gets a different key', async () => {
    init();
    for (const durationHours of [24, 72]) {
      await runRoute('post', '/listings/:id/boost', {
        params: { id: 'listing-a' },
        body: { durationHours },
        headers: {},
        user: buyer,
      }).catch(() => undefined);
    }
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });
});

describe('PATCH /orders/:id authorises fields by role (finding 11)', () => {
  const ORDER = {
    id: 'ord-1',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    status: 'paid',
  };

  const patch = (userId: string, body: Record<string, unknown>, calls?: Call[]) =>
    runRoute('patch', '/orders/:id', {
      params: { id: 'ord-1' },
      body,
      headers: {},
      user: { id: userId },
    });

  it('refuses a buyer writing seller_note', async () => {
    init();
    mockGetOrderById.mockResolvedValue(ORDER);
    const res = await patch('buyer-1', { action: 'noop', sellerNote: 'meet me elsewhere' });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/only the seller/i);
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  it('refuses a buyer changing fulfillment_mode', async () => {
    init();
    mockGetOrderById.mockResolvedValue(ORDER);
    const res = await patch('buyer-1', { action: 'noop', fulfillmentMode: 'hall_dropoff' });
    expect(res.statusCode).toBe(403);
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  it('rejects a fulfillment_mode outside the column CHECK, even from the seller', async () => {
    init();
    mockGetOrderById.mockResolvedValue(ORDER);
    const res = await patch('seller-1', { action: 'noop', fulfillmentMode: 'teleport' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/campus_meetup/);
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  it('lets the seller set both fields, scoped to seller_id', async () => {
    const { calls } = init();
    mockGetOrderById.mockResolvedValue(ORDER);
    mockUpdateOrderStatus.mockResolvedValue({ ...ORDER, status: 'ready_for_pickup' });

    const res = await patch('seller-1', {
      action: 'mark_ready',
      sellerNote: 'By the library steps',
      fulfillmentMode: 'hall_dropoff',
    });
    expect(res.statusCode).toBe(200);

    const write = calls.find((c) => c.table === 'marketplace_orders');
    expect(write).toBeDefined();
    const updated = write!.ops.find((o) => o.fn === 'update')!.args[0];
    expect(updated).toEqual({
      seller_note: 'By the library steps',
      fulfillment_mode: 'hall_dropoff',
    });
    // Two exact filters, never an interpolated .or() string.
    expect(write!.ops.some((o) => o.fn === 'or')).toBe(false);
    expect(write!.ops.some((o) => o.fn === 'eq' && o.args[0] === 'seller_id')).toBe(true);
  });

  it('still lets the buyer set the shared meeting location', async () => {
    const { calls } = init();
    mockGetOrderById.mockResolvedValue(ORDER);
    mockUpdateOrderStatus.mockResolvedValue(ORDER);

    const res = await patch('buyer-1', { action: 'noop', meetingLocation: 'Main gate' });
    expect(res.statusCode).toBe(200);
    const write = calls.find((c) => c.table === 'marketplace_orders');
    expect(write!.ops.find((o) => o.fn === 'update')!.args[0]).toEqual({
      meeting_location: 'Main gate',
    });
    expect(write!.ops.some((o) => o.fn === 'eq' && o.args[0] === 'buyer_id')).toBe(true);
  });
});
