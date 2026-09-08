// ===========================================
// Lantern Study - Saved sessions, pruned and dated
// ===========================================
/**
 * What Home should actually show under "Saved sessions".
 *
 * The audit found eight rows reading "Test · SDOH — Test · 0 of 5 answered",
 * one under the next, with nothing to tell them apart and no way to know which
 * was which. Every one of them held zero answers: opening the builder and
 * backing out writes a draft, and nothing ever cleared them. The list was
 * therefore both a lie of detail (identical rows are not eight different
 * things worth resuming) and a lie of value (a session with no answers is not
 * work in progress).
 *
 * Three rules, in this order, and one invariant above all of them:
 *
 *   NEVER drop a session that holds answers. Pruning is a display decision;
 *   the drafts still exist on the server, and a student's typed work is not
 *   ours to hide. Everything below only ever collapses or hides EMPTY drafts.
 *
 *   1. Newest first, by when the session was last touched.
 *   2. Collapse empty duplicates: of several zero-answer drafts of the same
 *      test, only the newest can be meaningfully resumed — they are the same
 *      blank page. Sessions with answers are never collapsed into each other.
 *   3. Prune, then cap: an empty draft older than the purge window is stale
 *      clutter; and beyond the list limit the rest are counted, not drawn.
 *
 * The window and limit follow the shape `studyRooms.ts` already set for the
 * other list that grows on its own.
 */
import type { PausedSessionSummary } from '../types';
import { pluralize } from './plural';

/** An empty draft older than this is clutter, not work. */
export const SAVED_SESSION_EMPTY_PURGE_AFTER_DAYS = 2;

/** How many rows Home draws before it starts counting instead. */
export const SAVED_SESSION_LIST_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the session was last touched — the only field we sort on. */
function touchedAt(session: PausedSessionSummary): number {
  const candidates = [session.pausedAt, session.updatedAt, session.startTime];
  for (const value of candidates) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

/** Same test, same shape — the key an empty duplicate collapses on. */
function identity(session: PausedSessionSummary): string {
  return `${session.sessionKind}|${session.title.trim().toLowerCase()}|${session.totalQuestions}`;
}

function hasAnswers(session: PausedSessionSummary): boolean {
  return (session.answeredCount ?? 0) > 0;
}

export interface SavedSessionsView {
  /** The rows to draw, newest first. */
  sessions: PausedSessionSummary[];
  /**
   * How many real sessions exist beyond the ones drawn — for "and 3 more".
   * Collapsed and pruned empty drafts are NOT counted here: they are not
   * things a student would go looking for.
   */
  hiddenCount: number;
}

/**
 * Apply the three rules. Pure; `now` is injected so the tests do not drift.
 */
export function resolveSavedSessions(
  sessions: readonly PausedSessionSummary[],
  now: number = Date.now(),
  limit: number = SAVED_SESSION_LIST_LIMIT,
): SavedSessionsView {
  const ordered = [...sessions].sort((a, b) => touchedAt(b) - touchedAt(a));

  const cutoff = now - SAVED_SESSION_EMPTY_PURGE_AFTER_DAYS * DAY_MS;
  const seenEmpty = new Set<string>();
  const kept: PausedSessionSummary[] = [];

  for (const session of ordered) {
    if (hasAnswers(session)) {
      kept.push(session);
      continue;
    }
    // Rule 3: a blank draft nobody came back to.
    if (touchedAt(session) < cutoff) continue;
    // Rule 2: one blank page per test is enough.
    const key = identity(session);
    if (seenEmpty.has(key)) continue;
    seenEmpty.add(key);
    kept.push(session);
  }

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : kept.length;
  return {
    sessions: kept.slice(0, safeLimit),
    hiddenCount: Math.max(0, kept.length - safeLimit),
  };
}

/**
 * "Started 7 Sep" — the fact that made eight identical rows tellable apart.
 * Falls back to the honest vaguer form rather than printing an invalid date.
 */
export function savedSessionStartedLabel(session: PausedSessionSummary): string | null {
  const time = Date.parse(session.startTime ?? '');
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return `Started ${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}

/**
 * The one subtitle both clients use:
 * "Test · 0 of 5 answered · Started 7 Sep".
 */
export function savedSessionSubtitle(session: PausedSessionSummary): string {
  const kind = session.sessionKind === 'study' ? 'Study' : 'Test';
  const progress = `${session.answeredCount} of ${session.totalQuestions} answered`;
  const started = savedSessionStartedLabel(session);
  return [kind, progress, started].filter(Boolean).join(' · ');
}

/** "and 3 more saved sessions" — only rendered when hiddenCount > 0. */
export function savedSessionsOverflowLabel(hiddenCount: number): string {
  return `and ${pluralize(hiddenCount, 'more saved session')}`;
}
