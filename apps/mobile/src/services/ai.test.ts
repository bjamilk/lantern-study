/**
 * A 429 is the ONE moment the server states this account's real AI figures on a
 * cold start whose usage fetch failed. Now that the store starts at the explicit
 * unknown (limit 0), the old guard `body.limit !== latest.limit` discarded that
 * truth and left the badge hidden. `planAIUsageFromErrorBody` is the pure rule;
 * these cases pin down both directions.
 *
 * `services/ai` pulls in the Supabase client and the shared AI client at import
 * time, so those are mocked away — the planner under test touches neither.
 */
jest.mock('./supabase', () => ({
  getAuthHeaders: jest.fn(async () => ({})),
  API_BASE_URL: 'http://test',
  supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: null } })) } },
}));
jest.mock('@lantern/shared/api', () => ({
  createLanternAI: () => ({ ai: {}, companion: {} }),
  parseGlobalAIUsageFromHeaders: jest.fn(),
}));
jest.mock('./jobWatch', () => ({ settleJob: (fn: () => unknown) => fn() }));

import type { AIUsageInfo } from '@lantern/shared';
import { AI_USAGE_UNKNOWN } from '@lantern/shared/utils/aiUsage';
import { applyAIUsageFromErrorBody, planAIUsageFromErrorBody } from './ai';
import { __resetAIUsageForTests, getLatestAIUsage, publishAIUsage } from './aiUsageStore';

const KNOWN: AIUsageInfo = { used: 83, limit: 100, remaining: 17, resetsAt: '2026-09-08T00:00:00Z' };

describe('planAIUsageFromErrorBody', () => {
  describe('accepts the server truth when the current figures are UNKNOWN', () => {
    it('a cold start (limit 0) takes the body even though its limit differs', () => {
      // The regression: with the store at the honest unknown, `body.limit` (100)
      // never equals `latest.limit` (0), so the old guard threw the truth away.
      const next = planAIUsageFromErrorBody(
        { used: 5, limit: 100, resetsAt: '2026-09-08T00:00:00Z' },
        AI_USAGE_UNKNOWN
      );
      expect(next).toEqual({
        used: 5,
        limit: 100,
        remaining: 95,
        resetsAt: '2026-09-08T00:00:00Z',
      });
    });

    it('carries the previous resetsAt when the body omits it', () => {
      const latest: AIUsageInfo = { ...AI_USAGE_UNKNOWN, resetsAt: '2026-09-08T00:00:00Z' };
      const next = planAIUsageFromErrorBody({ used: 5, limit: 100 }, latest);
      expect(next?.resetsAt).toBe('2026-09-08T00:00:00Z');
    });
  });

  describe('protects a KNOWN allowance from a stale figure', () => {
    it('refuses a body whose limit differs from a known-good limit', () => {
      // A lagging refusal from before an allowance change must not clobber it.
      expect(planAIUsageFromErrorBody({ used: 20, limit: 20 }, KNOWN)).toBeNull();
    });

    it('accepts a body whose limit matches the known one (a real update)', () => {
      const next = planAIUsageFromErrorBody({ used: 99, limit: 100 }, KNOWN);
      expect(next).toEqual({ used: 99, limit: 100, remaining: 1, resetsAt: KNOWN.resetsAt });
    });

    it('never lets remaining go negative', () => {
      const next = planAIUsageFromErrorBody({ used: 120, limit: 100 }, KNOWN);
      expect(next?.remaining).toBe(0);
    });
  });

  describe('ignores bodies that state nothing about the global allowance', () => {
    it('a non-numeric used/limit says nothing', () => {
      expect(planAIUsageFromErrorBody({ used: 5 }, AI_USAGE_UNKNOWN)).toBeNull();
      expect(planAIUsageFromErrorBody({ limit: 100 }, AI_USAGE_UNKNOWN)).toBeNull();
      expect(planAIUsageFromErrorBody(null, AI_USAGE_UNKNOWN)).toBeNull();
      expect(planAIUsageFromErrorBody('nope', AI_USAGE_UNKNOWN)).toBeNull();
    });

    it('a per-feature denial (different scale) is never written to the global badge', () => {
      expect(
        planAIUsageFromErrorBody(
          { used: 15, limit: 15, feature: 'generate_flashcards' },
          AI_USAGE_UNKNOWN
        )
      ).toBeNull();
    });
  });
});

describe('applyAIUsageFromErrorBody (store integration)', () => {
  beforeEach(() => __resetAIUsageForTests());

  it('corrects a hidden badge on a cold-start 429', () => {
    // Store begins at the unknown; the refusal is the first real figure.
    expect(getLatestAIUsage().limit).toBe(0);
    applyAIUsageFromErrorBody({ used: 5, limit: 100, resetsAt: '2026-09-08T00:00:00Z' });
    expect(getLatestAIUsage()).toEqual({
      used: 5,
      limit: 100,
      remaining: 95,
      resetsAt: '2026-09-08T00:00:00Z',
    });
  });

  it('leaves a known-good badge untouched when a stale body arrives', () => {
    publishAIUsage(KNOWN);
    applyAIUsageFromErrorBody({ used: 20, limit: 20 });
    expect(getLatestAIUsage()).toEqual(KNOWN);
  });
});
