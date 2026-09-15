/**
 * getNotificationById: the ownership check must survive a cache HIT
 * (hotfix H3, finding 6).
 *
 * The check used to sit INSIDE the `cached` loader, which runs only on a
 * MISS. So the first reader populated `notification:${id}` with the row and,
 * for the next 5 minutes, ANY other user asking for that id got a hit that
 * skipped the check and received a stranger's notification.
 *
 * The cache here is a real store, not the pass-through double the other
 * supabase tests use — a pass-through cache cannot reproduce this bug, which
 * is exactly why it went unnoticed.
 */
const store = new Map<string, unknown>();
jest.mock('./cache', () => ({
  cacheService: {
    cached: async (key: string, fn: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const value = await fn();
      store.set(key, value);
      return value;
    },
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SupabaseService } from './supabase';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ATTACKER = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION = '33333333-3333-4333-8333-333333333333';

function makeSelf() {
  let reads = 0;
  const row = {
    id: NOTIFICATION,
    user_id: OWNER,
    message: 'Your payout cleared',
    link: '/wallet',
  };
  const supabase = {
    from() {
      const chain: any = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.single = () => {
        reads += 1;
        return Promise.resolve({ data: row, error: null });
      };
      return chain;
    },
  };
  const proto = SupabaseService.prototype as any;
  const self: any = { supabase };
  return {
    get: (userId?: string) => proto.getNotificationById.call(self, NOTIFICATION, userId),
    reads: () => reads,
  };
}

beforeEach(() => store.clear());

describe('getNotificationById ownership', () => {
  it('returns the row to its owner', async () => {
    const { get } = makeSelf();
    await expect(get(OWNER)).resolves.toMatchObject({ id: NOTIFICATION, user_id: OWNER });
  });

  it('refuses a stranger on a cache HIT warmed by the owner', async () => {
    const { get, reads } = makeSelf();

    // Owner reads first: this is what populates the cache.
    await expect(get(OWNER)).resolves.toMatchObject({ user_id: OWNER });
    expect(reads()).toBe(1);

    // Attacker asks for the same id. The database is NOT hit (the row is
    // cached) — the check has to hold anyway.
    await expect(get(ATTACKER)).resolves.toBeNull();
    expect(reads()).toBe(1);
  });

  it('refuses a stranger on a cache MISS too', async () => {
    const { get } = makeSelf();
    await expect(get(ATTACKER)).resolves.toBeNull();
  });

  it('still serves the owner after a stranger was refused from the same entry', async () => {
    const { get } = makeSelf();
    await expect(get(ATTACKER)).resolves.toBeNull();
    // The refusal must not have poisoned the entry with `null`.
    await expect(get(OWNER)).resolves.toMatchObject({ user_id: OWNER });
  });
});
