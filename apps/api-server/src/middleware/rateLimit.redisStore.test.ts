/**
 * buildAllLimiters() runs at module import, which happens BEFORE server.ts awaits
 * initializeRateLimitStores(). Every limiter therefore captured an in-memory store
 * in production while the "Redis is required for rate limiting" guard happily
 * passed — per-instance counters, silently. Limiters must be rebuilt afterwards.
 */
const sendCommand = jest.fn(async () => 'sha1placeholder');

jest.mock('../services/redisStore', () => ({
  getRedisClient: jest.fn(async () => ({ sendCommand })),
  redisKey: (k: string) => k,
}));

import { initializeRateLimitStores, getLimiterStoreKind } from './rateLimit';

const PREFIXES = ['anon', 'authlogin', 'authloginip', 'authloginemail', 'authsess'];

describe('rate limiter stores', () => {
  it('limiters built at import time fall back to memory', () => {
    for (const p of PREFIXES) expect(getLimiterStoreKind(p)).toBe('memory');
  });

  it('every limiter carries the Redis store once initializeRateLimitStores has run', async () => {
    await initializeRateLimitStores();
    for (const p of PREFIXES) expect(getLimiterStoreKind(p)).toBe('redis');
  });
});
