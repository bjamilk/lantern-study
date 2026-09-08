import {
  attemptModeOf,
  formatSessionDuration,
  planAttemptDurationSeconds,
  planAttemptFromSessionRow,
} from './testAttemptMapping';

/** A lean completed row, as `GET /tests?status=completed&lean=1` returns one. */
const leanRow = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'session-1',
  config,
  session_kind: 'study',
  sessionKind: 'study',
  session: { id: 'session-1', config, questions: [], userAnswers: {}, sessionKind: 'study' },
  score: 0,
  totalQuestions: 0,
  correctAnswersCount: 0,
  ...extra,
});

/** A full row: questions and answers present, no test_results row (practice). */
const fullPracticeRow = () => ({
  id: 'session-2',
  session_kind: 'study',
  session: {
    id: 'session-2',
    config: { name: 'SDOH', mode: 'study', passingScore: 70 },
    questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
    userAnswers: {
      q1: { isCorrect: true, confidence: 'sure' },
      q2: { isCorrect: true, confidence: 'unsure' },
      q3: { isCorrect: false, confidence: 'sure' },
      q4: { isCorrect: false },
    },
    sessionKind: 'study',
  },
  score: 0,
  totalQuestions: 0,
  correctAnswersCount: 0,
});

describe('the mode a row was taken in', () => {
  it('reads config.mode when the client wrote one', () => {
    expect(attemptModeOf(leanRow({ mode: 'study' }))).toBe('study');
    expect(attemptModeOf({ config: { mode: 'test' }, session_kind: 'test' })).toBe('test');
  });

  it('falls back on the server’s own session_kind for practice', () => {
    // The draft path never wrote config.mode, and every one of those rows is
    // the reason this fallback exists: session_kind said 'study' all along.
    expect(attemptModeOf(leanRow({ name: 'SDOH' }))).toBe('study');
    expect(attemptModeOf({ session: { sessionKind: 'study' } })).toBe('study');
  });

  it('never reads a DEFAULT session_kind of test as a stated mode', () => {
    // Every row is written 'test' unless told otherwise, legacy ones included.
    // "Unstated" must stay unstated, or old rows start claiming a mode.
    expect(attemptModeOf({ config: {}, session_kind: 'test' })).toBeUndefined();
    expect(attemptModeOf({})).toBeUndefined();
    expect(attemptModeOf(undefined)).toBeUndefined();
  });
});

describe('a practice sitting', () => {
  it('scores itself from the answers when the server has no score row', () => {
    // A study session never reaches createTestResult, so score /
    // correctAnswersCount / totalQuestions are all 0 on the wire. Reading
    // those literally is what printed "0% · 0/0 pts" for a sitting the
    // student had just answered.
    const plan = planAttemptFromSessionRow(fullPracticeRow());
    expect(plan.mode).toBe('study');
    expect(plan.correctCount).toBe(2);
    expect(plan.totalQuestions).toBe(4);
    expect(plan.percentage).toBe(50);
  });

  it('reads the tally the client persisted when the lean row has no answers', () => {
    const plan = planAttemptFromSessionRow(
      leanRow({
        mode: 'study',
        numberOfQuestions: 4,
        practiceScore: 75,
        practiceCorrectCount: 3,
        practiceTotalQuestions: 4,
      }),
    );
    expect(plan.percentage).toBe(75);
    expect(plan.correctCount).toBe(3);
    expect(plan.totalQuestions).toBe(4);
  });

  it('records no pass mark at all — not a failed one', () => {
    const plan = planAttemptFromSessionRow(fullPracticeRow());
    expect(Object.prototype.hasOwnProperty.call(plan, 'passed')).toBe(false);
    expect(plan.passed).toBeUndefined();
  });

  it('keeps no pass mark even when the sitting scored zero', () => {
    // The red NOT PASSED came from exactly this row.
    const plan = planAttemptFromSessionRow(leanRow({ mode: 'study', numberOfQuestions: 5 }));
    expect(plan.mode).toBe('study');
    expect(plan.passed).toBeUndefined();
    expect(plan.percentage).toBe(0);
  });

  it('carries every confidence pair back out', () => {
    const plan = planAttemptFromSessionRow(fullPracticeRow());
    expect(plan.confidenceByQuestion).toEqual({ q1: 'sure', q2: 'unsure', q3: 'sure' });
  });
});

describe('a test sitting', () => {
  const testRow = (score: number, config: Record<string, unknown> = {}) => ({
    id: 's',
    session_kind: 'test',
    session: { config: { mode: 'test', passingScore: 70, ...config }, questions: [], userAnswers: {} },
    score,
    totalQuestions: 10,
    correctAnswersCount: Math.round((score / 100) * 10),
  });

  it('trusts the server’s score row', () => {
    const plan = planAttemptFromSessionRow(testRow(80));
    expect(plan.percentage).toBe(80);
    expect(plan.totalQuestions).toBe(10);
    expect(plan.correctCount).toBe(8);
  });

  it('passes or fails against the row’s own pass mark', () => {
    expect(planAttemptFromSessionRow(testRow(80)).passed).toBe(true);
    expect(planAttemptFromSessionRow(testRow(60)).passed).toBe(false);
    expect(planAttemptFromSessionRow(testRow(60, { passingScore: 50 })).passed).toBe(true);
  });

  it('defaults the pass mark to 70 when the row states none', () => {
    const row = { session: { config: {}, questions: [], userAnswers: {} }, score: 70, totalQuestions: 10, correctAnswersCount: 7 };
    expect(planAttemptFromSessionRow(row).passed).toBe(true);
  });

  it('still reports an honest zero rather than inventing one', () => {
    const row = {
      session: { config: { mode: 'test' }, questions: [{ id: 'q1' }, { id: 'q2' }], userAnswers: { q1: { isCorrect: false }, q2: { isCorrect: false } } },
      score: 0,
      totalQuestions: 0,
      correctAnswersCount: 0,
    };
    const plan = planAttemptFromSessionRow(row);
    expect(plan.percentage).toBe(0);
    expect(plan.correctCount).toBe(0);
    expect(plan.totalQuestions).toBe(2);
    expect(plan.passed).toBe(false);
  });
});

describe('rows that are missing pieces', () => {
  it('survives an empty row', () => {
    expect(planAttemptFromSessionRow({})).toEqual({
      percentage: 0,
      correctCount: 0,
      totalQuestions: 0,
      passed: false,
      confidenceByQuestion: {},
    });
  });

  it('survives a row that is not an object', () => {
    expect(planAttemptFromSessionRow(undefined).percentage).toBe(0);
    expect(planAttemptFromSessionRow(null).confidenceByQuestion).toEqual({});
  });

  it('ignores a confidence value it does not recognise', () => {
    const plan = planAttemptFromSessionRow({
      session: { config: { mode: 'study' }, questions: [{ id: 'q1' }], userAnswers: { q1: { isCorrect: true, confidence: 'maybe' } } },
    });
    expect(plan.confidenceByQuestion).toEqual({});
    expect(plan.percentage).toBe(100);
  });
});

describe('planAttemptDurationSeconds: History stopped saying 0:00', () => {
  it('sums the per-answer timings when the row carries answers', () => {
    const row = {
      session: {
        userAnswers: {
          q1: { timeSpentSeconds: 5 },
          q2: { time_spent_seconds: 7 },
        },
      },
    };
    expect(planAttemptDurationSeconds(row)).toBe(12);
  });

  it('reads the server total on a LEAN row, which has no answers at all', () => {
    // The defect: this row is what History lists, and it summed to 0.
    const leanRow = {
      id: 's1',
      timeSpentSeconds: 12,
      questionsWithTime: 8,
      session: { userAnswers: {} },
    };
    expect(planAttemptDurationSeconds(leanRow)).toBe(12);
  });

  it('falls back to the session stamps when neither is recorded', () => {
    const row = {
      session: {
        startTime: '2026-09-07T10:00:00.000Z',
        endTime: '2026-09-07T10:03:30.000Z',
        userAnswers: {},
      },
    };
    expect(planAttemptDurationSeconds(row)).toBe(210);
  });

  it('returns null — not 0 — when the row records no time', () => {
    expect(planAttemptDurationSeconds({ session: { userAnswers: {} } })).toBeNull();
  });
});

describe('formatSessionDuration: sub-minute sittings are reported honestly', () => {
  it('keeps seconds under a minute', () => {
    // 12s used to print "0m" on the analysis screen.
    expect(formatSessionDuration(12)).toBe('12s');
    expect(formatSessionDuration(59)).toBe('59s');
  });

  it('carries the seconds alongside the minutes', () => {
    expect(formatSessionDuration(60)).toBe('1m');
    expect(formatSessionDuration(119)).toBe('1m 59s');
    expect(formatSessionDuration(605)).toBe('10m 5s');
  });

  it('rolls up to hours', () => {
    expect(formatSessionDuration(3600)).toBe('1h');
    expect(formatSessionDuration(5400)).toBe('1h 30m');
  });

  it('says nothing rather than zero for an unknown duration', () => {
    expect(formatSessionDuration(null)).toBe('—');
    expect(formatSessionDuration(undefined)).toBe('—');
  });
});
