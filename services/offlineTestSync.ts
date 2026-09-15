/**
 * Replay of the offline test-result queue.
 *
 * Exports:
 *  - `syncPendingTestResults(userId)` — single-flight wrapper around the replay
 *  - `TestResultSyncOutcome` / `TestResultSyncGamification` — the shapes the
 *    Sync button and the reconnect auto-sync render from
 * Touches: `useTestStore` (`pendingSyncResults`, `userQuestionStats`,
 *  `updateTestResults`, `setPendingSyncResults`), the API via
 *  `createTestSession` / `createTestResult` / `markPendingSyncResultAsSynced` /
 *  `upsertUserQuestionStat` in `./supabase`, and (fire-and-forget) the
 *  question-bank score queue in `./pendingQuestionBankScores`.
 * Gotchas:
 *  - Transient vs permanent is decided by the HTTP status ON THE ERROR
 *    (`error.status`, message as a fallback — `parseHttpStatus`). 4xx other
 *    than 408/429 is permanent: the row leaves the FIFO and is written to the
 *    failed bucket (`failedTestResultsKey`, read with `readFailedTestResults`)
 *    — never deleted. Anything else (5xx, network, no status at all) is
 *    transient: the row is kept and the loop BREAKS.
 *  - FIXED (G4 · H14): `createTestSession` used to throw the server's own
 *    sentence with no status anywhere, so the permanent branch was dead and a
 *    single rejected result wedged the queue for good. Both ends were fixed:
 *    the throw carries `.status`/`.code`, and classification reads properties
 *    first.
 *  - The loop breaks rather than continues on a transient failure so FIFO order
 *    (and therefore the order results appear in history) is preserved.
 *  - FIXED (F2): each result now carries an idempotency key derived from its
 *    own queue id (`resultIdempotencyKey`), stable across retries, so a
 *    session that was created server-side but whose response was lost is
 *    REPLAYED rather than created a second time. `syncInFlight` stays: it
 *    keeps FIFO order and spares the server the duplicate round trip.
 *  - Question stats are UPLOADED here, never re-incremented — the offline
 *    submit path already incremented them locally.
 *  - Ownership is NOT checked here; callers must have run
 *    `ensureOfflineQueueOwner` first or another account's results replay into
 *    this one. This function does restore anything that guard set ASIDE for
 *    this user (F2), which is how a student who signs back in on a shared
 *    browser gets their own queued results again.
 */
import type { TestResult, UserAnswerRecord, User } from '../types';
import {
  createTestSession,
  createTestResult,
  markPendingSyncResultAsSynced,
  upsertUserQuestionStat,
} from './supabase';
import { useTestStore } from '../stores/testStore';
import { formatActivityLocalDate } from '@lantern/shared/utils';
import { mergeQueues, resultIdempotencyKey } from '@lantern/shared/offlineQueue';
import { takeQuarantinedQueue } from './offlineQueueOwner';

export interface TestResultSyncGamification {
  points: number;
  badges: User['badges'];
  stats: User['stats'];
  awardedBadges?: User['badges'];
}

export interface TestResultSyncOutcome {
  synced: number;
  remaining: number;
  /**
   * Results the server permanently rejected (4xx other than 408/429). They are
   * NOT deleted — they are moved to the failed bucket
   * (`failedTestResultsKey`), which the UI can read with
   * `readFailedTestResults`, so the student can see what could not be uploaded.
   */
  failed?: number;
  /** Gamification payload from the last synced result, if the server returned one. */
  gamification?: TestResultSyncGamification;
}

/** Where permanently rejected results wait for the student to see them. */
export const failedTestResultsKey = (userId: string): string =>
  `lantern_failed_test_results:${userId}`;

/** A result the server refused, with why, for the UI to show. */
export interface FailedTestResult {
  result: TestResult;
  status: number | null;
  code?: string;
  message: string;
  failedAt: string;
}

/** The results this user could not upload. [] when there are none. */
export function readFailedTestResults(userId: string): FailedTestResult[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(failedTestResultsKey(userId)) || '[]');
    return Array.isArray(parsed) ? (parsed.filter(Boolean) as FailedTestResult[]) : [];
  } catch {
    return [];
  }
}

/** Append to the failed bucket, de-duplicated by result id. Never throws. */
function recordFailedTestResults(userId: string, entries: FailedTestResult[]): void {
  if (typeof window === 'undefined' || !userId || entries.length === 0) return;
  try {
    const existing = readFailedTestResults(userId);
    const byId = new Map<string, FailedTestResult>();
    for (const entry of [...existing, ...entries]) {
      byId.set(entry?.result?.id || `${byId.size}`, entry);
    }
    localStorage.setItem(failedTestResultsKey(userId), JSON.stringify([...byId.values()]));
  } catch {
    // Storage full or disabled. The result is still removed from the FIFO (it
    // can never be accepted); losing the receipt is better than wedging every
    // result queued behind it.
  }
}

/**
 * HTTP status of a failed API call.
 *
 * FIXED (G4 · H14): the `status` PROPERTY is read first. It used to be scraped
 * out of the message alone, and `createTestSession` threw the server's own
 * sentence — which carries no status — so every rejection was classified
 * transient, the FIFO loop broke, and one permanently-rejected result stopped
 * every result queued behind it from ever syncing. The message is still read
 * as a fallback for older throw sites.
 */
function parseHttpStatus(error: unknown): number | null {
  const direct = (error as { status?: unknown } | null)?.status;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const m = error instanceof Error ? error.message.match(/status:\s*(\d{3})/) : null;
  return m ? Number(m[1]) : null;
}

/** The server's error `code`, when the throw site attached one. */
function parseErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : undefined;
}

let syncInFlight: Promise<TestResultSyncOutcome> | null = null;

/**
 * Replay queued offline test results to the API (FIFO), then fold them into
 * local test results and question stats. Stops on the first transient failure
 * so order is preserved; a permanently rejected result (4xx other than
 * 408/429) is set aside in the failed bucket so one poisoned row can't wedge
 * the queue forever — and the student can still see it.
 * Shared by the manual Sync button and the reconnect auto-sync — concurrent
 * calls coalesce onto one run, because the replay has no server-side
 * idempotency key: two parallel runs would create duplicate sessions and
 * double-award points.
 */
export async function syncPendingTestResults(userId: string): Promise<TestResultSyncOutcome> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSyncPendingTestResults(userId).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doSyncPendingTestResults(userId: string): Promise<TestResultSyncOutcome> {
  // Question-bank scores ride the same reconnect moment. Independent of the
  // result replay below: a failure on either side must not block the other.
  void import('./pendingQuestionBankScores')
    .then(({ flushPendingQuestionBankScores }) => flushPendingQuestionBankScores())
    .catch(() => {
      /* leaderboard is not critical to result sync */
    });

  // FIXED (F2): results this browser set aside while a DIFFERENT account was
  // signed in come back the moment their owner returns. The old guard deleted
  // them outright; now they were only quarantined, and this is the door back.
  // They go through the store (not straight to localStorage) because the
  // effect that mirrors the store to the live key would otherwise overwrite
  // them on the same commit.
  const restored = takeQuarantinedQueue<TestResult>('pendingSyncResults', userId);
  if (restored.length > 0) {
    const merged = mergeQueues(
      useTestStore.getState().pendingSyncResults as TestResult[],
      restored
    ) as TestResult[];
    useTestStore.getState().setPendingSyncResults(merged);
  }

  const pending = useTestStore.getState().pendingSyncResults;
  if (pending.length === 0) return { synced: 0, remaining: 0 };

  const syncedIds: string[] = [];
  const failedIds: string[] = [];
  const failedEntries: FailedTestResult[] = [];
  let gamification: TestResultSyncGamification | undefined;

  // FIFO replay. Each result is two dependent writes — session first, then the
  // result row that references it — followed by clearing the pending flag. A
  // throw anywhere in that trio leaves the row queued (or drops it, below).
  for (const result of pending) {
    try {
      const sessionData = {
        config: result.session.config,
        questions: result.session.questions,
        user_answers: result.session.userAnswers,
        start_time: new Date(result.session.startTime).toISOString(),
        end_time: result.session.endTime
          ? new Date(result.session.endTime).toISOString()
          : undefined,
        is_offline: result.session.isOffline || false,
        // FIXED (F2): stable per queued attempt, never re-minted on a retry.
        // The data layer spreads this into the POST body and the route reads
        // it as its idempotency fallback key, so a lost response replays the
        // FIRST session instead of creating a second one for one sitting.
        idempotencyKey: resultIdempotencyKey(result as { id?: string }, { userId }),
      };
      const savedSession = await createTestSession(sessionData, userId);

      // The result row is keyed server-side off the session id (one session,
      // one result), so it needs nothing from the client here.
      const resultData = {
        session_id: savedSession.id,
        score: result.score,
        correct_answers_count: result.correctAnswersCount,
        total_questions: result.totalQuestions,
        activityDate: result.session.endTime
          ? formatActivityLocalDate(new Date(result.session.endTime))
          : formatActivityLocalDate(new Date()),
      };
      const saved = await createTestResult(resultData);
      const returned = (saved as { gamification?: TestResultSyncGamification })?.gamification;
      if (returned) gamification = returned;

      await markPendingSyncResultAsSynced(result.id);
      syncedIds.push(result.id);
    } catch (error) {
      const status = parseHttpStatus(error);
      const permanent = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (permanent) {
        // The server will never accept this row. It leaves the FIFO — one
        // poisoned result must not block every result queued behind it — but
        // it is NOT deleted: it moves to the failed bucket, where the student
        // can still see the sitting that could not be uploaded.
        console.error(
          '[TestResultSync] Permanently rejected; moved to the failed bucket',
          result.id,
          error
        );
        failedIds.push(result.id);
        failedEntries.push({
          result,
          status,
          code: parseErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
          failedAt: new Date().toISOString(),
        });
        continue;
      }
      // Transient (offline, 5xx, 408/429, or an unparseable error): keep the row
      // and stop, so everything queued behind it retries in the same order.
      console.error('[TestResultSync] Failed for pending result', result.id, error);
      break;
    }
  }

  // Write the receipts before the queue shrinks, so a storage failure cannot
  // leave a result removed from the FIFO with nothing recording it.
  recordFailedTestResults(userId, failedEntries);

  if (syncedIds.length === 0 && failedIds.length === 0) {
    return { synced: 0, remaining: pending.length };
  }

  // Re-read the store rather than reusing the `pending` snapshot taken above:
  // a submit can have queued another result while the awaits were in flight,
  // and filtering the FRESH list is what stops that row being dropped.
  const store = useTestStore.getState();
  const syncedResults = pending.filter((r: TestResult) => syncedIds.includes(r.id));
  const removedIds = new Set([...syncedIds, ...failedIds]);
  const remaining = store.pendingSyncResults.filter((r: TestResult) => !removedIds.has(r.id));

  store.updateTestResults(prev => {
    const existingIds = new Set(prev.map(r => r.id));
    return [...syncedResults.filter(r => !existingIds.has(r.id)), ...prev];
  });

  // The offline submit path already incremented local question stats for these
  // answers (hooks/useTestHandlers offline branch) — re-incrementing here
  // double-counted every attempt and pushed the doubled totals to the server.
  // Replay only SYNCS the already-correct local stats for the questions the
  // synced results touched.
  const currentStats = store.userQuestionStats;
  const touchedQuestionIds = new Set<string>();
  syncedResults.forEach(result => {
    Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
      touchedQuestionIds.add(answer.questionId);
    });
  });
  touchedQuestionIds.forEach(questionId => {
    const stats = currentStats[questionId];
    if (!stats) return;
    upsertUserQuestionStat(userId, questionId, stats).catch(error => {
      console.error('[TestResultSync] Error saving user question stat:', error);
    });
  });

  store.setPendingSyncResults(remaining);

  return {
    synced: syncedIds.length,
    remaining: remaining.length,
    failed: failedIds.length || undefined,
    gamification,
  };
}
