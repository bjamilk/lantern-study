/**
 * PATCH /orders/:id when the FIELD write fails (#108, Phase B).
 *
 * The handler updates the shared meeting details — meeting point, seller note,
 * fulfilment mode — then drives the status transition and answers
 * `{ success: true }`. That field write goes through
 * `marketplace.updateOrderFieldsAsParty`, which RESOLVES with `{ error }`
 * rather than throwing, and the route discards it. It is marked
 * `// KNOWN ISSUE (tracked, #108)` by #111, which moved the query without
 * fixing it.
 *
 * So today a seller who sets a meeting point and a note is told it saved when
 * neither did, and the order still moves state — the buyer then sees an order
 * that advanced with no collection details on it.
 *
 * It is MUST-SUCCEED: the field write runs BEFORE the status transition, so
 * failing there leaves the order exactly as it was rather than half-applied.
 *
 * Driven over the real router with the real replay store behind it, because the
 * answer the seller gets is the thing under test, not the promise.
 */
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'seller-1', permissions: [], credentialType: 'jwt' };
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
import { errorHandler } from '../../middleware/errorHandler';

const ORDER_ID = 'ord_1';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

/** Whether the order-field write is failing for this case. */
let fieldWriteFails = false;
/** Every patch the route sent to `marketplace_orders`. */
let fieldWrites: Array<Record<string, unknown>> = [];

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
            Promise.resolve(
              fieldWriteFails ? { data: null, error: WRITE_ERROR } : { data: null, error: null },
            ).then(resolve, reject),
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

describe('PATCH /orders/:id when the field write fails', () => {
  let server: http.Server;
  let base: string;

  const patch = async (body: unknown) => {
    const res = await fetch(`${base}/api/v1/marketplace/orders/${ORDER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    setIdempotencyClient(() => fakeClient() as any);
    // The real data module is deliberately NOT bound here: this suite is about
    // the route's handling of the `{ error }` the layer hands back, so the
    // layer function is the one line of stand-in it needs.
    initializeMarketplaceContext(
      {
        getClient: () => fakeClient(),
        marketplace: {
          updateOrderFieldsAsParty: async (
            _orderId: string,
            _userId: string,
            _isSeller: boolean,
            fieldUpdates: Record<string, unknown>,
          ) => {
            fieldWrites.push(fieldUpdates);
            return { error: fieldWriteFails ? WRITE_ERROR : null };
          },
        },
      } as any,
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
    // The route deliberately rethrows a SERVER fault rather than answering it
    // as a 4xx, so the production error handler has to be mounted for the
    // status the seller actually receives to be observable here.
    app.use(errorHandler as any);
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
    fieldWriteFails = false;
    mockUpdateOrderStatus.mockReset().mockImplementation(async () => ({
      id: ORDER_ID,
      seller_id: 'seller-1',
      status: 'shipped',
    }));
    mockGetOrderById.mockReset().mockResolvedValue({
      id: ORDER_ID,
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      status: 'paid',
      updated_at: '2026-09-17T10:00:00.000Z',
    });
  });

  it('saves the fields and moves the order when the write succeeds', async () => {
    const res = await patch({
      action: 'mark_shipped',
      meetingLocation: 'Gate 3',
      sellerNote: 'Ask for Ade at the kiosk',
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual(expect.objectContaining({ success: true }));
    expect(fieldWrites[0]).toEqual(
      expect.objectContaining({ meeting_location: 'Gate 3', seller_note: 'Ask for Ade at the kiosk' }),
    );
    expect(mockUpdateOrderStatus).toHaveBeenCalled();
  });

  it('does NOT answer success when nothing saved', async () => {
    fieldWriteFails = true;
    const res = await patch({
      action: 'mark_shipped',
      meetingLocation: 'Gate 3',
      sellerNote: 'Ask for Ade at the kiosk',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.success).not.toBe(true);
  });

  it('does NOT move the order, so nothing is half-applied', async () => {
    // The field write runs before the status transition, so failing there
    // leaves the order exactly as it was rather than advanced without its
    // collection details.
    fieldWriteFails = true;
    await patch({ action: 'mark_shipped', meetingLocation: 'Gate 3' });
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  it('leaks neither the PostgREST message nor the table name IN PRODUCTION', async () => {
    // Outside production the handler deliberately returns the real message, so
    // the only honest place to assert this is with NODE_ENV set. The message
    // `WriteFailedError` carries is written for logs and alerting, not for the
    // seller, and this is what keeps the two apart.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      fieldWriteFails = true;
      const res = await patch({ action: 'mark_shipped', meetingLocation: 'Gate 3' });
      const body = JSON.stringify(res.json);
      expect(body).not.toContain('serialize access');
      expect(body).not.toContain('marketplace_orders');
      expect(body).not.toContain('40001');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('frees the action for a retry with a new key rather than replaying the failure', async () => {
    // A handler that throws marks its idempotency key failed for 10 minutes
    // (services/idempotency.ts), which is the designed answer: nothing was
    // applied, so there is nothing to replay, and the client retries with a new
    // key. What must NOT happen is the failure being cached as the result.
    fieldWriteFails = true;
    await patch({ action: 'mark_shipped', meetingLocation: 'Gate 3' });
    fieldWriteFails = false;
    keyStore = [];
    const retry = await patch({ action: 'mark_shipped', meetingLocation: 'Gate 3' });
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(expect.objectContaining({ success: true }));
  });
});
