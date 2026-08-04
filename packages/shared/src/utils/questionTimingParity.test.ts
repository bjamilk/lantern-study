import {
  buildDashboardStats,
  normalizeTestResults,
  resolveQuestionTime,
  type RawTestResult,
} from './buildDashboardStats';

/**
 * The dashboard's "Avg / question" tile rendered a dash on web, iOS and Android.
 *
 * The cause was not a client bug: `getUserTests` omits `user_answers` from lean
 * completed-history responses to keep all-time pagination light, and the stats
 * builder derived question timing purely from those per-answer records. With no
 * answers the divisor was 0, so the average — and total study time with it — was
 * always 0.
 *
 * The server now folds the answers into `timeSpentSeconds` + `questionsWithTime`
 * before dropping them. These tests pin the contract between the two shapes: a
 * lean result and a full result describing the same test must produce identical
 * numbers.
 */

// buildDashboardStats dedupes results by start-time millisecond, so every
// fixture needs its own timestamp or they silently collapse into one result.
let fixtureSeq = 0;

const baseResult = (overrides: Partial<RawTestResult> = {}): RawTestResult => {
  const id = overrides.id ?? 't1';
  return {
    id,
    session: {
      id,
      config: {},
      questions: [],
      userAnswers: {},
      startTime: new Date(Date.UTC(2026, 0, 1, 0, 0, fixtureSeq++)).toISOString(),
    },
    score: 80,
    totalQuestions: 2,
    correctAnswersCount: 2,
    ...overrides,
  };
};

describe('resolveQuestionTime — lean/full payload parity', () => {
  it('sums per-answer timings when the full payload is present', () => {
    const result = baseResult({
      session: {
        ...baseResult().session,
        userAnswers: {
          q1: { timeSpentSeconds: 30 },
          q2: { timeSpentSeconds: 50 },
        },
      },
    });
    expect(resolveQuestionTime(result)).toEqual({ seconds: 80, questions: 2 });
  });

  it('falls back to the server aggregate when answers were stripped', () => {
    const lean = baseResult({ timeSpentSeconds: 80, questionsWithTime: 2 });
    expect(resolveQuestionTime(lean)).toEqual({ seconds: 80, questions: 2 });
  });

  it('produces the same numbers for lean and full views of one test', () => {
    const full = baseResult({
      session: {
        ...baseResult().session,
        userAnswers: { q1: { timeSpentSeconds: 12 }, q2: { time_spent_seconds: 18 } },
      },
    });
    const lean = baseResult({ timeSpentSeconds: 30, questionsWithTime: 2 });
    expect(resolveQuestionTime(lean)).toEqual(resolveQuestionTime(full));
  });

  it('prefers per-answer data so a full payload is never double counted', () => {
    const both = baseResult({
      session: {
        ...baseResult().session,
        userAnswers: { q1: { timeSpentSeconds: 10 } },
      },
      timeSpentSeconds: 999,
      questionsWithTime: 99,
    });
    expect(resolveQuestionTime(both)).toEqual({ seconds: 10, questions: 1 });
  });

  it('excludes answers with no recorded time from both the sum and the count', () => {
    const result = baseResult({
      session: {
        ...baseResult().session,
        userAnswers: {
          q1: { timeSpentSeconds: 40 },
          q2: {},
          q3: { timeSpentSeconds: null },
          q4: { timeSpentSeconds: 'twelve' },
        },
      },
    });
    // Only q1 has a usable time; the average must be 40s, not 10s.
    expect(resolveQuestionTime(result)).toEqual({ seconds: 40, questions: 1 });
  });

  it('reports nothing when neither shape carries timing', () => {
    expect(resolveQuestionTime(baseResult())).toEqual({ seconds: 0, questions: 0 });
    expect(resolveQuestionTime(baseResult({ questionsWithTime: 0, timeSpentSeconds: 0 }))).toEqual({
      seconds: 0,
      questions: 0,
    });
  });
});

describe('normalizeTestResults — carrying the aggregate through', () => {
  it('keeps the server aggregate in both camelCase and snake_case', () => {
    const [camel] = normalizeTestResults([
      { id: 'a', session: { id: 'a', startTime: '2026-01-01T00:00:00Z' }, timeSpentSeconds: 60, questionsWithTime: 3 },
    ]);
    expect(resolveQuestionTime(camel)).toEqual({ seconds: 60, questions: 3 });

    const [snake] = normalizeTestResults([
      { id: 'b', session: { id: 'b', start_time: '2026-01-01T00:00:00Z' }, time_spent_seconds: 60, questions_with_time: 3 },
    ]);
    expect(resolveQuestionTime(snake)).toEqual({ seconds: 60, questions: 3 });
  });
});

describe('buildDashboardStats — the tile the user sees', () => {
  const build = (testResults: RawTestResult[]) =>
    buildDashboardStats({
      testResults,
      period: 'all',
      groups: [],
      userQuestionStats: {},
      flashcards: {},
      totalPoints: 0,
      badges: [],
      currentStreak: 0,
      longestStreak: 0,
    });

  it('reports an average from lean results, which previously rendered a dash', () => {
    const stats = build([
      baseResult({ id: 't1', timeSpentSeconds: 120, questionsWithTime: 4 }),
      baseResult({ id: 't2', timeSpentSeconds: 60, questionsWithTime: 2 }),
    ]);
    // 180s over 6 questions.
    expect(stats.averageTimePerQuestion).toBe(30);
    expect(stats.totalStudyTime).toBe(3);
  });

  it('weights the average by question count across tests, not by test', () => {
    const stats = build([
      baseResult({ id: 't1', timeSpentSeconds: 100, questionsWithTime: 10 }), // 10s each
      baseResult({ id: 't2', timeSpentSeconds: 90, questionsWithTime: 1 }), // 90s
    ]);
    // 190s / 11 questions = 17s, not the 50s a per-test mean would give.
    expect(stats.averageTimePerQuestion).toBe(17);
  });

  it('still reports 0 when no test carries timing, so the tile can show a dash', () => {
    expect(build([baseResult()]).averageTimePerQuestion).toBe(0);
    expect(build([]).averageTimePerQuestion).toBe(0);
  });

  it('gives the same stats whether the history arrived lean or full', () => {
    const full = build([
      baseResult({
        session: {
          ...baseResult().session,
          userAnswers: { q1: { timeSpentSeconds: 20 }, q2: { timeSpentSeconds: 40 } },
        },
      }),
    ]);
    const lean = build([baseResult({ timeSpentSeconds: 60, questionsWithTime: 2 })]);
    expect(lean.averageTimePerQuestion).toBe(full.averageTimePerQuestion);
    expect(lean.totalStudyTime).toBe(full.totalStudyTime);
  });
});
