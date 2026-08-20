/**
 * Listing delete must not cascade-destroy orders. marketplace_orders.listing_id
 * is ON DELETE CASCADE, so a raw listing delete hard-deletes every order on it —
 * paid/completed ones included, with their receipts and payment evidence.
 * deleteMarketplaceListingSafely blocks while any order is open (409), archives
 * when only terminal orders remain, and hard-deletes only when there are none.
 */
import { SupabaseService } from './supabase';

function makeDb(orderStatuses: Array<{ status: string }>) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const deletes: Array<{ table: string }> = [];
  const from = (table: string) => {
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.update = (payload: Record<string, unknown>) => {
      updates.push({ table, payload });
      return api;
    };
    api.delete = () => {
      deletes.push({ table });
      return api;
    };
    api.then = (resolve: (v: unknown) => void) =>
      resolve({
        data: table === 'marketplace_orders' ? orderStatuses : null,
        error: null,
      });
    return api;
  };
  return { from, updates, deletes };
}

function service(db: ReturnType<typeof makeDb>) {
  return {
    supabase: db,
    deleteMarketplaceListing: jest.fn(async () => true),
  };
}

const call = (self: unknown) =>
  SupabaseService.prototype.deleteMarketplaceListingSafely.call(self as any, 'listing-1');

describe('deleteMarketplaceListingSafely', () => {
  it('refuses (409) when an order is still open', async () => {
    const db = makeDb([{ status: 'paid' }]);
    const self = service(db);

    await expect(call(self)).rejects.toMatchObject({ statusCode: 409 });

    expect(self.deleteMarketplaceListing).not.toHaveBeenCalled();
    expect(db.updates.filter((u) => u.table === 'marketplace_listings')).toHaveLength(0);
  });

  it('archives (keeps records) when only terminal orders exist', async () => {
    const db = makeDb([{ status: 'completed' }, { status: 'cancelled' }]);
    const self = service(db);

    await expect(call(self)).resolves.toMatchObject({ outcome: 'archived' });

    expect(self.deleteMarketplaceListing).not.toHaveBeenCalled();
    const listingUpdates = db.updates.filter((u) => u.table === 'marketplace_listings');
    expect(listingUpdates).toHaveLength(1);
    expect(listingUpdates[0].payload.status).toBe('archived');
  });

  it('hard-deletes when the listing has no orders', async () => {
    const db = makeDb([]);
    const self = service(db);

    await expect(call(self)).resolves.toMatchObject({ outcome: 'deleted' });

    expect(self.deleteMarketplaceListing).toHaveBeenCalledTimes(1);
    expect(db.updates.filter((u) => u.table === 'marketplace_listings')).toHaveLength(0);
  });
});
