/**
 * Suspension enforcement (Phase 1 · E): settings.suspended_until in the
 * future blocks like a ban; in the past it is ignored. Redis is stubbed out
 * so every read hits the (stubbed) profile row.
 */
import { blockStateFromSettings, getUserBlockState, isUserBanned } from './adminAudit';

jest.mock('./redisStore', () => ({
  getRedisClient: jest.fn(async () => null),
  redisKey: (suffix: string) => suffix,
}));

const NOW = new Date('2026-08-22T12:00:00Z');
const FUTURE = '2026-09-05T12:00:00Z';
const PAST = '2026-08-01T12:00:00Z';

function supabaseWithSettings(settings: unknown) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: { settings }, error: null });
  return { getClient: () => ({ from: () => chain }) } as any;
}

describe('blockStateFromSettings', () => {
  it('treats a future suspended_until as suspended and a past one as clear', () => {
    expect(blockStateFromSettings({ suspended_until: FUTURE }, NOW)).toEqual({ banned: false, suspendedUntil: FUTURE });
    expect(blockStateFromSettings({ suspended_until: PAST }, NOW)).toEqual({ banned: false, suspendedUntil: null });
    expect(blockStateFromSettings({ suspended_until: 'garbage' }, NOW)).toEqual({ banned: false, suspendedUntil: null });
    expect(blockStateFromSettings(null, NOW)).toEqual({ banned: false, suspendedUntil: null });
  });

  it('keeps the ban flags independent of suspension', () => {
    expect(blockStateFromSettings({ is_banned: true }, NOW)).toEqual({ banned: true, suspendedUntil: null });
    expect(blockStateFromSettings({ account_status: 'banned', suspended_until: FUTURE }, NOW)).toEqual({
      banned: true,
      suspendedUntil: FUTURE,
    });
  });
});

describe('getUserBlockState / isUserBanned', () => {
  it('blocks a user whose suspended_until is in the future', async () => {
    const far = new Date(Date.now() + 86_400_000).toISOString();
    const svc = supabaseWithSettings({ suspended_until: far });
    await expect(getUserBlockState(svc, 'u1')).resolves.toEqual({ banned: false, suspendedUntil: far });
    await expect(isUserBanned(svc, 'u1')).resolves.toBe(true);
  });

  it('does not block a user whose suspension has lapsed', async () => {
    const svc = supabaseWithSettings({ suspended_until: PAST });
    await expect(getUserBlockState(svc, 'u1')).resolves.toEqual({ banned: false, suspendedUntil: null });
    await expect(isUserBanned(svc, 'u1')).resolves.toBe(false);
  });

  it('still reports bans', async () => {
    await expect(isUserBanned(supabaseWithSettings({ is_banned: true }), 'u1')).resolves.toBe(true);
    await expect(isUserBanned(supabaseWithSettings({}), 'u1')).resolves.toBe(false);
  });
});
