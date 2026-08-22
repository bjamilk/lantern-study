/**
 * A seller must not be able to reverse a moderation takedown — or hop any other
 * transition the shared lifecycle table forbids — through either listing-update
 * path. The DB trigger in
 * supabase/migrations/20260822120000_marketplace_listings_moderation_lock.sql
 * is the backstop for direct PostgREST writes; these tests cover the API layer
 * and pin the migration's shape.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SupabaseService } from './supabase';

jest.mock('./marketplaceFavoriteAlerts', () => ({
  notifyListingBackAvailable: jest.fn(async () => undefined),
  notifyFavoritePriceDrop: jest.fn(async () => undefined),
}));

function makeDb(row: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const ins: Array<{ column: string; values: unknown[] }> = [];
  const from = (_table: string) => {
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.order = self;
    api.in = (column: string, values: unknown[]) => {
      ins.push({ column, values });
      return api;
    };
    api.update = (payload: Record<string, unknown>) => {
      updates.push(payload);
      return api;
    };
    api.single = async () => ({
      data: { ...row, ...(updates[updates.length - 1] ?? {}) },
      error: null,
    });
    api.then = (resolve: (v: unknown) => void) => resolve({ data: [row], error: null });
    return api;
  };
  return { from, updates, ins };
}

function service(db: ReturnType<typeof makeDb>, row: Record<string, unknown>) {
  return {
    supabase: db,
    getMarketplaceListingById: jest.fn(async () => row),
    maybeLogManualSoldBudget: jest.fn(async () => undefined),
    toListingCardRecords: (rows: unknown[]) => rows,
  };
}

const OWNER = 'seller-1';
const listing = (status: string) => ({
  id: 'listing-1',
  user_id: OWNER,
  status,
  title: 'Anatomy notes',
});

const setStatus = (self: unknown, status: string, userId = OWNER) =>
  SupabaseService.prototype.updateListingStatus.call(self as any, 'listing-1', status, userId);

const edit = (self: unknown, updates: Record<string, unknown>, options?: { actorIsAdmin?: boolean }) =>
  SupabaseService.prototype.updateMarketplaceListing.call(self as any, 'listing-1', updates, options);

describe('updateListingStatus (seller status endpoint)', () => {
  it('refuses to relist a listing moderation removed', async () => {
    const row = listing('removed_by_admin');
    const db = makeDb(row);
    await expect(setStatus(service(db, row), 'active')).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/removed by Lantern moderation/),
    });
    expect(db.updates).toHaveLength(0);
  });

  it('refuses to change a suspended listing', async () => {
    const row = listing('suspended_by_admin');
    const db = makeDb(row);
    await expect(setStatus(service(db, row), 'inactive')).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/suspended by Lantern moderation/),
    });
    expect(db.updates).toHaveLength(0);
  });

  it('refuses to flip a listing held by an open order', async () => {
    const row = listing('reserved');
    const db = makeDb(row);
    await expect(setStatus(service(db, row), 'active')).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/sale is in progress/i),
    });
    expect(db.updates).toHaveLength(0);
  });

  it('still lets the owner relist an inactive listing and mark an active one sold', async () => {
    const inactive = listing('inactive');
    const db1 = makeDb(inactive);
    await expect(setStatus(service(db1, inactive), 'active')).resolves.toMatchObject({ status: 'active' });
    expect(db1.updates).toEqual([{ status: 'active' }]);

    const active = listing('active');
    const db2 = makeDb(active);
    const self2 = service(db2, active);
    await expect(setStatus(self2, 'sold')).resolves.toMatchObject({ status: 'sold' });
    expect(db2.updates).toEqual([{ status: 'sold' }]);
    expect(self2.maybeLogManualSoldBudget).toHaveBeenCalledWith('listing-1', OWNER);
  });

  it('still refuses non-owners before looking at transitions', async () => {
    const row = listing('inactive');
    const db = makeDb(row);
    await expect(setStatus(service(db, row), 'active', 'someone-else')).rejects.toThrow(/Unauthorized/);
    expect(db.updates).toHaveLength(0);
  });
});

describe('updateMarketplaceListing (generic seller edit)', () => {
  it('refuses content edits on a listing moderation removed', async () => {
    const row = listing('removed_by_admin');
    const db = makeDb(row);
    await expect(edit(service(db, row), { title: 'New title' })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/can no longer be edited/),
    });
    expect(db.updates).toHaveLength(0);
  });

  it('refuses a status hop out of moderation even when smuggled into an edit', async () => {
    const row = listing('suspended_by_admin');
    const db = makeDb(row);
    await expect(edit(service(db, row), { status: 'active' })).rejects.toMatchObject({ statusCode: 403 });
    expect(db.updates).toHaveLength(0);
  });

  it('refuses a seller archiving via edit (that is the delete path\'s job)', async () => {
    const row = listing('active');
    const db = makeDb(row);
    await expect(edit(service(db, row), { status: 'archived' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'An active listing cannot be changed to archived.',
    });
    expect(db.updates).toHaveLength(0);
  });

  it('rejects an unknown status with 400', async () => {
    const row = listing('active');
    const db = makeDb(row);
    await expect(edit(service(db, row), { status: 'draft' })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.updates).toHaveLength(0);
  });

  it('lets the owner make an allowed transition and ordinary edits', async () => {
    const row = listing('active');
    const db = makeDb(row);
    const self = service(db, row);
    await expect(edit(self, { title: 'Better title', status: 'sold' })).resolves.toMatchObject({ status: 'sold' });
    expect(db.updates).toEqual([{ title: 'Better title', status: 'sold' }]);
    expect(self.maybeLogManualSoldBudget).toHaveBeenCalledWith('listing-1', OWNER);
  });

  it('keeps full control for admin callers (restore after removal)', async () => {
    const row = listing('removed_by_admin');
    const db = makeDb(row);
    await expect(edit(service(db, row), { status: 'active' }, { actorIsAdmin: true })).resolves.toMatchObject({
      status: 'active',
    });
    expect(db.updates).toEqual([{ status: 'active' }]);
  });
});

describe('getListingsBySeller', () => {
  it('shows moderation takedowns on the Inactive shelf instead of hiding them', async () => {
    const row = listing('removed_by_admin');
    const db = makeDb(row);
    await SupabaseService.prototype.getListingsBySeller.call(service(db, row) as any, OWNER, 'inactive');
    expect(db.ins).toEqual([
      { column: 'status', values: ['inactive', 'suspended_by_admin', 'removed_by_admin'] },
    ]);
  });
});

describe('moderation-lock migration', () => {
  it('installs a BEFORE UPDATE trigger that fences both moderated statuses for non-service roles', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../supabase/migrations/20260822120000_marketplace_listings_moderation_lock.sql'),
      'utf8',
    );
    expect(sql).toMatch(/BEFORE UPDATE ON public\.marketplace_listings/);
    expect(sql).toMatch(/BEFORE DELETE ON public\.marketplace_listings/);
    expect(sql).toMatch(/OLD\.status IN \('suspended_by_admin', 'removed_by_admin'\)/);
    expect(sql).toMatch(/NEW\.status IN \('suspended_by_admin', 'removed_by_admin'\)/);
    // Role detection must not rely on current_setting('role') (it is 'none' in a
    // plain session): service-role helper + session_user for direct sessions.
    expect(sql).toMatch(/public\.is_service_role_caller\(\)/);
    expect(sql).toMatch(/session_user IN \('postgres', 'supabase_admin'\)/);
    expect(sql).not.toMatch(/COALESCE\(auth\.role\(\), current_setting\('role', true\)\)/);
    // Moderated rows are read-only for non-exempt writers except counters.
    expect(sql).toMatch(/to_jsonb\(NEW\) - 'views_count'/);
  });

  it('makes marketplace_release_escrow leave moderated/archived listings alone', () => {
    const sql = readFileSync(
      join(__dirname, '../../../../supabase/migrations/20260822121000_marketplace_release_escrow_moderation_safe.sql'),
      'utf8',
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.marketplace_release_escrow/);
    const guarded = sql.match(/AND status IN \('active', 'reserved'\)/g) ?? [];
    expect(guarded).toHaveLength(2);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.marketplace_release_escrow\(uuid, uuid, boolean\) TO service_role/);
  });
});
