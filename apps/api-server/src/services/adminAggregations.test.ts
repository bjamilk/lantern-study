/**
 * The admin dashboard's "daily tokens" and "which features spend most" views
 * are these reducers. The rule that matters: cache replays are counted as
 * activity but never as spend.
 */
import { aggregateAiTokenRows, aggregateProductEventRows } from './adminAggregations';

describe('aggregateAiTokenRows', () => {
  it('sums paid tokens per feature/day/provider and counts cache replays separately', () => {
    const agg = aggregateAiTokenRows([
      { feature: 'daily_quiz', provider: 'groq', token_estimate: 1000, created_at: '2026-08-19T10:00:00Z' },
      { feature: 'daily_quiz', provider: 'fireworks', token_estimate: 800, created_at: '2026-08-19T11:00:00Z' },
      // Cache replay: token_estimate is NULL — nothing was spent.
      { feature: 'daily_quiz', provider: 'cache', token_estimate: null, created_at: '2026-08-19T12:00:00Z' },
      { feature: 'explain', provider: 'groq', token_estimate: 300, created_at: '2026-08-18T09:00:00Z' },
    ]);

    expect(agg.totalTokens).toBe(2100);
    expect(agg.paidCalls).toBe(3);
    expect(agg.cacheServed).toBe(1);
    expect(agg.byFeature.daily_quiz).toEqual({ tokens: 1800, calls: 3, cacheServed: 1 });
    expect(agg.byFeature.explain).toEqual({ tokens: 300, calls: 1, cacheServed: 0 });
    expect(agg.byDay['2026-08-19']).toEqual({ tokens: 1800, calls: 3 });
    expect(agg.byDay['2026-08-18']).toEqual({ tokens: 300, calls: 1 });
    expect(agg.byProvider.groq).toEqual({ tokens: 1300, calls: 2 });
    expect(agg.byProvider.fireworks).toEqual({ tokens: 800, calls: 1 });
    // 'cache' must never appear as a provider that spent tokens.
    expect(agg.byProvider.cache).toBeUndefined();
  });

  it('treats rows without usage (pre-tracking history) as zero-token paid calls', () => {
    const agg = aggregateAiTokenRows([
      { feature: 'ask_tutor', provider: 'groq', token_estimate: null, created_at: '2026-07-01T00:00:00Z' },
    ]);

    expect(agg.totalTokens).toBe(0);
    expect(agg.paidCalls).toBe(1);
    expect(agg.byFeature.ask_tutor.calls).toBe(1);
  });
});

describe('aggregateProductEventRows', () => {
  it('splits by surface, buckets by day, and counts distinct users', () => {
    const agg = aggregateProductEventRows([
      { event: 'page_view', surface: 'web', user_id: 'u1', created_at: '2026-08-19T10:00:00Z' },
      { event: 'page_view', surface: 'mobile', user_id: 'u2', created_at: '2026-08-19T11:00:00Z' },
      { event: 'test_completed', surface: 'web', user_id: 'u1', created_at: '2026-08-18T10:00:00Z' },
      // Anonymous events count as activity but not as a user.
      { event: 'page_view', surface: 'web', user_id: null, created_at: '2026-08-18T12:00:00Z' },
    ]);

    expect(agg.totalEvents).toBe(4);
    expect(agg.uniqueUsers).toBe(2);
    expect(agg.byEvent.page_view).toEqual({ total: 3, web: 2, mobile: 1 });
    expect(agg.byEvent.test_completed).toEqual({ total: 1, web: 1, mobile: 0 });
    expect(agg.byDay['2026-08-19']).toBe(2);
    expect(agg.byDay['2026-08-18']).toBe(2);
  });
});
