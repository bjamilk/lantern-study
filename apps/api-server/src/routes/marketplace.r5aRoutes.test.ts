/**
 * R5a route-level proofs for F7b deferrals (a) and (b).
 *
 *   (a) GET /categories/custom missed the `await` on `cacheService.get`, so
 *       `cached` was a pending Promise — always truthy — and the route answered
 *       `{success:true,data:{}}` on every request while
 *       `supabaseService.getCustomCategories()` was unreachable.
 *   (b) PATCH /orders/:id carried no `idempotencyMiddleware`, unlike its money
 *       siblings, so two concurrent `confirm_received` calls both ran the
 *       payout release.
 *
 * Both are driven through the real router layers (flattened across the R5a
 * sub-routers), so the wiring — not just a helper — is what is asserted.
 */
jest.mock('../services/marketplaceOrders', () => ({
  ...jest.requireActual('../services/marketplaceOrders'),
  getMarketplaceOrdersService: jest.fn(),
  invalidateSellerAnalyticsCache: jest.fn(async () => {}),
}));

import router, { initializeMarketplaceRoutes } from './marketplace';
import { routeLayers } from './marketplace/routeLayers';
import { setIdempotencyClient } from '../middleware/idempotency';
import {
  getMarketplaceOrdersService,
  invalidateSellerAnalyticsCache,
} from '../services/marketplaceOrders';

type Row = { user_id: string; operation: string; idempotency_key: string; response: unknown };

/** In-memory stand-in for `api_idempotency_keys` (same shape as services/idempotency.test.ts). */
function createMemoryClient(store: Row[] = []) {
  const match = (f: Record<string, string>, r: Row) =>
    r.user_id === f.user_id && r.operation === f.operation && r.idempotency_key === f.idempotency_key;

  const eqChain = (onDone: (f: Record<string, string>) => Promise<unknown>) => {
    const filters: Record<string, string> = {};
    const chain: any = {
      eq(col: string, val: string) {
        filters[col] = val;
        return chain;
      },
      maybeSingle: () => onDone(filters),
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        Promise.resolve(onDone(filters)).then(resolve, reject);
      },
    };
    return chain;
  };

  return {
    store,
    client: {
      rpc: async () => ({ data: null, error: null }),
      from() {
        return {
          insert(row: Row) {
            if (store.some((r) => match(row as any, r))) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            }
            store.push({ ...row });
            return Promise.resolve({ data: row, error: null });
          },
          select() {
            return eqChain(async (f) => {
              const found = store.find((r) => match(f, r));
              return { data: found ? { response: found.response } : null, error: null };
            });
          },
          update(patch: { response: unknown }) {
            return eqChain(async (f) => {
              const row = store.find((r) => match(f, r));
              if (row) row.response = patch.response;
              return { data: row, error: null };
            });
          },
          delete() {
            return eqChain(async (f) => {
              const i = store.findIndex((r) => match(f, r));
              if (i >= 0) store.splice(i, 1);
              return { data: null, error: null };
            });
          },
        };
      },
    },
  };
}

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), (res.headersSent = true), res);
  res.set = () => res;
  return res;
}

/** Run every layer of a route except `authMiddleware` (the request is pre-authed). */
async function runRoute(method: string, path: string, req: any) {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handles = layer.route.stack
    .map((s: any) => s.handle)
    .filter((h: any) => h.name !== 'authMiddleware' && h.name !== 'optionalAuthMiddleware');

  const res = fakeRes();
  let thrownErr: unknown;
  for (const handle of handles) {
    if (res.headersSent) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve, reject) => {
      const done = (err?: unknown) => (err ? reject(err) : resolve());
      const origJson = res.json;
      res.json = (b: unknown) => {
        const out = origJson(b);
        resolve();
        return out;
      };
      try {
        const out = handle(req, res, done);
        if (out && typeof out.then === 'function') out.then(() => {}, reject);
      } catch (e) {
        reject(e);
      }
    }).catch((e) => {
      thrownErr = e;
    });
    if (thrownErr) break;
  }
  return { res, thrownErr };
}

describe('R5a (a): GET /categories/custom awaits the cache read', () => {
  it('uses the cached array on a hit and never calls the service', async () => {
    const getCustomCategories = jest.fn(async () => [{ name: 'lab-coats' }]);
    const cache: any = {
      get: jest.fn(async () => [{ name: 'from-cache' }]),
      set: jest.fn(async () => {}),
      deletePattern: jest.fn(async () => {}),
    };
    initializeMarketplaceRoutes({ getCustomCategories } as any, cache);

    const { res } = await runRoute('get', '/categories/custom', { params: {}, body: {}, headers: {} });

    expect(cache.get).toHaveBeenCalledWith('marketplace:custom_categories');
    expect(res.body).toEqual({ success: true, data: [{ name: 'from-cache' }] });
    // Before the fix the unawaited Promise was truthy and `data` was that
    // Promise serialised to `{}` — never an array, and never the service's rows.
    expect(Array.isArray((res.body as any).data)).toBe(true);
    expect(getCustomCategories).not.toHaveBeenCalled();
  });

  it('falls through to the service on a miss and caches the result', async () => {
    const getCustomCategories = jest.fn(async () => [{ name: 'lab-coats' }]);
    const cache: any = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {}),
      deletePattern: jest.fn(async () => {}),
    };
    initializeMarketplaceRoutes({ getCustomCategories } as any, cache);

    const { res } = await runRoute('get', '/categories/custom', { params: {}, body: {}, headers: {} });

    expect(getCustomCategories).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ success: true, data: [{ name: 'lab-coats' }] });
    expect(cache.set).toHaveBeenCalledWith('marketplace:custom_categories', [{ name: 'lab-coats' }], 300);
  });
});

describe('R5a (b): PATCH /orders/:id is idempotent like its money siblings', () => {
  const ORDER = { id: 'o1', buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'paid' };

  function wireOrdersService() {
    const updateOrderStatus = jest.fn(async () => ({ ...ORDER, status: 'completed' }));
    (getMarketplaceOrdersService as jest.Mock).mockReturnValue({
      getOrderById: jest.fn(async () => ORDER),
      updateOrderStatus,
    });
    return updateOrderStatus;
  }

  function patchReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return { params: { id: 'o1' }, body, headers, user: { id: 'buyer-1' } };
  }

  /**
   * UPDATED (G3 · H0b): the route's FALLBACK key now needs the order's current
   * version, which is only known after the order is read, so it is derived in
   * the handler (against `supabaseService.getClient()`) rather than in the
   * synchronous middleware. In production that is the same client the
   * middleware uses — `server.ts:211` wires `setIdempotencyClient(() =>
   * supabaseService.getClient())` — so the stub here has to be the same store
   * too, or the fallback path writes into a client that has no table.
   */
  let sharedStore: Row[] = [];

  beforeEach(() => {
    (invalidateSellerAnalyticsCache as jest.Mock).mockClear();
    sharedStore = [];
    const { client } = createMemoryClient(sharedStore);
    setIdempotencyClient(() => client as any);
    initializeMarketplaceRoutes(
      {
        getClient: () => ({
          ...client,
          from: (table: string) =>
            table === 'marketplace_orders'
              ? { update: () => ({ eq: () => ({ eq: async () => ({}) }) }) }
              : (client as any).from(table),
        }),
      } as any,
      { get: async () => null, set: async () => {}, deletePattern: async () => {} } as any
    );
  });

  it('carries idempotencyMiddleware on the route chain', () => {
    const layer = routeLayers(router).find(
      (l: any) => l.route?.path === '/orders/:id' && l.route?.methods?.patch
    );
    const names = layer.route.stack.map((s: any) => s.handle.name);
    // The middleware factory returns an anonymous arrow, so assert positionally:
    // authMiddleware, the idempotency middleware, then the asyncHandler body.
    expect(names[0]).toBe('authMiddleware');
    expect(layer.route.stack).toHaveLength(3);
  });

  it('replays the cached response instead of re-running the mutation', async () => {
    const store = sharedStore;
    const updateOrderStatus = wireOrdersService();

    const first = await runRoute('patch', '/orders/:id', patchReq({ action: 'confirm_received' }));
    expect(first.thrownErr).toBeUndefined();
    expect(first.res.body).toMatchObject({ success: true, data: { status: 'completed' } });
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    expect(store[0].operation).toBe('marketplace_order_action');

    const second = await runRoute('patch', '/orders/:id', patchReq({ action: 'confirm_received' }));
    // UPDATED (G3 · H0b): the replayed body is the recorded one plus a marker,
    // so a client can tell "applied just now" from "this is the answer to a
    // request you already made".
    expect(second.res.body).toEqual({
      ...(first.res.body as Record<string, unknown>),
      idempotentReplay: true,
      code: 'IDEMPOTENT_REPLAY',
    });
    // The payout release ran exactly once, which is the whole point.
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it('derives the fallback key from the request content, not a bare time bucket', async () => {
    const store = sharedStore;
    wireOrdersService();

    await runRoute('patch', '/orders/:id', patchReq({ action: 'confirm_received' }));
    await runRoute('patch', '/orders/:id', patchReq({ action: 'dispute', disputeReason: 'never arrived' }));

    expect(store).toHaveLength(2);
    expect(store[0].idempotency_key).not.toBe(store[1].idempotency_key);
    expect(store[0].idempotency_key.startsWith('buyer-1:order_action:')).toBe(true);
  });

  it('honours an explicit Idempotency-Key header over the fallback', async () => {
    const store = sharedStore;
    const updateOrderStatus = wireOrdersService();

    await runRoute('patch', '/orders/:id', patchReq({ action: 'confirm_received' }, { 'idempotency-key': 'client-key-1' }));
    // A DIFFERENT body under the SAME client key must still replay.
    await runRoute('patch', '/orders/:id', patchReq({ action: 'dispute' }, { 'idempotency-key': 'client-key-1' }));

    expect(store).toHaveLength(1);
    expect(store[0].idempotency_key).toBe('client-key-1');
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the same key is already in flight, not 400', async () => {
    const { client } = createMemoryClient([
      {
        user_id: 'buyer-1',
        operation: 'marketplace_order_action',
        idempotency_key: 'client-key-2',
        response: { _status: '__processing__' },
      },
    ]);
    setIdempotencyClient(() => client as any);
    wireOrdersService();

    const { res, thrownErr } = await runRoute(
      'patch',
      '/orders/:id',
      patchReq({ action: 'confirm_received' }, { 'idempotency-key': 'client-key-2' })
    );

    expect(thrownErr).toBeUndefined();
    // Before R5a the name-check heuristic reported this as a 400 carrying the
    // internal sentence "Concurrent idempotent request timed out".
    expect(res.statusCode).toBe(409);
    // UPDATED (G3 · H7): the refusal's own code reaches the client now, so it
    // can tell "retry this key" from "mint a new one".
    expect(res.body).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONCURRENT' });
  }, 20_000);

  it('answers 409 when a previous attempt with the key failed', async () => {
    const { client } = createMemoryClient([
      {
        user_id: 'buyer-1',
        operation: 'marketplace_order_action',
        idempotency_key: 'client-key-3',
        response: { _status: '__failed__', _failedAt: new Date().toISOString() },
      },
    ]);
    setIdempotencyClient(() => client as any);
    wireOrdersService();

    const { res } = await runRoute(
      'patch',
      '/orders/:id',
      patchReq({ action: 'confirm_received' }, { 'idempotency-key': 'client-key-3' })
    );

    expect(res.statusCode).toBe(409);
    // UPDATED (G3 · H7): distinct from IDEMPOTENCY_CONCURRENT — this one means
    // the key is burnt and the client must mint a new one.
    expect(res.body).toMatchObject({ success: false, code: 'IDEMPOTENCY_PREVIOUS_FAILED' });
  });
});
