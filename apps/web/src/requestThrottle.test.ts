import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dedupe,
  isRateLimited,
  noteRateLimited,
  parseRetryAfterMs,
  rateLimitedUntil,
  resetRequestThrottle,
} from '../../../services/requestThrottle';

describe('requestThrottle (SW / Sentry WEB-1H, WEB-1S)', () => {
  beforeEach(() => {
    resetRequestThrottle();
    vi.useRealTimers();
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const run = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('rows'), 5))
    );

    const [a, b, c] = await Promise.all([
      dedupe('k', run),
      dedupe('k', run),
      dedupe('k', run),
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['rows', 'rows', 'rows']);
  });

  it('is not a cache — a call after the first settles hits the network again', async () => {
    const run = vi.fn().mockResolvedValue('rows');
    await dedupe('k', run);
    await dedupe('k', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('releases the slot when the shared request rejects', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(dedupe('k', run)).rejects.toThrow('boom');
    await expect(dedupe('k', run)).rejects.toThrow('boom');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('backs off for the Retry-After the server named', () => {
    noteRateLimited('k', '30');
    expect(isRateLimited('k')).toBe(true);
    const remaining = rateLimitedUntil('k');
    expect(remaining).toBeGreaterThan(28_000);
    expect(remaining).toBeLessThanOrEqual(30_000);
  });

  it('falls back to 60s when Retry-After is missing or unusable', () => {
    expect(parseRetryAfterMs(null)).toBe(60_000);
    expect(parseRetryAfterMs('soon')).toBe(60_000);
    expect(parseRetryAfterMs('0')).toBe(60_000);
  });

  it('accepts an HTTP-date Retry-After', () => {
    const ms = parseRetryAfterMs(new Date(Date.now() + 120_000).toUTCString());
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThanOrEqual(120_000);
  });

  it('never sits out longer than the limiter window', () => {
    expect(parseRetryAfterMs('99999')).toBe(15 * 60_000);
  });

  it('lets the caller through once the cooldown passes', () => {
    vi.useFakeTimers();
    noteRateLimited('k', '5');
    expect(isRateLimited('k')).toBe(true);
    vi.advanceTimersByTime(5_001);
    expect(isRateLimited('k')).toBe(false);
    vi.useRealTimers();
  });
});
