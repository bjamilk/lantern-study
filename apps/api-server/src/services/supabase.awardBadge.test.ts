/**
 * awardBadge (admin manual grant) writes profiles.badges — the JSONB column the
 * automatic award path (checkAndAwardBadges) already uses. There is no
 * `user_badges` / `badges` table and never was; the old implementation wrote to
 * one and failed on every call. The gamification lockdown trigger
 * (supabase/migrations/20260704100100_gamification_lockdown.sql) only lets
 * service_role change that column, so the write has to go through the service
 * client. These tests pin that contract.
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as gamificationData from './data/gamification';
import { cacheService } from './cache';
import { checkAndAwardBadges, initialUserStats } from '@lantern/shared/utils/testHelpers';

jest.mock('./cache', () => ({
  cacheService: {
    invalidateUserCache: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type Update = { table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> };

function makeDb(profile: Record<string, unknown> | null) {
  const updates: Update[] = [];
  const tablesRead: string[] = [];
  const from = (table: string) => {
    tablesRead.push(table);
    const filters: Array<[string, unknown]> = [];
    const api: any = {};
    api.select = () => api;
    api.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return api;
    };
    api.update = (payload: Record<string, unknown>) => {
      updates.push({ table, payload, filters });
      return api;
    };
    api.maybeSingle = async () => ({ data: profile, error: null });
    // Awaiting the update builder directly.
    api.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return api;
  };
  return { from, updates, tablesRead };
}

// Only `supabase` is provided: if awardBadge reached for updateUser or any
// other service method, the call would throw, so a green run also proves the
// write went straight through the service-role client.
const service = (db: ReturnType<typeof makeDb>) => ({
  supabase: db,
  // The FACADE built this dep inline as an arrow into `activityFeed`, hosted by
  // itself; against this stand-in the feed wrote nothing (it has no client to
  // reach) and swallowed its own failure. Same nothing, said out loud.
  recordActivity: async () => undefined,
});

const award = (self: unknown, userId: string, badgeId: string, actorId?: string) =>
  gamificationData.awardBadge((self as any).supabase, self as any, userId, badgeId, actorId);

const existingBadge = {
  id: 'GROUP_FOUNDER',
  level: 2,
  name: 'Group Founder II',
  description: 'Create 3 study group(s).',
  icon: '🚀',
  dateAwarded: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('awardBadge', () => {
  it('rejects an unknown badge id with 400 before touching the database', async () => {
    const db = makeDb({ id: 'u1', badges: [] });
    await expect(award(service(db), 'u1', 'NOT_A_BADGE')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/Unknown badge id: NOT_A_BADGE/),
    });
    expect(db.tablesRead).toEqual([]);
    expect(db.updates).toHaveLength(0);
  });

  it('rejects a non-string badge id the same way', async () => {
    const db = makeDb({ id: 'u1', badges: [] });
    await expect(award(service(db), 'u1', 42 as unknown as string)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.updates).toHaveLength(0);
  });

  it('returns 404 when the user does not exist', async () => {
    const db = makeDb(null);
    await expect(award(service(db), 'ghost', 'TEST_TAKER')).rejects.toMatchObject({
      statusCode: 404,
      message: 'User not found',
    });
    expect(db.updates).toHaveLength(0);
  });

  it('appends a level-1 badge in the shape the automatic award path writes', async () => {
    const db = makeDb({ id: 'u1', badges: [] });
    const result = await award(service(db), 'u1', 'TEST_TAKER', 'admin-1');

    expect(result.awarded).toBe(true);
    expect(result.badge).toEqual({
      id: 'TEST_TAKER',
      level: 1,
      name: 'Test Taker I',
      description: 'Complete 5 test(s).',
      icon: '📝',
      dateAwarded: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(result.badge!.dateAwarded))).toBe(false);
    expect(result.badges).toEqual([result.badge]);

    // Field-for-field parity with what checkAndAwardBadges produces for the
    // same badge, so dashboards and the level-up logic cannot tell them apart.
    const auto = checkAndAwardBadges({
      id: 'u1',
      name: 'u1',
      points: 0,
      badges: [],
      stats: { ...initialUserStats, testsCompleted: 5 },
    } as any).awardedBadges.find((b) => b.id === 'TEST_TAKER')!;
    expect(Object.keys(result.badge!).sort()).toEqual(Object.keys(auto).sort());
    const { dateAwarded: _a, ...manual } = result.badge!;
    const { dateAwarded: _b, ...automatic } = auto;
    expect(manual).toEqual(automatic);
  });

  it('writes profiles.badges through the service-role client, scoped to the user', async () => {
    const db = makeDb({ id: 'u1', badges: [existingBadge] });
    const result = await award(service(db), 'u1', 'OFFER_MAKER');

    expect(db.updates).toHaveLength(1);
    const [update] = db.updates;
    expect(update.table).toBe('profiles');
    expect(update.filters).toEqual([['id', 'u1']]);
    expect(Object.keys(update.payload)).toEqual(['badges']);
    // Existing badges are preserved verbatim; the new one is appended.
    expect(update.payload.badges).toEqual([existingBadge, result.badge]);
    expect((update.payload.badges as unknown[])[1]).toMatchObject({ id: 'OFFER_MAKER', level: 1 });

    expect(cacheService.invalidateUserCache).toHaveBeenCalledWith('u1');
  });

  it('is idempotent: a badge already held (at any level) is left alone', async () => {
    const db = makeDb({ id: 'u1', badges: [existingBadge] });
    const result = await award(service(db), 'u1', 'GROUP_FOUNDER');

    expect(result).toEqual({ awarded: false, badge: existingBadge, badges: [existingBadge] });
    expect(db.updates).toHaveLength(0);
    expect(cacheService.invalidateUserCache).not.toHaveBeenCalled();
  });

  it('treats a malformed badges column as empty rather than crashing', async () => {
    const db = makeDb({ id: 'u1', badges: 'not-an-array' });
    const result = await award(service(db), 'u1', 'DUELIST');
    expect(result.awarded).toBe(true);
    expect(db.updates[0].payload.badges).toEqual([result.badge]);
  });
});
