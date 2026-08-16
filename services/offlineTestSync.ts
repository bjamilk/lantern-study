import type { TestResult, UserAnswerRecord, User } from '../types';
import {
  createTestSession,
  createTestResult,
  markPendingSyncResultAsSynced,
  upsertUserQuestionStat,
} from './supabase';
import { useTestStore } from '../stores/testStore';
import { formatActivityLocalDate } from '@lantern/shared/utils';

export interface TestResultSyncGamification {
  points: number;
  badges: User['badges'];
  stats: User['stats'];
  awardedBadges?: User['badges'];
}

export interface TestResultSyncOutcome {
  synced: number;
  remaining: number;
  /** Gamification payload from the last synced result, if the server returned one. */
  gamification?: TestResultSyncGamification;
}

/**
 * Replay queued offline test results to the API (FIFO), then fold them into
 * local test results and question stats. Stops on the first failure so order
 * is preserved. Shared by the manual Sync button and the reconnect auto-sync.
 */
export async function syncPendingTestResults(userId: string): Promise<TestResultSyncOutcome> {
  // Question-bank scores ride the same reconnect moment. Independent of the
  // result replay below: a failure on either side must not block the other.
  void import('./pendingQuestionBankScores')
    .then(({ flushPendingQuestionBankScores }) => flushPendingQuestionBankScores())
    .catch(() => {
      /* leaderboard is not critical to result sync */
    });

  const pending = useTestStore.getState().pendingSyncResults;
  if (pending.length === 0) return { synced: 0, remaining: 0 };

  const syncedIds: string[] = [];
  let gamification: TestResultSyncGamification | undefined;

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
      };
      const savedSession = await createTestSession(sessionData, userId);

      const saved = await createTestResult({
        session_id: savedSession.id,
        score: result.score,
        correct_answers_count: result.correctAnswersCount,
        total_questions: result.totalQuestions,
        activityDate: result.session.endTime
          ? formatActivityLocalDate(new Date(result.session.endTime))
          : formatActivityLocalDate(new Date()),
      });
      const returned = (saved as { gamification?: TestResultSyncGamification })?.gamification;
      if (returned) gamification = returned;

      await markPendingSyncResultAsSynced(result.id);
      syncedIds.push(result.id);
    } catch (error) {
      console.error('[TestResultSync] Failed for pending result', result.id, error);
      break;
    }
  }

  if (syncedIds.length === 0) {
    return { synced: 0, remaining: pending.length };
  }

  const store = useTestStore.getState();
  const syncedResults = pending.filter((r: TestResult) => syncedIds.includes(r.id));
  const remaining = store.pendingSyncResults.filter((r: TestResult) => !syncedIds.includes(r.id));

  store.updateTestResults(prev => {
    const existingIds = new Set(prev.map(r => r.id));
    return [...syncedResults.filter(r => !existingIds.has(r.id)), ...prev];
  });

  const newStats = { ...store.userQuestionStats };
  syncedResults.forEach(result => {
    Object.values(result.session.userAnswers).forEach((answer: UserAnswerRecord) => {
      const stats = newStats[answer.questionId] || {
        correctAttempts: 0,
        incorrectAttempts: 0,
        lastAttempted: '',
      };
      if (answer.isCorrect) stats.correctAttempts++;
      else stats.incorrectAttempts++;
      stats.lastAttempted = result.session.endTime
        ? new Date(result.session.endTime).toISOString()
        : new Date().toISOString();
      newStats[answer.questionId] = stats;

      upsertUserQuestionStat(userId, answer.questionId, stats).catch(error => {
        console.error('[TestResultSync] Error saving user question stat:', error);
      });
    });
  });

  store.setUserQuestionStats(newStats);
  store.setPendingSyncResults(remaining);

  return { synced: syncedIds.length, remaining: remaining.length, gamification };
}
