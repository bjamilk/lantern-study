/**
 * Cancelling/refunding an order must return held stock but must never relist a
 * listing that moderation took down (or that the seller paused/sold/archived
 * meanwhile) — the restore path runs as the service role, so the DB trigger
 * does not fence it and the service has to.
 */
import { MarketplaceOrdersService } from './marketplaceOrders';
// The service takes `MarketplaceServiceHost` since M3 Phase B. The stand-ins
// below stay FLAT and are regrouped by the production adapter
// (`marketplaceHostFromFlat`), so every assertion still names the same
// `jest.fn()` and the adapter itself is exercised by these suites.
import { marketplaceHostFromFlat } from './marketplaceServiceHost';

jest.mock('../utils/marketplaceCache', () => ({
  invalidateListingCaches: jest.fn(async () => undefined),
}));

function makeDb() {
  const updates: Array<{ payload: Record<string, unknown>; eqs: Array<[string, unknown]> }> = [];
  const from = (_table: string) => {
    const api: any = {};
    let current: { payload: Record<string, unknown>; eqs: Array<[string, unknown]> } | null = null;
    api.update = (payload: Record<string, unknown>) => {
      current = { payload, eqs: [] };
      updates.push(current);
      return api;
    };
    api.eq = (col: string, val: unknown) => {
      current?.eqs.push([col, val]);
      return api;
    };
    api.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return api;
  };
  return { from, updates };
}

function serviceFor(listing: Record<string, unknown>) {
  const db = makeDb();
  const self: any = Object.create(MarketplaceOrdersService.prototype);
  self.host = marketplaceHostFromFlat({
    getMarketplaceListingById: jest.fn(async () => listing),
    getClient: () => db,
  } as never);
  return { self, db };
}

const restore = (self: any, qty = 1) =>
  (MarketplaceOrdersService.prototype as any).restoreListingAfterCancelledOrder.call(self, 'listing-1', qty);

describe('restoreListingAfterCancelledOrder', () => {
  it('returns stock to a moderated multi-qty listing WITHOUT reactivating it', async () => {
    const { self, db } = serviceFor({ id: 'listing-1', quantity: 2, status: 'removed_by_admin' });
    await restore(self, 1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload).toMatchObject({ quantity: 3 });
    expect(db.updates[0].payload).not.toHaveProperty('status');
  });

  it('keeps a seller-paused multi-qty listing inactive (stock still restored)', async () => {
    const { self, db } = serviceFor({ id: 'listing-1', quantity: 0, status: 'inactive' });
    await restore(self, 2);
    expect(db.updates[0].payload).toMatchObject({ quantity: 2 });
    expect(db.updates[0].payload).not.toHaveProperty('status');
  });

  it('re-opens availability from the order-held states', async () => {
    for (const status of ['active', 'reserved']) {
      const { self, db } = serviceFor({ id: 'listing-1', quantity: 0, status });
      await restore(self, 1);
      expect(db.updates[0].payload).toMatchObject({ quantity: 1, status: 'active' });
    }
  });

  it('only un-reserves a unique listing that is actually reserved', async () => {
    const { self, db } = serviceFor({ id: 'listing-1', quantity: null, status: 'removed_by_admin' });
    await restore(self, 1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload).toMatchObject({ status: 'active' });
    expect(db.updates[0].eqs).toEqual(expect.arrayContaining([['status', 'reserved']]));
  });
});
