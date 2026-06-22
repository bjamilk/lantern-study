import {
  calculateUserLevel,
  type Badge,
  type DashboardStats,
  type GroupPerformance,
  type RecentTest,
  type TestAnalysis,
  type TimePeriod,
  type TopicPerformance,
  type TroublesomeQuestion,
} from '../types/dashboardStats';
import { resolveQuestionResultStatus } from '@lantern/shared/utils';

export interface RawTestResult {
  id?: string;
  session: {
    id?: string;
    config?: {
      groupId?: string;
      groupName?: string;
      name?: string;
      passingScore?: number;
    };
    questions?: any[];
    userAnswers?: Record<string, any>;
    startTime?: string | Date;
    endTime?: string | Date;
  };
  score: number;
  totalQuestions: number;
  correctAnswersCount: number;
}

export interface UserQuestionStatEntry {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted?: string | null;
}

function toDate(value?: string | Date): Date {
  if (!value) return new Date(0);
  return value instanceof Date ? value : new Date(value);
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPeriodCutoff(period: TimePeriod): Date | null {
  if (period === 'all') return null;
  const days = period === '7days' ? 7 : period === '30days' ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

function filterResultsByPeriod(results: RawTestResult[], period: TimePeriod): RawTestResult[] {
  const cutoff = getPeriodCutoff(period);
  if (!cutoff) return results;
  return results.filter(result => toDate(result.session.startTime) >= cutoff);
}

function dedupeResults(results: RawTestResult[]): RawTestResult[] {
  const byStartTime = new Map<number, RawTestResult>();
  for (const result of results) {
    const ts = toDate(result.session.startTime).getTime();
    const existing = byStartTime.get(ts);
    const resultId = result.session.id || result.id;
    const existingId = existing?.session.id || existing?.id;
    if (!existing || (!existingId && resultId)) {
      byStartTime.set(ts, result);
    }
  }
  return Array.from(byStartTime.values());
}

function getGroupName(
  groupId: string | undefined,
  storedName: string | undefined,
  groups: { id: string; name: string }[]
): string {
  if (!groupId && storedName) return storedName;
  if (groupId) {
    const group = groups.find(g => g.id === groupId);
    if (group) return group.name;
  }
  return storedName || 'Unknown Group';
}

function getQuestionStem(question: any): string {
  return question?.questionStem || question?.question || question?.text || '';
}

function getQuestionTags(question: any): string[] {
  if (Array.isArray(question?.tags) && question.tags.length > 0) {
    return question.tags;
  }
  return ['General'];
}

function isAnswerAttempted(answer: any): boolean {
  if (!answer) return false;
  return (
    (answer.selectedOptionIds?.length ?? 0) > 0 ||
    (typeof answer.fillText === 'string' && answer.fillText.trim() !== '') ||
    (answer.matchingAnswers?.length ?? 0) > 0 ||
    (answer.diagramAnswers?.length ?? 0) > 0 ||
    answer.isCorrect === true ||
    answer.isCorrect === false
  );
}

function resolveAnswerStatus(answer: any): 'correct' | 'incorrect' | 'unattempted' {
  if (!isAnswerAttempted(answer)) return 'unattempted';
  const question = (answer as any)?.questionSnapshot || (answer as any)?.question;
  if (question) {
    return resolveQuestionResultStatus(question, answer);
  }
  return answer?.isCorrect ? 'correct' : 'incorrect';
}

function getAnswerTimeSpent(answer: any): number {
  const timeSpent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
  return typeof timeSpent === 'number' ? timeSpent : 0;
}

function getSessionDurationSeconds(result: RawTestResult): number {
  const start = toDate(result.session.startTime);
  const end = result.session.endTime ? toDate(result.session.endTime) : start;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function buildTestAnalysis(result: RawTestResult): TestAnalysis {
  const questions = result.session.questions || [];
  const userAnswers = result.session.userAnswers || {};
  const timePerQuestion: TestAnalysis['timePerQuestion'] = [];
  const tagStats = new Map<string, { correct: number; total: number; totalTime: number; count: number }>();

  let correctCount = 0;
  let incorrectCount = 0;
  let unattemptedCount = 0;

  const recordQuestion = (
    question: any,
    answer: any,
    index: number,
    tags: string[]
  ) => {
    const status = resolveAnswerStatus(answer);
    if (status === 'correct') correctCount++;
    else if (status === 'incorrect') incorrectCount++;
    else unattemptedCount++;

    const timeSpent = getAnswerTimeSpent(answer);
    timePerQuestion.push({
      questionNumber: question?.questionNumber ?? index + 1,
      time: timeSpent,
      status,
      stem: question ? getQuestionStem(question) : `Question ${index + 1}`,
    });

    if (status === 'unattempted') return;

    for (const tag of tags) {
      const stats = tagStats.get(tag) || { correct: 0, total: 0, totalTime: 0, count: 0 };
      stats.total++;
      if (answer?.isCorrect) stats.correct++;
      if (timeSpent > 0) {
        stats.totalTime += timeSpent;
        stats.count++;
      }
      tagStats.set(tag, stats);
    }
  };

  if (questions.length > 0) {
    questions.forEach((question, index) => {
      const answer = userAnswers[question.id];
      recordQuestion(question, answer, index, getQuestionTags(question));
    });
  } else {
    const answerEntries = Object.entries(userAnswers);
    answerEntries.forEach(([questionId, answer], index) => {
      const question =
        (answer as any)?.questionSnapshot ||
        (answer as any)?.question ||
        { id: questionId, questionStem: (answer as any)?.questionText };
      const tags =
        (answer as any)?.tags ||
        (answer as any)?.questionSnapshot?.tags ||
        getQuestionTags(question);
      recordQuestion(question, answer, index, tags);
    });

    const totalQuestions = result.totalQuestions || answerEntries.length;
    if (timePerQuestion.length === 0 && totalQuestions > 0) {
      const knownCorrect = result.correctAnswersCount ?? 0;
      const knownIncorrect = Math.max(0, totalQuestions - knownCorrect);
      const statuses: Array<'correct' | 'incorrect' | 'unattempted'> = [
        ...Array(knownCorrect).fill('correct'),
        ...Array(knownIncorrect).fill('incorrect'),
      ];
      const sessionDuration = getSessionDurationSeconds(result);
      const estimatedTime = Math.max(1, Math.round(sessionDuration / totalQuestions));

      for (let index = 0; index < totalQuestions; index++) {
        const status = statuses[index] ?? 'unattempted';
        if (status === 'correct') correctCount++;
        else if (status === 'incorrect') incorrectCount++;
        else unattemptedCount++;

        timePerQuestion.push({
          questionNumber: index + 1,
          time: status === 'unattempted' ? 0 : estimatedTime,
          status,
          stem: `Question ${index + 1}`,
        });
      }
    }
  }

  const hasNoRecordedTimes = timePerQuestion.length > 0 && timePerQuestion.every(item => item.time <= 0);
  if (hasNoRecordedTimes) {
    const sessionDuration = getSessionDurationSeconds(result);
    const attemptedCount = timePerQuestion.filter(item => item.status !== 'unattempted').length;
    const estimatedTime = Math.max(1, Math.round(sessionDuration / Math.max(attemptedCount, 1)));
    for (const item of timePerQuestion) {
      if (item.status !== 'unattempted') {
        item.time = estimatedTime;
      }
    }
    for (const stats of tagStats.values()) {
      if (stats.count === 0 && stats.total > 0) {
        stats.totalTime = estimatedTime * stats.total;
        stats.count = stats.total;
      }
    }
  }

  const tagPerformance = Array.from(tagStats.entries()).map(([tag, stats]) => ({
    tag,
    correct: stats.correct,
    total: stats.total,
    accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
  }));

  const timePerTag = Array.from(tagStats.entries())
    .filter(([, stats]) => stats.count > 0)
    .map(([tag, stats]) => ({
      tag,
      avgTime: Math.round(stats.totalTime / stats.count),
      count: stats.count,
    }));

  return {
    correctCount: result.correctAnswersCount || correctCount,
    incorrectCount,
    unattemptedCount,
    timePerQuestion,
    timePerTag,
    tagPerformance,
  };
}

function buildTopicPerformance(results: RawTestResult[]): TopicPerformance[] {
  const tagStats = new Map<string, { correct: number; total: number; totalTime: number; count: number }>();

  for (const result of results) {
    const questions = result.session.questions || [];
    const userAnswers = result.session.userAnswers || {};

    for (const question of questions) {
      const answer = userAnswers[question.id];
      if (!answer) continue;

      for (const tag of getQuestionTags(question)) {
        const stats = tagStats.get(tag) || { correct: 0, total: 0, totalTime: 0, count: 0 };
        stats.total++;
        if (answer.isCorrect) stats.correct++;
        const timeSpent = answer.timeSpentSeconds ?? answer.time_spent_seconds;
        if (timeSpent !== undefined) {
          stats.totalTime += timeSpent;
          stats.count++;
        }
        tagStats.set(tag, stats);
      }
    }
  }

  return Array.from(tagStats.entries())
    .map(([tag, stats]) => ({
      tag,
      totalQuestions: stats.total,
      correctAnswers: stats.correct,
      accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      averageTime: stats.count > 0 ? Math.round(stats.totalTime / stats.count) : 0,
    }))
    .filter(item => item.totalQuestions > 0)
    .sort((a, b) => b.accuracy - a.accuracy);
}

function buildGroupPerformance(
  results: RawTestResult[],
  groups: { id: string; name: string }[]
): GroupPerformance[] {
  const groupMap = new Map<string, GroupPerformance & { correctAnswers: number; totalQuestions: number; totalTime: number; questionsWithTime: number }>();

  for (const result of results) {
    const groupId = result.session.config?.groupId || 'unknown';
    const groupName = getGroupName(groupId, result.session.config?.groupName, groups);
    let data = groupMap.get(groupId);

    if (!data) {
      data = {
        groupId,
        groupName,
        testsCount: 0,
        averageScore: 0,
        accuracy: 0,
        averageTimePerQuestion: 0,
        chartData: [],
        correctAnswers: 0,
        totalQuestions: 0,
        totalTime: 0,
        questionsWithTime: 0,
      };
    }

    data.testsCount++;
    data.averageScore += result.score;
    data.correctAnswers += result.correctAnswersCount;
    data.totalQuestions += result.totalQuestions;

    const userAnswers = result.session.userAnswers || {};
    Object.values(userAnswers).forEach((answer: any) => {
      const timeSpent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
      if (timeSpent !== undefined) {
        data!.totalTime += timeSpent;
        data!.questionsWithTime++;
      }
    });

    groupMap.set(groupId, data);
  }

  return Array.from(groupMap.values())
    .map(data => {
      const groupResults = results
        .filter(r => (r.session.config?.groupId || 'unknown') === data.groupId)
        .sort((a, b) => toDate(a.session.startTime).getTime() - toDate(b.session.startTime).getTime());

      return {
        groupId: data.groupId,
        groupName: data.groupName,
        testsCount: data.testsCount,
        averageScore: data.testsCount > 0 ? Math.round(data.averageScore / data.testsCount) : 0,
        accuracy: data.totalQuestions > 0 ? Math.round((data.correctAnswers / data.totalQuestions) * 100) : 0,
        averageTimePerQuestion: data.questionsWithTime > 0 ? Math.round(data.totalTime / data.questionsWithTime) : 0,
        chartData: groupResults.map(result => ({
          date: toDate(result.session.startTime).toISOString(),
          score: Math.round(result.score),
        })),
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

function buildRecentTests(
  results: RawTestResult[],
  groups: { id: string; name: string }[]
): RecentTest[] {
  return [...results]
    .sort((a, b) => toDate(b.session.startTime).getTime() - toDate(a.session.startTime).getTime())
    .slice(0, 5)
    .map(result => {
      const start = toDate(result.session.startTime);
      const end = result.session.endTime ? toDate(result.session.endTime) : start;
      const userAnswers = result.session.userAnswers || {};
      const timeSpent = Object.values(userAnswers).reduce((sum: number, answer: any) => {
        return sum + (answer?.timeSpentSeconds ?? answer?.time_spent_seconds ?? 0);
      }, 0);

      return {
        id: result.session.id || result.id || `${start.getTime()}`,
        groupName: getGroupName(
          result.session.config?.groupId,
          result.session.config?.groupName || result.session.config?.name,
          groups
        ),
        score: result.correctAnswersCount,
        totalQuestions: result.totalQuestions,
        percentage: Math.round(result.score),
        completedAt: (result.session.endTime || result.session.startTime || new Date()).toString(),
        timeSpent: timeSpent || Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
        analysis: buildTestAnalysis(result),
      };
    });
}

function buildTroublesomeQuestions(
  results: RawTestResult[],
  userQuestionStats: Record<string, UserQuestionStatEntry>,
  groups: { id: string; name: string }[]
): TroublesomeQuestion[] {
  const questionMap = new Map<string, { stem: string; groupName: string }>();

  for (const result of results) {
    const groupName = getGroupName(
      result.session.config?.groupId,
      result.session.config?.groupName,
      groups
    );
    for (const question of result.session.questions || []) {
      const stem = getQuestionStem(question);
      if (stem && !questionMap.has(question.id)) {
        questionMap.set(question.id, { stem, groupName });
      }
    }
  }

  return Object.entries(userQuestionStats)
    .filter(([, stats]) => stats.incorrectAttempts > 0)
    .map(([questionId, stats]) => {
      const meta = questionMap.get(questionId);
      return {
        id: questionId,
        stem: meta?.stem || 'Question not found.',
        incorrectAttempts: stats.incorrectAttempts,
        totalAttempts: stats.correctAttempts + stats.incorrectAttempts,
        groupName: meta?.groupName || 'Unknown Group',
      };
    })
    .sort((a, b) => b.incorrectAttempts - a.incorrectAttempts)
    .slice(0, 5);
}

function buildWeeklyActivity(
  allResults: RawTestResult[],
  userQuestionStats: Record<string, UserQuestionStatEntry>
): { day: string; count: number }[] {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = new Map<string, number>();

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    counts.set(formatLocalDate(date), 0);
  }

  allResults.forEach(result => {
    const dateStr = formatLocalDate(toDate(result.session.startTime));
    if (counts.has(dateStr)) {
      counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
    }
  });

  Object.values(userQuestionStats).forEach(stat => {
    if (!stat.lastAttempted) return;
    const dateStr = formatLocalDate(new Date(stat.lastAttempted));
    if (counts.has(dateStr)) {
      counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
    }
  });

  return Array.from(counts.entries()).map(([dateStr, count]) => {
    const date = new Date(`${dateStr}T12:00:00`);
    return { day: dayLabels[date.getDay()], count };
  });
}

function countReviewedCards(flashcards: Record<string, any[]> | any[]): number {
  const cards = Array.isArray(flashcards)
    ? flashcards
    : Object.values(flashcards).flat();

  return cards.filter(card => {
    const repetitions = card?.srs_data?.repetitions ?? card?.srsData?.repetitions ?? 0;
    return repetitions > 0;
  }).length;
}

export function normalizeUserQuestionStats(raw: unknown): Record<string, UserQuestionStatEntry> {
  const stats: Record<string, UserQuestionStatEntry> = {};
  const rows = Array.isArray(raw) ? raw : [];

  rows.forEach((row: any) => {
    const id = row.question_id || row.questionId;
    if (!id) return;
    stats[id] = {
      correctAttempts: row.correct_attempts ?? row.correctAttempts ?? row.correct_count ?? 0,
      incorrectAttempts: row.incorrect_attempts ?? row.incorrectAttempts ?? row.incorrect_count ?? 0,
      lastAttempted: row.last_attempted || row.lastAttempted || row.last_reviewed_at || null,
    };
  });

  return stats;
}

export function normalizeTestResults(raw: unknown): RawTestResult[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(item => item && (item.session || item.start_time || item.startTime))
    .map((item: any) => {
      const session = item.session || item;
      const config = session.config || {};
      const startTime = session.startTime || session.start_time;
      const endTime = session.endTime || session.end_time;

      return {
        id: item.id || session.id,
        session: {
          id: session.id || item.id,
          config,
          questions: session.questions || [],
          userAnswers: session.userAnswers || session.user_answers || {},
          startTime,
          endTime,
        },
        score: item.score ?? 0,
        totalQuestions: item.totalQuestions ?? item.total_questions ?? session.questions?.length ?? 0,
        correctAnswersCount:
          item.correctAnswersCount ??
          item.correct_answers_count ??
          0,
      };
    })
    .filter(result => result.session.startTime);
}

export function buildDashboardStats(params: {
  testResults: RawTestResult[];
  period: TimePeriod;
  groups: { id: string; name: string }[];
  userQuestionStats: Record<string, UserQuestionStatEntry>;
  flashcards?: Record<string, any[]> | any[];
  totalPoints: number;
  badges: Badge[];
  currentStreak: number;
  longestStreak: number;
  cardsReviewed?: number;
}): DashboardStats {
  const allResults = dedupeResults(params.testResults);
  const filteredResults = filterResultsByPeriod(allResults, params.period);

  let totalTimeSeconds = 0;
  let questionsWithTime = 0;
  let totalCorrect = 0;
  let totalAnswered = 0;

  filteredResults.forEach(result => {
    totalCorrect += result.correctAnswersCount;
    totalAnswered += result.totalQuestions;
    Object.values(result.session.userAnswers || {}).forEach((answer: any) => {
      const timeSpent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
      if (timeSpent !== undefined) {
        totalTimeSeconds += timeSpent;
        questionsWithTime++;
      }
    });
  });

  const topicPerformance = buildTopicPerformance(filteredResults);
  const groupPerformance = buildGroupPerformance(filteredResults, params.groups);
  const recentTests = buildRecentTests(filteredResults, params.groups);
  const troublesomeQuestions = buildTroublesomeQuestions(
    allResults,
    params.userQuestionStats,
    params.groups
  );
  const weeklyActivity = buildWeeklyActivity(allResults, params.userQuestionStats);

  return {
    totalPoints: params.totalPoints,
    userLevel: calculateUserLevel(params.totalPoints),
    currentStreak: params.currentStreak,
    longestStreak: params.longestStreak,
    totalTestsTaken: filteredResults.length,
    averageTimePerQuestion: questionsWithTime > 0 ? Math.round(totalTimeSeconds / questionsWithTime) : 0,
    totalStudyTime: Math.round(totalTimeSeconds / 60),
    cardsReviewed: params.cardsReviewed ?? countReviewedCards(params.flashcards || []),
    overallAccuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
    topicPerformance,
    groupPerformance,
    badges: params.badges,
    recentTests,
    troublesomeQuestions,
    weeklyActivity,
    activityDays: [],
  };
}
