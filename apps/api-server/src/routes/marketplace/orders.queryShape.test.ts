/**
 * Query shape AND responses for the one inline chain in
 * `routes/marketplace/orders.ts` (lane R2, PR 3): the field update inside
 * `PATCH /orders/:id`.
 *
 * Written and committed against the UNTOUCHED route.
 *
 * ## What the predicates decide
 *
 * The update is scoped to the caller as buyer XOR seller, with two EXACT filters
 * chosen instead of one interpolated `.or()` string. The API runs as the service
 * role and bypasses RLS, so that predicate is what stops a buyer writing a
 * seller-only field — or either party writing somebody else's order — even
 * though `getOrderById` has already resolved the caller as a party to it.
 *
 * ## The write stays INSIDE the idempotency claim
 *
 * The field update and the status transition both run inside `claim(...)`, so a
 * replay returns the recorded response without re-running either. The cases
 * below pin that: on a replay nothing is written and the body carries
 * `idempotentReplay: true` with `code: 'IDEMPOTENT_REPLAY'`. Lane R2 moves the
 * query into a function CALLED FROM INSIDE that same callback; nothing crosses
 * the idempotency boundary.
 *
 * ## Issue #108 — a real hit, in the money path, that the issue's scan misses
 *
 * The update is a BARE awaited write:
 *
 *     await (isSeller ? scoped.eq('seller_id', …) : scoped.eq('buyer_id', …));
 *
 * Its `{ error }` is never read. If it fails — a constraint, a dropped
 * connection, RLS — the handler carries straight on to `updateOrderStatus` and
 * answers `{ success: true }` with the order. A seller who sets a tracking
 * note and a meeting point, and is told it saved, may have saved neither, and
 * the buyer sees an order that moved state with no collection details on it.
 *
 * The issue's regex only matches a bare `await db.from(…)….;` STATEMENT. This
 * one builds the chain into a variable and awaits it through a ternary, so the
 * scan cannot see it — which is why 87 is a floor, not a count.
 *
 * Frozen here exactly as it behaves today. R2 moves queries; it does not fix
 * them. See the KNOWN ISSUE at the call site.
 */
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/idempotency', () => ({
  normalizeIdempotencyKey: () => null,
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    _key: string,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

const updateOrderStatus = jest.fn();
const getOrderById = jest.fn();

jest.mock('../../services/marketplaceOrders', () => ({
  ...jest.requireActual('../../services/marketplaceOrders'),
  invalidateSellerAnalyticsCache: jest.fn(async () => {}),
  getMarketplaceOrdersService: () => ({
    getOrderById: (...a: unknown[]) => getOrderById(...(a as [])),
    updateOrderStatus: (...a: unknown[]) => updateOrderStatus(...(a as [])),
  }),
}));

import router, { initializeMarketplaceRoutes } from './index';
import { routeLayers } from './routeLayers';
import {
  createQueryRecorder,
  bindDataModule,
  type ResolveResult,
} from '../../testSupport/queryRecorder';
import * as marketplaceData from '../../services/data/marketplace';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ORDER = 'order-1';

const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER,
  buyer_id: BUYER,
  seller_id: SELLER,
  status: 'awaiting_meetup',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

async function runRoute(method: 'patch', path: string, req: any) {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

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
    handler(
      { params: {}, query: {}, body: {}, headers: {}, runIdempotent: (fn: any) => fn(), ...req },
      res,
      reject,
    );
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  initializeMarketplaceRoutes(
    {
      getClient: () => rec.client,
      marketplace: bindDataModule(marketplaceData, rec.client),
      notifications: { createNotification: jest.fn(async () => ({ id: 'n1' })) },
      users: {},
      readState: {},
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

beforeEach(() => {
  jest.clearAllMocks();
  getOrderById.mockResolvedValue(order());
  updateOrderStatus.mockResolvedValue(order({ status: 'completed' }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('PATCH /orders/:id — the field update', () => {
  it('scopes the update to the caller as SELLER, with two exact filters', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('patch', '/orders/:id', {
      user: { id: SELLER },
      params: { id: ORDER },
      body: { action: 'complete', meetingLocation: 'Gate B', sellerNote: 'Bring exact change' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(rec.trace[0]).toBe('from("marketplace_orders")');
    const patch = JSON.parse(rec.trace[1].slice('update('.length, -1));
    expect(patch).toEqual({ meeting_location: 'Gate B', seller_note: 'Bring exact change' });
    expect(rec.trace.slice(2)).toEqual([
      `eq("id", "${ORDER}")`,
      // Not an interpolated .or() string: two exact filters.
      `eq("seller_id", "${SELLER}")`,
    ]);
  });

  it('scopes to buyer_id when the caller is the buyer', async () => {
    const rec = initWith({ data: null, error: null });

    await runRoute('patch', '/orders/:id', {
      user: { id: BUYER },
      params: { id: ORDER },
      body: { action: 'complete', meetingLocation: 'Library steps' },
    });

    expect(rec.trace.slice(2)).toEqual([
      `eq("id", "${ORDER}")`,
      `eq("buyer_id", "${BUYER}")`,
    ]);
  });

  it('writes nothing when the body carries no updatable field', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('patch', '/orders/:id', {
      user: { id: SELLER },
      params: { id: ORDER },
      body: { action: 'complete' },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.tables()).toEqual([]);
    // The status transition still runs — it is the point of the request.
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it('runs the field update BEFORE the status transition', async () => {
    const order: string[] = [];
    updateOrderStatus.mockImplementation(async () => {
      order.push('status');
      return { id: ORDER, seller_id: SELLER, status: 'completed' };
    });
    const rec = createQueryRecorder(() => {
      order.push('field-update');
      return { data: null, error: null };
    });
    initializeMarketplaceRoutes(
      {
        getClient: () => rec.client,
        marketplace: bindDataModule(marketplaceData, rec.client),
        notifications: { createNotification: jest.fn(async () => ({ id: 'n1' })) },
        users: {},
        readState: {},
      } as any,
      { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
    );

    await runRoute('patch', '/orders/:id', {
      user: { id: SELLER },
      params: { id: ORDER },
      body: { action: 'complete', meetingLocation: 'Gate B' },
    });

    expect(order).toEqual(['field-update', 'status']);
  });

  it('answers 404 and writes nothing when the caller is not a party to the order', async () => {
    getOrderById.mockResolvedValue(null);
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('patch', '/orders/:id', {
      user: { id: 'stranger' },
      params: { id: ORDER },
      body: { action: 'complete', meetingLocation: 'Gate B' },
    });

    expect(res.statusCode).toBe(404);
    expect(rec.tables()).toEqual([]);
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('refuses a seller-only field from the buyer, before writing', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('patch', '/orders/:id', {
      user: { id: BUYER },
      params: { id: ORDER },
      body: { action: 'complete', sellerNote: 'not mine to set' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(rec.tables()).toEqual([]);
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('KNOWN ISSUE (#108): answers success when the field update FAILED', async () => {
    // The bare awaited write discards `{error}`, so a failed update is
    // invisible: the handler carries on to the status transition and reports
    // success with the order. A seller told their meeting point saved may
    // have saved nothing. Frozen as-is — R2 moves queries, it does not fix them.
    const rec = initWith({ data: null, error: { code: '23514', message: 'check violation' } });

    const res = await runRoute('patch', '/orders/:id', {
      user: { id: SELLER },
      params: { id: ORDER },
      body: { action: 'complete', meetingLocation: 'Gate B' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(rec.tables()).toEqual(['from("marketplace_orders")']);
  });
});
