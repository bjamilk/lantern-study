/**
 * PATCH /orders/:id at the HTTP layer, with the REAL replay store behind it
 * (G3 · H0b).
 *
 * No client sends an `Idempotency-Key` on this route, so every call takes the
 * fallback key. That key used to be `hash(orderId, action, meetingLocation, …)`
 * plus a 5-minute bucket, which silently swallowed a legitimate re-set: buyer
 * sets the meeting point to "Library", seller changes it to "Gate 3", buyer
 * re-sets "Library" two minutes later — same body, same bucket, same key, so
 * the write was skipped and the buyer was told it worked.
 *
 * The fix folds the order's own `updated_at` into the key material, so these
 * tests drive the boundary rather than the helper: same body + same version
 * replays, same body + a moved version executes.
 */
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'buyer-1', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/marketplaceCache', () => ({
  invalidateListingCaches: async () => undefined,
}));

const mockGetOrderById = jest.fn();
const mockUpdateOrderStatus = jest.fn();
jest.mock('../../services/marketplaceOrders', () => ({
  getMarketplaceOrdersService: () => ({
    getOrderById: mockGetOrderById,
    updateOrderStatus: mockUpdateOrderStatus,
  }),
  invalidateSellerAnalyticsCache: async () => undefined,
}));

import express from 'express';
import http from 'http';
import ordersRouter from './orders';
import { initializeMarketplaceContext } from './context';
import { setIdempotencyClient } from '../../middleware/idempotency';

const ORDER_ID = 'ord_1';

/** Rows written to marketplace_orders by the field-mutation half of the route. */
let fieldWrites: Array<Record<string, unknown>> = [];
/** The replay store, honest about (user_id, operation, key). */
type KeyRow = { user_id: string; operation: string; idempotency_key: string; response: any };
let keyStore: KeyRow[] = [];

function fakeClient() {
  const match = (filters: Array<[string, unknown]>, row: KeyRow) =>
    filters.every(([col, val]) => {
      if (col === 'response->>_status') return row.response?._status === val;
      return (row as any)[col] === val;
    });

  return {
    from(table: string) {
      if (table === 'marketplace_orders') {
        const chain: any = {
          update(patch: Record<string, unknown>) {
            fieldWrites.push(patch);
            return chain;
          },
          eq: () => chain,
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        };
        return chain;
      }
      if (table !== 'api_idempotency_keys') throw new Error(`unexpected table: ${table}`);
      const filtered = (onDone: (f: Array<[string, unknown]>) => Promise<unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain: any = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return chain;
          },
          select: () => chain,
          maybeSingle: () => onDone(filters),
          then: (resolve: any, reject: any) => Promise.resolve(onDone(filters)).then(resolve, reject),
        };
        return chain;
      };
      return {
        insert(row: KeyRow) {
          const clash = keyStore.some(
            (r) =>
              r.user_id === row.user_id &&
              r.operation === row.operation &&
              r.idempotency_key === row.idempotency_key,
          );
          if (clash) {
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
          }
          keyStore.push({ ...row });
          return Promise.resolve({ data: row, error: null });
        },
        select: () =>
          filtered(async (filters) => {
            const found = keyStore.find((r) => match(filters, r));
            return { data: found ? { response: found.response } : null, error: null };
          }),
        update: (patch: { response: unknown }) =>
          filtered(async (filters) => {
            const row = keyStore.find((r) => match(filters, r));
            if (!row) return { data: null, error: null };
            row.response = patch.response;
            return { data: { idempotency_key: row.idempotency_key }, error: null };
          }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

describe('PATCH /orders/:id replay window', () => {
  let server: http.Server;
  let base: string;

  const patch = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/v1/marketplace/orders/${ORDER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    // Production wires both of these to the SAME client (server.ts:211): the
    // middleware owns the client-supplied-key path, the handler owns the
    // version-aware fallback.
    setIdempotencyClient(() => fakeClient() as any);
    initializeMarketplaceContext(
      { getClient: () => fakeClient() } as any,
      {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        deletePattern: async () => undefined,
      } as any,
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/marketplace', ordersRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    fieldWrites = [];
    keyStore = [];
    mockUpdateOrderStatus.mockReset().mockImplementation(async () => ({
      id: ORDER_ID,
      seller_id: 'seller-1',
      status: 'paid',
    }));
    mockGetOrderById.mockReset();
  });

  const orderAt = (updatedAt: string) => ({
    id: ORDER_ID,
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    status: 'paid',
    updated_at: updatedAt,
  });

  it('applies a re-set of the same field after the order has moved on', async () => {
    // Buyer sets "Library".
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:00:00.000Z'));
    const first = await patch({ action: 'confirm', meetingLocation: 'Library' });
    expect(first.status).toBe(200);

    // Seller changes it to "Gate 3" — the order row moves.
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:01:00.000Z'));
    const reset = await patch({ action: 'confirm', meetingLocation: 'Library' });

    expect(reset.status).toBe(200);
    // The write actually happened the second time: two meeting_location writes.
    expect(fieldWrites.filter((w) => w.meeting_location === 'Library')).toHaveLength(2);
    expect(mockUpdateOrderStatus).toHaveBeenCalledTimes(2);
    expect(reset.json.idempotentReplay).toBeUndefined();
  });

  it('still replays a true double-submit: same body, same version', async () => {
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:00:00.000Z'));
    const first = await patch({ action: 'confirm', meetingLocation: 'Library' });
    const second = await patch({ action: 'confirm', meetingLocation: 'Library' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Ran once, replayed once.
    expect(mockUpdateOrderStatus).toHaveBeenCalledTimes(1);
    expect(fieldWrites).toHaveLength(1);
    // And the replay says so, so a client can tell "applied now" from
    // "this is the answer to a request you already made".
    expect(first.json.idempotentReplay).toBeUndefined();
    expect(second.json.idempotentReplay).toBe(true);
    expect(second.json.code).toBe('IDEMPOTENT_REPLAY');
    expect(second.json.data).toEqual(first.json.data);
  });

  it('keeps two different actions on one order in separate slots', async () => {
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:00:00.000Z'));
    await patch({ action: 'confirm' });
    await patch({ action: 'ship' });
    expect(mockUpdateOrderStatus).toHaveBeenCalledTimes(2);
  });

  it('honours a client-supplied Idempotency-Key over the derived one', async () => {
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:00:00.000Z'));
    await patch({ action: 'confirm' }, { 'Idempotency-Key': 'client-key-1' });
    // Same key, and the order has since moved: the client owns the key, so this
    // is still a replay.
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:05:00.000Z'));
    const replay = await patch({ action: 'confirm' }, { 'Idempotency-Key': 'client-key-1' });

    expect(mockUpdateOrderStatus).toHaveBeenCalledTimes(1);
    expect(replay.json.idempotentReplay).toBe(true);
    // The header key and the derived key must land in the same operation slot,
    // or neither would ever see the other's response.
    expect(new Set(keyStore.map((r) => r.operation))).toEqual(
      new Set(['marketplace_order_action']),
    );
  });

  it('a validation refusal never burns a key', async () => {
    mockGetOrderById.mockResolvedValue(orderAt('2026-09-15T10:00:00.000Z'));
    const bad = await patch({ meetingLocation: 'Library' }); // no action
    expect(bad.status).toBe(400);
    expect(keyStore).toHaveLength(0);

    const corrected = await patch({ action: 'confirm', meetingLocation: 'Library' });
    expect(corrected.status).toBe(200);
    expect(mockUpdateOrderStatus).toHaveBeenCalledTimes(1);
  });
});
