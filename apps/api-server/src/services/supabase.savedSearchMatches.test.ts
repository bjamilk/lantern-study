/**
 * Saved-search badge poll must not consume the alert watermark.
 *
 * The background alerts job uses last_checked_at as its "since" cursor. The
 * matches endpoint used to bump last_checked_at on every call, so merely opening
 * Explore (which polls for a badge count) advanced the watermark past all new
 * listings and the job never notified. A peek returns the same count without
 * touching last_checked_at; a non-peek call still marks-as-seen.
 */
import { SupabaseService } from './supabase';

function makeDb(search: Record<string, unknown>, listings: unknown[]) {
  const savedSearchUpdates: Array<{ payload: Record<string, unknown> }> = [];
  const gtCalls: Array<{ col: string; val: unknown }> = [];
  const from = (table: string) => {
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.gt = (col: string, val: unknown) => {
      gtCalls.push({ col, val });
      return api;
    };
    api.gte = self;
    api.lte = self;
    api.ilike = self;
    api.or = self;
    api.order = self;
    api.limit = self;
    api.update = (payload: Record<string, unknown>) => {
      if (table === 'saved_searches') savedSearchUpdates.push({ payload });
      return api;
    };
    api.single = async () => ({ data: search, error: null });
    api.then = (resolve: (v: unknown) => void) => resolve({ data: listings, error: null });
    return api;
  };
  return { supabase: { from }, savedSearchUpdates, gtCalls };
}

const call = (self: unknown, opts: { peek?: boolean }) =>
  SupabaseService.prototype.getSavedSearchMatches.call(self as any, 'user-1', 'ss-1', opts);

const SEARCH = {
  id: 'ss-1',
  user_id: 'user-1',
  filters: {},
  last_checked_at: '2026-08-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
};

describe('getSavedSearchMatches watermark', () => {
  it('peek=true returns the count WITHOUT advancing last_checked_at', async () => {
    const db = makeDb(SEARCH, [{ id: 'a' }, { id: 'b' }]);
    const result = await call(db, { peek: true });
    expect(result).toEqual({ count: 2, listings: [{ id: 'a' }, { id: 'b' }] });
    expect(db.savedSearchUpdates).toHaveLength(0);
  });

  it('a non-peek call advances last_checked_at (mark as seen)', async () => {
    const db = makeDb(SEARCH, [{ id: 'a' }]);
    await call(db, {});
    expect(db.savedSearchUpdates).toHaveLength(1);
    expect(typeof db.savedSearchUpdates[0].payload.last_checked_at).toBe('string');
  });

  it('falls back to created_at when last_checked_at is null', async () => {
    const db = makeDb({ ...SEARCH, last_checked_at: null }, []);
    await call(db, { peek: true });
    expect(db.gtCalls[0]).toEqual({ col: 'created_at', val: SEARCH.created_at });
  });
});
