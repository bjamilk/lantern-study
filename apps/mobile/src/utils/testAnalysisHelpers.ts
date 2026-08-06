import {
  buildTestAnalysis,
  type RawTestResult,
} from '@lantern/shared/utils/buildDashboardStats';
import { normalizeTestResultSession } from '@lantern/shared/utils/testHelpers';
import type { RecentTest, TestAnalysis, TestAnalysisQuestionTime } from '../types/dashboardStats';
import type { TestAttempt } from '../stores/testStore';

export type QuestionResultStatus = 'correct' | 'incorrect' | 'unattempted';

export const STATUS_BAR_COLORS: Record<QuestionResultStatus, string> = {
  correct: '#22c55e',
  incorrect: '#ef4444',
  unattempted: '#f59e0b',
};

const VALID_STATUSES: QuestionResultStatus[] = ['correct', 'incorrect', 'unattempted'];

function isValidStatus(value: unknown): value is QuestionResultStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as QuestionResultStatus);
}

function assignStatusesFromCounts(
  items: TestAnalysisQuestionTime[],
  correctCount: number,
  incorrectCount: number,
  unattemptedCount: number
): TestAnalysisQuestionTime[] {
  const statuses: QuestionResultStatus[] = [
    ...Array(Math.max(0, correctCount)).fill('correct'),
    ...Array(Math.max(0, incorrectCount)).fill('incorrect'),
    ...Array(Math.max(0, unattemptedCount)).fill('unattempted'),
  ];

  return items.map((item, index) => ({
    ...item,
    status: statuses[index] ?? item.status ?? 'correct',
  }));
}

export function normalizeTestAnalysis(analysis: TestAnalysis | null | undefined): TestAnalysis {
  const safe = analysis ?? {
    correctCount: 0,
    incorrectCount: 0,
    unattemptedCount: 0,
    timePerQuestion: [],
    timePerTag: [],
    tagPerformance: [],
  };

  const rawItems = Array.isArray(safe.timePerQuestion) ? safe.timePerQuestion : [];
  const needsStatusBackfill = rawItems.some(item => !isValidStatus(item?.status));

  let timePerQuestion: TestAnalysisQuestionTime[] = rawItems.map((item, index) => ({
    questionNumber: item?.questionNumber ?? index + 1,
    time: typeof item?.time === 'number' ? item.time : 0,
    status: isValidStatus(item?.status) ? item.status : 'correct',
    stem: item?.stem?.trim() || `Question ${item?.questionNumber ?? index + 1}`,
  }));

  if (needsStatusBackfill && timePerQuestion.length > 0) {
    timePerQuestion = assignStatusesFromCounts(
      timePerQuestion,
      safe.correctCount ?? 0,
      safe.incorrectCount ?? 0,
      safe.unattemptedCount ?? 0
    );
  }

  // Only estimate when we have bars but every dwell is missing — never invent
  // bars from an empty lean payload (that hid the empty state on mobile).
  const allTimesZero = timePerQuestion.length > 0 && timePerQuestion.every(item => item.time <= 0);
  if (allTimesZero) {
    const attemptedCount = timePerQuestion.filter(item => item.status !== 'unattempted').length;
    const estimated = Math.max(1, Math.round(30 / Math.max(attemptedCount, 1)));
    timePerQuestion = timePerQuestion.map(item => ({
      ...item,
      time: item.status === 'unattempted' ? 0 : estimated,
    }));
  }

  return {
    correctCount: safe.correctCount ?? 0,
    incorrectCount: safe.incorrectCount ?? 0,
    unattemptedCount: safe.unattemptedCount ?? 0,
    timePerQuestion,
    timePerTag: Array.isArray(safe.timePerTag) ? safe.timePerTag : [],
    tagPerformance: Array.isArray(safe.tagPerformance) ? safe.tagPerformance : [],
  };
}

export function normalizeRecentTest(test: RecentTest): RecentTest {
  return {
    ...test,
    analysis: normalizeTestAnalysis(test.analysis),
  };
}

export function normalizeDashboardStats(stats: import('../types/dashboardStats').DashboardStats) {
  return {
    ...stats,
    activityDays: stats.activityDays ?? [],
    recentTests: (stats.recentTests ?? []).map(normalizeRecentTest),
  };
}

/**
 * Match web `buildDashboardStats` attempted detection: legacy rows often store
 * only `isCorrect` / `is_correct` without option ids.
 */
export function isAnswerAttempted(answer: any): boolean {
  if (!answer) return false;
  if (answer.isCorrect === true || answer.isCorrect === false) return true;
  if (answer.is_correct === true || answer.is_correct === false) return true;
  if (answer.selectedOptionIds?.length) return true;
  if (answer.fillText?.trim?.()) return true;
  if (answer.matchingAnswers?.length) return true;
  if (answer.diagramAnswers?.length) return true;
  if (typeof answer.userAnswer === 'string' && answer.userAnswer.trim()) return true;
  if (Array.isArray(answer.userAnswer) && answer.userAnswer.length > 0) return true;
  if (answer.userAnswer && typeof answer.userAnswer === 'object' && Object.keys(answer.userAnswer).length > 0) {
    return true;
  }
  // Hydrated attempt answers store the chosen value directly.
  if (typeof answer === 'string' && answer.trim()) return true;
  if (Array.isArray(answer) && answer.length > 0) return true;
  return false;
}

export function resolveQuestionStatus(answer: any): QuestionResultStatus {
  if (!answer) return 'unattempted';
  if (!isAnswerAttempted(answer)) return 'unattempted';
  if (answer.isCorrect === true || answer.is_correct === true) return 'correct';
  return 'incorrect';
}

function getAnswerTimeSeconds(answer: any, fallbackPerQuestion: number, status: QuestionResultStatus): number {
  const raw = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (status === 'unattempted') return 0;
  return fallbackPerQuestion;
}

export function buildAnalysisFromAttempt(attempt: TestAttempt): TestAnalysis {
  const totalQuestions = attempt.answers.length;
  const fallbackPerQuestion =
    totalQuestions > 0 ? Math.max(1, Math.round(attempt.timeSpent / totalQuestions)) : 0;

  const timePerQuestion = attempt.answers.map((answer, index) => {
    const status = resolveQuestionStatus(answer);
    const stem =
      answer.questionText ||
      answer.questionSnapshot?.question ||
      `Question ${index + 1}`;

    return {
      questionNumber: index + 1,
      time: getAnswerTimeSeconds(answer, fallbackPerQuestion, status),
      status,
      stem,
    };
  });

  const correctCount = timePerQuestion.filter(q => q.status === 'correct').length;
  const incorrectCount = timePerQuestion.filter(q => q.status === 'incorrect').length;
  const unattemptedCount = timePerQuestion.filter(q => q.status === 'unattempted').length;

  const tagStats = new Map<string, { correct: number; total: number; totalTime: number; count: number }>();

  attempt.answers.forEach((answer, index) => {
    const tags = answer.tags ?? answer.questionSnapshot?.tags ?? ['General'];
    const status = timePerQuestion[index]?.status ?? resolveQuestionStatus(answer);
    const time = timePerQuestion[index]?.time ?? 0;
    for (const tag of tags) {
      const stats = tagStats.get(tag) || { correct: 0, total: 0, totalTime: 0, count: 0 };
      stats.total++;
      if (status === 'correct') stats.correct++;
      if (status !== 'unattempted') {
        stats.totalTime += time;
        stats.count++;
      }
      tagStats.set(tag, stats);
    }
  });

  return normalizeTestAnalysis({
    correctCount,
    incorrectCount,
    unattemptedCount,
    timePerQuestion,
    timePerTag: Array.from(tagStats.entries())
      .filter(([, stats]) => stats.count > 0)
      .map(([tag, stats]) => ({
        tag,
        avgTime: Math.round(stats.totalTime / stats.count),
        count: stats.count,
      })),
    tagPerformance: Array.from(tagStats.entries()).map(([tag, stats]) => ({
      tag,
      correct: stats.correct,
      total: stats.total,
      accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
    })),
  });
}

/**
 * Build a RecentTest analysis payload from a full session detail response.
 * Uses the same normalize + buildTestAnalysis path as web so stems, status,
 * and timings match (including legacy array user_answers).
 */
export function buildRecentTestFromSessionDetail(
  session: any,
  fallback?: Partial<RecentTest>
): RecentTest {
  const { questions, userAnswers } = normalizeTestResultSession(session);
  const start = session?.start_time || session?.startTime || fallback?.completedAt;
  const end = session?.end_time || session?.endTime || start;
  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : startDate;
  const sessionDuration = Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 1000)
  );

  const recomputedCorrect = Object.values(userAnswers).filter((a) => a?.isCorrect).length;
  const totalQuestions =
    fallback?.totalQuestions ||
    session?.config?.questionCount ||
    session?.totalQuestions ||
    questions.length ||
    Object.keys(userAnswers).length ||
    0;

  // Prefer server correct-count when present; otherwise let buildTestAnalysis
  // derive counts from normalized answers (do not pass fallback.score — that
  // skewed pie slices via `correctAnswersCount || correctCount`).
  const serverCorrectCount =
    typeof session?.correctAnswersCount === 'number'
      ? session.correctAnswersCount
      : typeof session?.correct_answers_count === 'number'
        ? session.correct_answers_count
        : undefined;

  const rawResult: RawTestResult = {
    id: String(session?.id || fallback?.id || ''),
    session: {
      id: String(session?.id || fallback?.id || ''),
      config: session?.config || {},
      questions,
      userAnswers,
      startTime: startDate,
      endTime: endDate,
    },
    score:
      typeof session?.score === 'number'
        ? session.score
        : fallback?.percentage ?? 0,
    totalQuestions,
    correctAnswersCount: serverCorrectCount ?? recomputedCorrect,
  };

  const analysis = normalizeTestAnalysis(buildTestAnalysis(rawResult));

  const score = fallback?.score ?? analysis.correctCount;
  const percentage =
    fallback?.percentage ??
    (typeof session?.score === 'number'
      ? Math.round(session.score)
      : totalQuestions > 0
        ? Math.round((score / totalQuestions) * 100)
        : 0);

  return normalizeRecentTest({
    id: String(session?.id || fallback?.id || ''),
    groupName:
      fallback?.groupName ||
      session?.config?.groupName ||
      session?.config?.group_name ||
      'Test',
    score,
    totalQuestions,
    percentage,
    completedAt: String(end || fallback?.completedAt || new Date().toISOString()),
    timeSpent: fallback?.timeSpent || sessionDuration,
    analysis,
  });
}
