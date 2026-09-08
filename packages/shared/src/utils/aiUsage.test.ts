import type { AIUsageInfo } from '../types';
import {
  AI_USAGE_CHECKING_LABEL,
  AI_USAGE_NO_FIGURES_NOTE,
  AI_USAGE_STALE_FIGURES_NOTE,
  AI_USAGE_UNCHECKED_LABEL,
  AI_USAGE_UNKNOWN,
  aiUsageCounterCopy,
  DEFAULT_AI_DAILY_LIMIT,
  getAIResetLabel,
  isAIUsageKnown,
  resolveAIUsageFallback,
} from './aiUsage';

describe('aiUsage', () => {
  it('defaults free daily credits to 20', () => {
    expect(DEFAULT_AI_DAILY_LIMIT).toBe(20);
  });
});

describe('AI_USAGE_UNKNOWN', () => {
  it('is a limit-0 snapshot that asserts no balance and no reset', () => {
    expect(AI_USAGE_UNKNOWN).toEqual({ used: 0, limit: 0, remaining: 0, resetsAt: '' });
  });

  it('never borrows the shared default as an allowance', () => {
    // The whole point: the unknown state must not be DEFAULT_AI_DAILY_LIMIT
    // wearing a different name.
    expect(AI_USAGE_UNKNOWN.limit).not.toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(AI_USAGE_UNKNOWN.limit).toBe(0);
  });

  it('renders no reset label — so it can never claim midnight', () => {
    // limit <= 0 short-circuits getAIResetLabel before the used===0 branch that
    // prints "Resets at midnight GMT", so an unknown allowance stays silent.
    expect(
      getAIResetLabel(AI_USAGE_UNKNOWN.resetsAt, {
        used: AI_USAGE_UNKNOWN.used,
        limit: AI_USAGE_UNKNOWN.limit,
        nowMs: Date.parse('2026-09-07T09:00:00Z'),
      })
    ).toBe('');
  });
});

describe('isAIUsageKnown', () => {
  it('is true only for a positive server-reported limit', () => {
    expect(isAIUsageKnown({ used: 0, limit: 100, remaining: 100, resetsAt: '' })).toBe(true);
    expect(isAIUsageKnown({ used: 99, limit: 100, remaining: 1, resetsAt: '' })).toBe(true);
  });

  it('is false for an unknown, empty, zero-limit or null snapshot', () => {
    expect(isAIUsageKnown(AI_USAGE_UNKNOWN)).toBe(false);
    expect(isAIUsageKnown({ used: 0, limit: 0, remaining: 0, resetsAt: '' })).toBe(false);
    expect(isAIUsageKnown(null)).toBe(false);
    expect(isAIUsageKnown(undefined)).toBe(false);
  });
});

describe('resolveAIUsageFallback', () => {
  it('repeats the last server-known figures when we still hold them', () => {
    const known: AIUsageInfo = { used: 17, limit: 100, remaining: 83, resetsAt: '2026-09-08T00:00:00Z' };
    // A slow refresh must not flicker a real "83 of 100" to anything else.
    expect(resolveAIUsageFallback(known)).toBe(known);
  });

  it('reports the honest unknown when nothing is cached (cold start)', () => {
    expect(resolveAIUsageFallback(null)).toEqual(AI_USAGE_UNKNOWN);
    expect(resolveAIUsageFallback(undefined)).toEqual(AI_USAGE_UNKNOWN);
  });

  it('never manufactures "20 of 20" out of the shared default', () => {
    const fallback = resolveAIUsageFallback(null);
    expect(fallback.limit).not.toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(fallback.remaining).not.toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(fallback.limit).toBe(0);
    expect(fallback.remaining).toBe(0);
  });

  it('treats a cached unknown as still unknown, not as an allowance', () => {
    // A previous failure left AI_USAGE_UNKNOWN cached; a second failure must
    // not promote limit 0 into a real number.
    expect(resolveAIUsageFallback(AI_USAGE_UNKNOWN)).toEqual(AI_USAGE_UNKNOWN);
  });

  it('reproduces the finding: 100-of-100 then a cold-start failure never becomes 20-of-20', () => {
    // 09:00 — a successful fetch is cached.
    const morning: AIUsageInfo = {
      used: 0,
      limit: 100,
      remaining: 100,
      resetsAt: '2026-09-08T00:00:00Z',
    };
    // Same process, a later failed refresh: repeat the truth, still 100.
    expect(resolveAIUsageFallback(morning)).toBe(morning);

    // 09:10 — the app was cold-started, so nothing is cached, and the usage
    // fetch fails. The OLD code returned { limit: 20, remaining: 20 } here; the
    // fix returns the honest unknown, which every counter renders as silence.
    const afterColdStart = resolveAIUsageFallback(null);
    expect(afterColdStart.limit).toBe(0);
    expect(afterColdStart.remaining).toBe(0);
    // And the reset line makes no midnight claim on that unknown snapshot.
    expect(
      getAIResetLabel(afterColdStart.resetsAt, {
        used: afterColdStart.used,
        limit: afterColdStart.limit,
      })
    ).toBe('');
  });
});

describe('aiUsageCounterCopy', () => {
  const KNOWN = '83 of 100 AI uses left today';

  it('prints the real figures once the server has answered', () => {
    expect(
      aiUsageCounterCopy({
        knownLabel: KNOWN,
        limit: 100,
        serverAnswered: true,
        loading: false,
        failed: false,
      })
    ).toEqual({ countLine: KNOWN, offlineNote: null });
  });

  it('says it is CHECKING, not that the account has no AI, while the first read runs', () => {
    // buildAIUsageView's limit-0 label is "AI uses are not available on this
    // account" — true of a server that answered zero, a lie about a phone that
    // has not been told yet. A cold start must never print it.
    const copy = aiUsageCounterCopy({
      knownLabel: 'AI uses are not available on this account',
      limit: 0,
      serverAnswered: false,
      loading: true,
      failed: false,
    });
    expect(copy.countLine).toBe(AI_USAGE_CHECKING_LABEL);
    expect(copy.countLine).not.toMatch(/not available/i);
    expect(copy.offlineNote).toBeNull();
  });

  it('says it could not check — and claims no stale figures — when the read failed cold', () => {
    const copy = aiUsageCounterCopy({
      knownLabel: 'AI uses are not available on this account',
      limit: 0,
      serverAnswered: false,
      loading: false,
      failed: true,
    });
    expect(copy.countLine).toBe(AI_USAGE_UNCHECKED_LABEL);
    expect(copy.offlineNote).toBe(AI_USAGE_NO_FIGURES_NOTE);
    // The old note promised "the last figures this phone saw" when there were none.
    expect(copy.offlineNote).not.toBe(AI_USAGE_STALE_FIGURES_NOTE);
  });

  it('keeps real older figures on screen when a refresh fails, and says they are old', () => {
    const copy = aiUsageCounterCopy({
      knownLabel: KNOWN,
      limit: 100,
      serverAnswered: false,
      loading: false,
      failed: true,
    });
    expect(copy.countLine).toBe(KNOWN);
    expect(copy.offlineNote).toBe(AI_USAGE_STALE_FIGURES_NOTE);
  });

  it('still tells the truth when the server really answers with no allowance', () => {
    const copy = aiUsageCounterCopy({
      knownLabel: 'AI uses are not available on this account',
      limit: 0,
      serverAnswered: true,
      loading: false,
      failed: false,
    });
    expect(copy.countLine).toBe('AI uses are not available on this account');
  });
});
