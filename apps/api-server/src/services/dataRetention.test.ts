import { purgeExpiredProductEvents } from './dataRetention';
import type { SupabaseService } from './supabase';

describe('purgeExpiredProductEvents', () => {
  it('deletes product_events older than retention cutoff and returns count', async () => {
    const deletedIds = [{ id: 'a' }, { id: 'b' }];
    let deletedTable: string | null = null;
    let ltColumn: string | null = null;
    let ltValue: string | null = null;

    const chain = {
      delete: () => chain,
      lt: (column: string, value: string) => {
        ltColumn = column;
        ltValue = value;
        return chain;
      },
      select: async () => ({ data: deletedIds, error: null }),
    };

    const supabaseService = {
      getClient: () => ({
        from: (table: string) => {
          deletedTable = table;
          return chain;
        },
      }),
    } as unknown as SupabaseService;

    const before = Date.now();
    const count = await purgeExpiredProductEvents(supabaseService);
    const after = Date.now();

    expect(count).toBe(2);
    expect(deletedTable).toBe('product_events');
    expect(ltColumn).toBe('created_at');
    expect(ltValue).toBeTruthy();
    const cutoffMs = new Date(ltValue!).getTime();
    // ~90 day retention (default AI_LOG_RETENTION_DAYS)
    const expectedMin = before - 91 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 89 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThan(expectedMin);
    expect(cutoffMs).toBeLessThan(expectedMax);
  });

  it('returns 0 when delete errors', async () => {
    const chain = {
      delete: () => chain,
      lt: () => chain,
      select: async () => ({ data: null, error: { message: 'boom' } }),
    };
    const supabaseService = {
      getClient: () => ({
        from: () => chain,
      }),
    } as unknown as SupabaseService;

    await expect(purgeExpiredProductEvents(supabaseService)).resolves.toBe(0);
  });
});
