/**
 * Payment state may only be asserted by evidence. These pin the three holes
 * from the payments audit: orders born 'paid', the buyer marking their own
 * order paid, and "Request payment" flipping status as a side effect.
 */

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: jest.fn(),
}));

import { MarketplaceOrdersService } from './marketplaceOrders';

type Row = Record<string, unknown>;

/**
 * Table-aware chainable mock: read results are keyed per table, and every
 * update payload is recorded so tests can assert what was (not) written.
 */
function makeDb(tables: Record<string, Row | null>) {
  const updates: Array<{ table: string; payload: Row }> = [];
  const from = (table: string) => {
    const api: Record<string, any> = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.is = self;
    api.order = self;
    api.limit = self;
    api.update = (payload: Row) => {
      updates.push({ table, payload });
      return api;
    };
    api.insert = self;
    api.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
    api.single = async () => ({ data: tables[table] ?? null, error: null });
    // update chains that never await single() still need to be awaitable
    api.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? null, error: null });
    return api;
  };
  return { from, updates };
}

function service(db: ReturnType<typeof makeDb>) {
  const svc = new MarketplaceOrdersService({ getClient: () => db } as any);
  // Notifications hit other tables; they are not what these tests assert.
  (svc as any).notifyOrderParty = jest.fn();
  return svc;
}

const BASE_ORDER: Row = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  listing_id: 'lst_1',
  status: 'pending_payment',
  amount: 5000,
  quantity: 1,
  payment_id: null,
  transaction_id: null,
  listing: { title: 'Anatomy flashcards' },
};

describe('honest payment states', () => {
  it('new orders are always pending_payment — never born paid', async () => {
    const db = makeDb({});
    const svc = service(db);
    const status = await (svc as any).resolveInitialOrderStatus('seller_1');
    expect(status).toBe('pending_payment');
  });

  it('the buyer cannot mark their own order paid', async () => {
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const svc = service(db);

    await expect(
      svc.updateOrderStatus('ord_1', 'buyer_1', 'mark_paid')
    ).rejects.toThrow(/only the seller/i);

    expect(db.updates.filter((u) => u.table === 'marketplace_orders')).toHaveLength(0);
  });

  it('the seller can confirm payment received, and paid_at is stamped', async () => {
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const svc = service(db);

    await svc.updateOrderStatus('ord_1', 'seller_1', 'mark_paid');

    const orderUpdates = db.updates.filter((u) => u.table === 'marketplace_orders');
    expect(orderUpdates.some((u) => u.payload.status === 'paid')).toBe(true);
    expect(orderUpdates.some((u) => typeof u.payload.paid_at === 'string')).toBe(true);
  });

  it("'Request payment' notifies the buyer without touching order status", async () => {
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const svc = service(db);

    const result = await svc.createPaymentLinkOrder('ord_1', 'seller_1');

    expect(result.orderId).toBe('ord_1');
    // The old behaviour: requesting money silently set status='paid'.
    expect(db.updates.filter((u) => u.table === 'marketplace_orders')).toHaveLength(0);
    expect((svc as any).notifyOrderParty).toHaveBeenCalledWith(
      'buyer_1',
      expect.objectContaining({ data: expect.objectContaining({ paymentRequest: true }) })
    );
  });

  it('a missing paid_at column never breaks the payment flow (returned-error shape)', async () => {
    // supabase-js RETURNS errors rather than throwing them, so this is the
    // shape production actually produces while migration 20260820120000 is
    // pending. The stamp must degrade to a logged warning, not a failure.
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const failingFrom = db.from;
    (db as any).from = (table: string) => {
      const api = failingFrom(table);
      const origUpdate = api.update;
      api.update = (payload: Record<string, unknown>) => {
        const chained = origUpdate(payload);
        if ('paid_at' in payload && !('status' in payload)) {
          chained.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: null,
              error: { code: 'PGRST204', message: "Could not find the 'paid_at' column" },
            });
        }
        return chained;
      };
      return api;
    };
    const svc = service(db);

    await expect(svc.updateOrderStatus('ord_1', 'seller_1', 'mark_paid')).resolves.toBeTruthy();
    expect(db.updates.some((u) => u.payload.status === 'paid')).toBe(true);
  });

  it('a paid_at update that throws outright never breaks the payment flow either', async () => {
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const failingFrom = db.from;
    (db as any).from = (table: string) => {
      const api = failingFrom(table);
      const origUpdate = api.update;
      api.update = (payload: Record<string, unknown>) => {
        if ('paid_at' in payload && !('status' in payload)) {
          throw Object.assign(new Error('column "paid_at" does not exist'), { code: '42703' });
        }
        return origUpdate(payload);
      };
      return api;
    };
    const svc = service(db);

    await expect(svc.updateOrderStatus('ord_1', 'seller_1', 'mark_paid')).resolves.toBeTruthy();
    expect(db.updates.some((u) => u.payload.status === 'paid')).toBe(true);
  });

  it('paid_at is stamped only after the status transition commits', async () => {
    const db = makeDb({ marketplace_orders: { ...BASE_ORDER } });
    const svc = service(db);

    await svc.updateOrderStatus('ord_1', 'seller_1', 'mark_paid');

    const orderUpdates = db.updates.filter((u) => u.table === 'marketplace_orders');
    const statusIdx = orderUpdates.findIndex((u) => u.payload.status === 'paid');
    const paidAtIdx = orderUpdates.findIndex(
      (u) => 'paid_at' in u.payload && !('status' in u.payload)
    );
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(paidAtIdx).toBeGreaterThan(statusIdx);
  });
});
