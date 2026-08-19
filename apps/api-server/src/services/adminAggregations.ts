/**
 * Pure reducers behind the admin dashboard's token and event views. Extracted
 * from the route handlers so the shapes the dashboard renders are pinned by
 * tests rather than re-derived by eye.
 */

export interface AiTokenRow {
  feature: string | null;
  provider: string | null;
  token_estimate: number | null;
  created_at: string;
}

export interface AiTokenAggregate {
  totalTokens: number;
  paidCalls: number;
  cacheServed: number;
  byFeature: Record<string, { tokens: number; calls: number; cacheServed: number }>;
  byDay: Record<string, { tokens: number; calls: number }>;
  byProvider: Record<string, { tokens: number; calls: number }>;
}

/**
 * token_estimate is provider-reported prompt+completion for paid calls and
 * NULL for cache replays (provider 'cache'), so tokens here are genuine spend.
 * Cache-served calls are counted, never summed into token totals.
 */
export function aggregateAiTokenRows(rows: AiTokenRow[]): AiTokenAggregate {
  const agg: AiTokenAggregate = {
    totalTokens: 0,
    paidCalls: 0,
    cacheServed: 0,
    byFeature: {},
    byDay: {},
    byProvider: {},
  };

  for (const row of rows) {
    const tokens = typeof row.token_estimate === 'number' ? row.token_estimate : 0;
    const fromCache = row.provider === 'cache';
    const feature = row.feature || 'unknown';
    const day = String(row.created_at).slice(0, 10);

    const f = (agg.byFeature[feature] ||= { tokens: 0, calls: 0, cacheServed: 0 });
    const d = (agg.byDay[day] ||= { tokens: 0, calls: 0 });
    f.calls += 1;
    d.calls += 1;

    if (fromCache) {
      agg.cacheServed += 1;
      f.cacheServed += 1;
    } else {
      agg.paidCalls += 1;
      agg.totalTokens += tokens;
      f.tokens += tokens;
      d.tokens += tokens;
      const prov = (agg.byProvider[row.provider || 'unknown'] ||= { tokens: 0, calls: 0 });
      prov.calls += 1;
      prov.tokens += tokens;
    }
  }

  return agg;
}

export interface ProductEventRow {
  event: string | null;
  surface: string | null;
  user_id: string | null;
  created_at: string;
}

export interface ProductEventAggregate {
  totalEvents: number;
  uniqueUsers: number;
  byEvent: Record<string, { total: number; web: number; mobile: number }>;
  byDay: Record<string, number>;
}

export function aggregateProductEventRows(rows: ProductEventRow[]): ProductEventAggregate {
  const byEvent: ProductEventAggregate['byEvent'] = {};
  const byDay: Record<string, number> = {};
  const users = new Set<string>();

  for (const row of rows) {
    const e = (byEvent[row.event || 'unknown'] ||= { total: 0, web: 0, mobile: 0 });
    e.total += 1;
    if (row.surface === 'mobile') e.mobile += 1;
    else e.web += 1;
    const day = String(row.created_at).slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    if (row.user_id) users.add(row.user_id);
  }

  return { totalEvents: rows.length, uniqueUsers: users.size, byEvent, byDay };
}
