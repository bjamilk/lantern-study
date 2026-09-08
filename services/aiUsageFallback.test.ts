/**
 * The AI-usage figures the web client shows when the server has NOT answered.
 *
 * The bug this guards: `services/ai` seeded its one copy of the counters with
 * DEFAULT_AI_DAILY_LIMIT (20) and returned that seed from every failure path —
 * the cold-start read, the auth-not-ready read, the fetch catch, and the 429
 * backoff early-return. Production runs a 100 allowance, so on any cold start
 * where the fetch had not landed a student was told, as fact, that they had a
 * fifth of their real uses. The cure (shared with mobile): seed the honest
 * unknown (limit 0, which every consumer draws as silence and no gate blocks
 * on), and route every failure through `resolveAIUsageFallback`, which repeats
 * the last SERVER-KNOWN figures when we hold them and otherwise says nothing.
 *
 * Each test resets the module so the singleton counters start fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_USAGE_UNKNOWN } from '@lantern/shared/utils/aiUsage';

vi.mock('./supabase', () => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test' })),
  ensureAuthTokenReady: vi.fn(async () => true),
}));
vi.mock('./jobPoll', () => ({ pollApiJob: vi.fn() }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ currentUser: { id: 'u1' } }) },
}));

import * as supabase from './supabase';

/** A fetch Response just complete enough for fetchAIUsageFromApi. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

async function loadAi() {
  vi.resetModules();
  return import('./ai');
}

beforeEach(() => {
  vi.mocked(supabase.ensureAuthTokenReady).mockResolvedValue(true);
  vi.mocked(supabase.getAuthHeaders).mockResolvedValue({ Authorization: 'Bearer test' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('cold start — before the server has answered', () => {
  it('reads the honest unknown (limit 0), never DEFAULT_AI_DAILY_LIMIT', async () => {
    const ai = await loadAi();
    // The whole finding in one assertion: no confident "20 / 20" seed.
    expect(ai.getLatestAIUsage()).toEqual(AI_USAGE_UNKNOWN);
    expect(ai.getLatestAIUsage().limit).toBe(0);
    expect(ai.getLatestAIUsage().remaining).toBe(0);
  });
});

describe('a successful fetch, then a failure', () => {
  it('repeats the last server-known 100 — not 20, and not nothing', async () => {
    const ai = await loadAi();

    // Server answers with a real 100 allowance.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { used: 17, limit: 100, resetsAt: '2026-09-09T00:00:00Z' }))
    );
    const known = await ai.fetchAIUsage();
    expect(known).toEqual({ used: 17, limit: 100, remaining: 83, resetsAt: '2026-09-09T00:00:00Z' });

    // Now the network dies on a forced refresh.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const afterFailure = await ai.forceRefreshAIUsage();

    expect(afterFailure.limit).toBe(100);
    expect(afterFailure.remaining).toBe(83);
    expect(afterFailure.limit).not.toBe(20);
    expect(ai.getLatestAIUsage().limit).toBe(100);
  });
});

describe('a failure with no figures yet', () => {
  it('fetchAIUsage catch reports unknown (limit 0), not the seed', async () => {
    const ai = await loadAi();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await ai.fetchAIUsage();
    expect(result.limit).toBe(0);
    expect(result).toEqual(AI_USAGE_UNKNOWN);
  });

  it('forceRefreshAIUsage catch reports unknown (limit 0), not the seed', async () => {
    const ai = await loadAi();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await ai.forceRefreshAIUsage();
    expect(result.limit).toBe(0);
  });
});

describe('auth token not ready', () => {
  it('returns unknown (limit 0) rather than the seed when we hold nothing', async () => {
    const ai = await loadAi();
    vi.mocked(supabase.ensureAuthTokenReady).mockResolvedValue(false);
    const fetchSpy = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await ai.fetchAIUsage();
    expect(result.limit).toBe(0);
    // It never reached the network — the token was not ready.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('repeats the last server-known figures when we hold them', async () => {
    const ai = await loadAi();
    // Seed a real 100 via a good fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { used: 5, limit: 100, resetsAt: '2026-09-09T00:00:00Z' }))
    );
    await ai.fetchAIUsage();

    // Token goes not-ready on the next forced read.
    vi.mocked(supabase.ensureAuthTokenReady).mockResolvedValue(false);
    const result = await ai.forceRefreshAIUsage();
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(95);
  });
});

describe('429 backoff early-return', () => {
  it('during a backoff, repeats known figures instead of the seed', async () => {
    const ai = await loadAi();

    // Seed a real 100.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { used: 0, limit: 100, resetsAt: '2026-09-09T00:00:00Z' }))
    );
    await ai.fetchAIUsage();

    // A forced refresh hits a 429, which arms the backoff window.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, {})));
    const afterBackoff = await ai.forceRefreshAIUsage();
    expect(afterBackoff.limit).toBe(100);

    // A plain fetch now takes the `now < backoffUntil` early-return path.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { used: 9, limit: 100, resetsAt: '' }));
    vi.stubGlobal('fetch', fetchSpy);
    const duringBackoff = await ai.fetchAIUsage();
    expect(duringBackoff.limit).toBe(100);
    // The backoff must actually suppress the request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('during a backoff with no figures, reports unknown (limit 0), not the seed', async () => {
    const ai = await loadAi();
    // Cold start straight into a 429.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, {})));
    const first = await ai.fetchAIUsage();
    expect(first.limit).toBe(0);

    // Still in backoff, still nothing known.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { used: 1, limit: 100, resetsAt: '' }));
    vi.stubGlobal('fetch', fetchSpy);
    const during = await ai.fetchAIUsage();
    expect(during.limit).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
