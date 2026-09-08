import { AI_USAGE_UNKNOWN, DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared/utils/aiUsage';
import {
  __resetAIUsageForTests,
  getLatestAIUsage,
  publishAIUsage,
  subscribeToAIUsage,
} from './aiUsageStore';

/**
 * The badge's counters start at "we have not been told", not at a default.
 *
 * The store is read synchronously by every AI surface the moment it mounts, so
 * whatever it holds before the first server answer is what a student sees on a
 * cold start. It used to hold DEFAULT_AI_DAILY_LIMIT — the API's default, not
 * this account's allowance — and printed a confident "20 / 20" for an account
 * the server gives 100.
 */
describe('the AI usage store before the server has answered', () => {
  // Deliberately no reset first: this asserts the module's OWN initial value.
  it('holds the honest unknown, never the shared default', () => {
    const initial = getLatestAIUsage();
    expect(initial).toEqual(AI_USAGE_UNKNOWN);
    expect(initial.limit).toBe(0);
    expect(initial.limit).not.toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(initial.remaining).not.toBe(DEFAULT_AI_DAILY_LIMIT);
  });

  it('publishes real figures over it and tells every watcher', () => {
    const seen: number[] = [];
    const stop = subscribeToAIUsage((usage) => seen.push(usage.limit));
    publishAIUsage({ used: 17, limit: 100, remaining: 83, resetsAt: '2026-09-08T00:00:00Z' });
    expect(getLatestAIUsage()).toEqual({
      used: 17,
      limit: 100,
      remaining: 83,
      resetsAt: '2026-09-08T00:00:00Z',
    });
    expect(seen).toEqual([100]);
    stop();
  });

  it('forgets back to the unknown, not to the default', () => {
    publishAIUsage({ used: 17, limit: 100, remaining: 83, resetsAt: '' });
    __resetAIUsageForTests();
    expect(getLatestAIUsage().limit).toBe(0);
    expect(getLatestAIUsage().limit).not.toBe(DEFAULT_AI_DAILY_LIMIT);
  });
});
