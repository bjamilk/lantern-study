/**
 * POST /cart/checkout replay scope (G3 · H8).
 *
 * Both clients scope their `Idempotency-Key` as
 * `cart_checkout:<addressId>:<sellerId:mode…>` — nothing about what is in the
 * cart — and a client-supplied header WINS over the server's content-hashed
 * fallback. So: checkout times out client-side, the buyer removes an item and
 * checks out again, same key, and the server replayed the first response — the
 * previous cart's authorization URL and total, for items the buyer no longer
 * wants to buy.
 *
 * The fix binds a fingerprint of the cart (listing ids, quantities, prices) to
 * the OPERATION, which is part of the store's primary key
 * (user_id, operation, idempotency_key). That holds no matter who chose the
 * key, which is the only way to fix it server-side.
 */
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'buyer-1', email: 'buyer@example.com', permissions: [] };
    next();
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/marketplaceCache', () => ({
  invalidateListingCaches: async () => undefined,
}));
jest.mock('../../services/marketplaceOrders', () => ({
  invalidateSellerAnalyticsCache: async () => undefined,
}));

let cart: any[] = [];
jest.mock('../../services/marketplaceCart', () => ({
  getMarketplaceCartService: () => ({ listCart: async () => cart }),
}));

const mockCreateFromCart = jest.fn();
jest.mock('../../services/marketplaceCheckout', () => ({
  getMarketplaceCheckoutService: () => ({ createFromCart: mockCreateFromCart }),
}));

import express from 'express';
import http from 'http';
import cartRouter from './cart';
import { initializeMarketplaceContext } from './context';

type KeyRow = { user_id: string; operation: string; idempotency_key: string; response: any };
let keyStore: KeyRow[] = [];

function fakeClient() {
  const match = (filters: Array<[string, unknown]>, row: KeyRow) =>
    filters.every(([col, val]) => {
      if (col === 'response->>_status') return row.response?._status === val;
      return (row as any)[col] === val;
    });
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
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      if (table !== 'api_idempotency_keys') throw new Error(`unexpected table: ${table}`);
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
  };
}

const line = (listingId: string, quantity: number, price: number) => ({
  id: `ci_${listingId}`,
  listing_id: listingId,
  quantity,
  listing: { id: listingId, user_id: 'seller-1', price },
});

describe('POST /cart/checkout replay scope', () => {
  let server: http.Server;
  let base: string;

  const checkout = async (headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/v1/marketplace/cart/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ addressId: 'addr_1' }),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    initializeMarketplaceContext(
      {
        getClient: () => ({
          ...fakeClient(),
          auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
        }),
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
    app.use('/api/v1/marketplace', cartRouter);
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
    keyStore = [];
    let n = 0;
    mockCreateFromCart.mockReset().mockImplementation(async () => {
      n += 1;
      return {
        checkout: { id: `chk_${n}` },
        orders: [],
        authorizationUrl: `https://paystack.test/pay/${n}`,
      };
    });
  });

  const CLIENT_KEY = { 'Idempotency-Key': 'cart_checkout:addr_1:seller-1:campus_meetup' };

  it('does not replay the old checkout after an item is removed, even on the same client key', async () => {
    cart = [line('lst_1', 1, 5000), line('lst_2', 1, 3000)];
    const first = await checkout(CLIENT_KEY);
    expect(first.json.data.authorizationUrl).toBe('https://paystack.test/pay/1');

    cart = [line('lst_1', 1, 5000)];
    const second = await checkout(CLIENT_KEY);

    expect(mockCreateFromCart).toHaveBeenCalledTimes(2);
    expect(second.json.data.authorizationUrl).toBe('https://paystack.test/pay/2');
  });

  it.each([
    ['a changed quantity', () => [line('lst_1', 2, 5000)]],
    ['a changed price', () => [line('lst_1', 1, 5500)]],
  ])('does not replay after %s', async (_label, mutate) => {
    cart = [line('lst_1', 1, 5000)];
    await checkout(CLIENT_KEY);
    cart = mutate();
    await checkout(CLIENT_KEY);
    expect(mockCreateFromCart).toHaveBeenCalledTimes(2);
  });

  it('still replays a true duplicate submit of the SAME cart', async () => {
    cart = [line('lst_1', 1, 5000), line('lst_2', 1, 3000)];
    const first = await checkout(CLIENT_KEY);
    const second = await checkout(CLIENT_KEY);

    expect(mockCreateFromCart).toHaveBeenCalledTimes(1);
    expect(second.json.data.authorizationUrl).toBe(first.json.data.authorizationUrl);
  });

  it('replays the same cart regardless of item order', async () => {
    cart = [line('lst_1', 1, 5000), line('lst_2', 1, 3000)];
    await checkout(CLIENT_KEY);
    cart = [line('lst_2', 1, 3000), line('lst_1', 1, 5000)];
    await checkout(CLIENT_KEY);
    expect(mockCreateFromCart).toHaveBeenCalledTimes(1);
  });

  it('scopes the operation to the cart contents', async () => {
    cart = [line('lst_1', 1, 5000)];
    await checkout(CLIENT_KEY);
    cart = [line('lst_2', 1, 5000)];
    await checkout(CLIENT_KEY);
    const operations = keyStore.map((r) => r.operation);
    expect(operations).toHaveLength(2);
    expect(new Set(operations).size).toBe(2);
    for (const op of operations) expect(op).toMatch(/^marketplace_cart_checkout:[0-9a-f]{32}$/);
  });
});
