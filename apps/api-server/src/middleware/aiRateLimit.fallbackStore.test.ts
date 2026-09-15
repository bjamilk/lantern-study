/**
 * F7a: the AI credit counters must never become an unlimited, silent allowance.
 *
 * When Redis is missing the counters fall back to a per-process Map. That is a
 * legitimate development mode and an illegitimate production one, so the module
 * now mirrors `initializeRateLimitStores()` exactly: throw in production, warn
 * loudly otherwise — and report the degraded store kind so an incident is
 * visible rather than showing up later as a provider bill.
 */
let redisClient: unknown = null;

jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => redisClient,
}));

const logged: Array<{ level: string; message: string }> = [];
jest.mock('../utils/logger', () => ({
  logger: {
    debug: (message: string) => logged.push({ level: 'debug', message }),
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string) => logged.push({ level: 'error', message }),
  },
}));

import {
  getAIUsage,
  getAiLimiterStoreKind,
  initializeAiRateLimitStore,
  resetAiLimiterStoreKindForTests,
} from './aiRateLimit';

describe('AI limiter store fallback', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    redisClient = null;
    logged.length = 0;
    resetAiLimiterStoreKindForTests();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('refuses to start in production without Redis, exactly as the HTTP limiters do', async () => {
    process.env.NODE_ENV = 'production';
    await expect(initializeAiRateLimitStore()).rejects.toThrow(
      /Redis is required for AI credit limiting in production/
    );
  });

  it('starts outside production but says so loudly', async () => {
    process.env.NODE_ENV = 'test';
    await initializeAiRateLimitStore();
    expect(getAiLimiterStoreKind()).toBe('memory');
    expect(logged.some((entry) => entry.level === 'warn' && /per-process fallback/.test(entry.message))).toBe(
      true
    );
  });

  it('reports the redis store when a client is available', async () => {
    process.env.NODE_ENV = 'production';
    redisClient = { isOpen: true };
    await initializeAiRateLimitStore();
    expect(getAiLimiterStoreKind()).toBe('redis');
  });

  it('a counter served from the Map flips the store kind and logs the degradation', async () => {
    process.env.NODE_ENV = 'test';
    await getAIUsage('user-fallback-1');
    expect(getAiLimiterStoreKind()).toBe('memory');
    const shouted = logged.filter(
      (entry) => entry.level === 'error' && /DEGRADED/.test(entry.message)
    );
    expect(shouted.length).toBe(1);

    // Throttled, not silent: a second counter in the same window does not
    // re-log, but it still reports the degraded store.
    await getAIUsage('user-fallback-2');
    expect(getAiLimiterStoreKind()).toBe('memory');
    expect(logged.filter((entry) => /DEGRADED/.test(entry.message)).length).toBe(1);
  });

  it('still enforces a limit on the fallback path (never unlimited)', async () => {
    process.env.NODE_ENV = 'test';
    const { chargeAiCredits } = await import('./aiRateLimit');
    const userId = `fallback-limit-${Date.now()}`;
    // Spend far past any plausible daily allowance; the Map must refuse.
    let refusedAt: number | null = null;
    for (let i = 0; i < 500; i += 1) {
      const denial = await chargeAiCredits(userId, 1);
      if (denial) {
        refusedAt = i;
        break;
      }
    }
    expect(refusedAt).not.toBeNull();
  });
});
