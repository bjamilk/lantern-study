/**
 * Listing delete must not cascade-destroy orders. marketplace_orders.listing_id
 * is ON DELETE CASCADE, so a raw listing delete hard-deletes every order on it —
 * paid/completed ones included, with their receipts and payment evidence.
 * deleteMarketplaceListingSafely blocks while any order is open (409), archives
 * when only terminal orders remain, and hard-deletes only when there are none.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
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

/**
 * Regression guard for the archive-500 defect: the archive branch above writes
 * status = 'archived', but marketplace_listings_status_check must actually permit
 * it. When the constraint was ('active','inactive','sold','reserved') the archive
 * UPDATE violated the check and the DELETE endpoint returned 500 for any listing
 * with a terminal order. A DB-mocked unit test can't see that, so assert the
 * effective constraint (the last one defined across all migrations) against the
 * statuses the service assigns.
 */
describe('marketplace_listings status constraint', () => {
  const migrationsDir = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

  function effectiveAllowedStatuses(): string[] {
    const sql = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
      .join('\n');

    // Find every `marketplace_listings_status_check ... CHECK (status IN (...))`
    // definition and keep the last (migrations are applied in filename order).
    const re =
      /marketplace_listings_status_check[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/gi;
    let match: RegExpExecArray | null;
    let last: string | null = null;
    while ((match = re.exec(sql)) !== null) last = match[1];
    if (last === null) throw new Error('marketplace_listings_status_check not found in migrations');

    return last
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
  }

  it('permits every status any code path writes to marketplace_listings.status', () => {
    const allowed = new Set(effectiveAllowedStatuses());
    // The FULL vocabulary persisted to marketplace_listings.status:
    //   active/inactive/sold   — seller endpoint (routes/marketplace.ts)
    //   reserved               — order lifecycle DB functions
    //   archived               — deleteMarketplaceListingSafely (supabase.ts)
    //   suspended_by_admin     — admin suspend (routes/admin.ts)
    //   removed_by_admin       — admin remove / report-resolve (routes/admin.ts)
    // Any status the app writes but the constraint omits would 500 the write in
    // prod (and could block the migration's ADD), so assert the constraint is a
    // superset of all of them.
    for (const status of [
      'active',
      'inactive',
      'sold',
      'reserved',
      'archived',
      'suspended_by_admin',
      'removed_by_admin',
    ]) {
      expect(allowed.has(status)).toBe(true);
    }
  });
});
