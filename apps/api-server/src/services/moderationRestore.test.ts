/**
 * Lifting a takedown must not re-list a unique item that was reserved by an open
 * order (double-sell) or already sold. (Review finding E.)
 */
import { ModerationService } from './moderation';

function makeDb(state: { openOrders?: any[]; completedOrders?: any[]; listing?: any }) {
  const from = (table: string) => {
    const api: any = { _status: undefined as string | undefined };
    api.select = () => api;
    api.eq = (col: string, val: unknown) => { if (col === 'status') api._status = String(val); return api; };
    api.in = () => { api._inStatus = true; return api; };
    api.limit = async () => {
      if (table === 'marketplace_orders') {
        if (api._inStatus) return { data: state.openOrders ?? [], error: null };
        if (api._status === 'completed') return { data: state.completedOrders ?? [], error: null };
      }
      return { data: [], error: null };
    };
    api.maybeSingle = async () => ({ data: table === 'marketplace_listings' ? state.listing ?? null : null, error: null });
    return api;
  };
  return { from };
}

function service(state: Parameters<typeof makeDb>[0]) {
  const self: any = Object.create(ModerationService.prototype);
  self.supabaseService = { getClient: () => makeDb(state) };
  Object.defineProperty(self, 'db', { get() { return this.supabaseService.getClient(); } });
  return self;
}

const resolve = (self: any) => (ModerationService.prototype as any).resolveRestoredListingStatus.call(self, 'listing-1');

describe('resolveRestoredListingStatus', () => {
  it("returns 'reserved' when an open order exists", async () => {
    await expect(resolve(service({ openOrders: [{ id: 'o1' }] }))).resolves.toBe('reserved');
  });
  it("returns 'sold' for a depleted multi-qty listing", async () => {
    await expect(resolve(service({ openOrders: [], listing: { quantity: 0, listing_kind: 'single' } }))).resolves.toBe('sold');
  });
  it("returns 'sold' for a unique item with a completed order", async () => {
    await expect(resolve(service({ openOrders: [], completedOrders: [{ id: 'o2' }], listing: { quantity: null, listing_kind: 'single' } }))).resolves.toBe('sold');
  });
  it("returns 'active' for a fresh unique item", async () => {
    await expect(resolve(service({ openOrders: [], completedOrders: [], listing: { quantity: null, listing_kind: 'single' } }))).resolves.toBe('active');
  });
  it("keeps a digital listing 'active' (never sells out)", async () => {
    await expect(resolve(service({ openOrders: [], listing: { quantity: null, listing_kind: 'question_bank' } }))).resolves.toBe('active');
  });
});
