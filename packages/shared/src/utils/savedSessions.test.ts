import type { PausedSessionSummary } from '../types';
import {
  SAVED_SESSION_LIST_LIMIT,
  resolveSavedSessions,
  savedSessionStartedLabel,
  savedSessionSubtitle,
  savedSessionsOverflowLabel,
} from './savedSessions';

const NOW = Date.parse('2026-09-07T17:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

function session(over: Partial<PausedSessionSummary> = {}): PausedSessionSummary {
  return {
    id: 'draft-1',
    sessionKind: 'test',
    status: 'paused',
    title: 'SDOH',
    answeredCount: 0,
    totalQuestions: 5,
    currentQuestionIndex: 0,
    remainingTimeSeconds: null,
    startTime: hoursAgo(1),
    updatedAt: hoursAgo(1),
    pausedAt: hoursAgo(1),
    ...over,
  };
}

describe('resolveSavedSessions', () => {
  it('collapses the eight identical blank drafts into the newest one', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      session({ id: `draft-${i}`, updatedAt: hoursAgo(i + 1), pausedAt: hoursAgo(i + 1) }),
    );
    const view = resolveSavedSessions(rows, NOW);
    expect(view.sessions).toHaveLength(1);
    expect(view.sessions[0].id).toBe('draft-0');
    expect(view.hiddenCount).toBe(0);
  });

  it('never collapses or prunes a session that holds answers', () => {
    const rows = [
      session({ id: 'blank', answeredCount: 0 }),
      session({ id: 'worked', answeredCount: 3 }),
      session({
        id: 'old-but-worked',
        answeredCount: 1,
        updatedAt: hoursAgo(24 * 30),
        pausedAt: hoursAgo(24 * 30),
        startTime: hoursAgo(24 * 30),
      }),
    ];
    const view = resolveSavedSessions(rows, NOW);
    expect(view.sessions.map((s) => s.id).sort()).toEqual(['blank', 'old-but-worked', 'worked']);
  });

  it('drops a blank draft nobody came back to', () => {
    const stale = session({
      id: 'stale',
      updatedAt: hoursAgo(24 * 5),
      pausedAt: hoursAgo(24 * 5),
      startTime: hoursAgo(24 * 5),
    });
    expect(resolveSavedSessions([stale], NOW).sessions).toEqual([]);
  });

  it('keeps blank drafts of DIFFERENT tests apart', () => {
    const view = resolveSavedSessions(
      [session({ id: 'a', title: 'SDOH' }), session({ id: 'b', title: 'Tori I Practice Test' })],
      NOW,
    );
    expect(view.sessions).toHaveLength(2);
  });

  it('orders newest first', () => {
    const view = resolveSavedSessions(
      [
        session({ id: 'older', title: 'A', answeredCount: 1, pausedAt: hoursAgo(9) }),
        session({ id: 'newer', title: 'B', answeredCount: 1, pausedAt: hoursAgo(2) }),
      ],
      NOW,
    );
    expect(view.sessions.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('caps the list and counts the rest instead of drawing them', () => {
    const rows = Array.from({ length: SAVED_SESSION_LIST_LIMIT + 3 }, (_, i) =>
      session({ id: `d${i}`, title: `Test ${i}`, answeredCount: 2, pausedAt: hoursAgo(i + 1) }),
    );
    const view = resolveSavedSessions(rows, NOW);
    expect(view.sessions).toHaveLength(SAVED_SESSION_LIST_LIMIT);
    expect(view.hiddenCount).toBe(3);
  });

  it('survives a row with no usable timestamps', () => {
    const broken = session({ id: 'broken', startTime: '', updatedAt: '', pausedAt: null });
    // Unstamped and empty reads as ancient, so it prunes rather than crashing.
    expect(() => resolveSavedSessions([broken], NOW)).not.toThrow();
    expect(resolveSavedSessions([broken], NOW).sessions).toEqual([]);
  });
});

describe('savedSessionSubtitle', () => {
  it('dates the row so two identical tests are tellable apart', () => {
    expect(savedSessionSubtitle(session({ startTime: '2026-09-07T09:00:00.000Z' }))).toBe(
      'Test · 0 of 5 answered · Started 7 Sep',
    );
  });

  it('names a study run as a study run', () => {
    expect(
      savedSessionSubtitle(
        session({ sessionKind: 'study', answeredCount: 4, startTime: '2026-01-31T09:00:00.000Z' }),
      ),
    ).toBe('Study · 4 of 5 answered · Started 31 Jan');
  });

  it('drops the date rather than printing an invalid one', () => {
    expect(savedSessionStartedLabel(session({ startTime: 'not a date' }))).toBeNull();
    expect(savedSessionSubtitle(session({ startTime: 'not a date' }))).toBe(
      'Test · 0 of 5 answered',
    );
  });
});

describe('savedSessionsOverflowLabel', () => {
  it('counts the rows it did not draw', () => {
    expect(savedSessionsOverflowLabel(3)).toBe('and 3 more saved sessions');
    expect(savedSessionsOverflowLabel(1)).toBe('and 1 more saved session');
  });
});
