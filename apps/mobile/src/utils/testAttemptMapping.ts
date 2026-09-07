/**
 * One raw history row → what History and the results screen say about it.
 *
 * The bug this file exists for (build 164): a PRACTICE sitting reopened from
 * History rendered "NOT PASSED · 0% Score" in red, and its row read
 * "0% ✗ Not passed 0/0 pts" with no Practice chip — for a session the student
 * had just answered correctly.
 *
 * Three separate causes, all of them in the mapping:
 *
 * 1. `config.mode` was never written for a session completed through the DRAFT
 *    path (the ordinary one): the draft's own config omitted it and the
 *    complete request replaced config with `{ groupId, groupName }`. With no
 *    mode, a practice sitting is indistinguishable from a test — so it got the
 *    test treatment, pass mark included.
 * 2. `session_kind` DID say 'study' the whole time, on the row, in every list
 *    response. Nothing read it. It is the server's own record of how the
 *    session was taken and is trusted here as a second source for the mode.
 * 3. A study session never writes a `test_results` row (completeTestDraft
 *    returns before createTestResult), so `score`, `correctAnswersCount` and
 *    `totalQuestions` all come back 0 — hence "0% · 0/0 pts". The tally is
 *    therefore recomputed from the answers, and read from the tally the client
 *    persists into config on complete when the lean list omits the answers.
 *
 * And the rule that follows from T2: a practice sitting has no pass mark, so
 * `passed` is not merely false — it is ABSENT. Nothing may print PASSED or NOT
 * PASSED for a sitting that was never an exam.
 *
 * Pure and import-free, so mobile jest (node env, no store/service imports)
 * can hold all of it.
 */

/** How the sitting was taken. `undefined` = the row never said. */
export type AttemptMode = 'test' | 'study';

export interface AttemptMappingPlan {
  /** 'study' for a practice sitting; omitted when the row states nothing. */
  mode?: AttemptMode;
  /** 0–100, whole numbers. Derived when the server has no score row. */
  percentage: number;
  /** Questions answered correctly. */
  correctCount: number;
  /** Questions in the sitting. */
  totalQuestions: number;
  /**
   * Present ONLY for a sitting with a pass mark. A practice row never carries
   * this key, so `attempt.passed` stays undefined and every surface that reads
   * it stays neutral.
   */
  passed?: boolean;
  /** questionId → what the student said before the answer was revealed. */
  confidenceByQuestion: Record<string, 'sure' | 'unsure'>;
}

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {};
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The first of `keys` that holds a finite number, or null. */
function pickNum(source: Dict, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = num(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function confidenceOf(answer: unknown): 'sure' | 'unsure' | null {
  const value = dict(answer).confidence;
  return value === 'sure' || value === 'unsure' ? value : null;
}

/**
 * The mode this row was taken in.
 *
 * `config.mode` is the client's own record and wins. `session_kind` is the
 * server's, and only its 'study' value is evidence: every row is written
 * 'test' by default, including every row saved before modes existed, so
 * reading 'test' back as a stated mode would claim a fact the row never had.
 */
export function attemptModeOf(row: unknown): AttemptMode | undefined {
  const raw = dict(row);
  const session = dict(raw.session ?? raw);
  const config = dict(session.config ?? raw.config);
  if (config.mode === 'study') return 'study';
  if (config.mode === 'test') return 'test';
  const kind = session.sessionKind ?? session.session_kind ?? raw.sessionKind ?? raw.session_kind;
  if (kind === 'study') return 'study';
  return undefined;
}

/**
 * Everything the History row and the results screen need from one raw row.
 *
 * @param row A row exactly as `GET /tests?status=completed` returns it —
 *   the flat mirror, the nested `session`, lean or full. Nothing is assumed
 *   present: a lean row carries no questions and no answers at all.
 */
export function planAttemptFromSessionRow(row: unknown): AttemptMappingPlan {
  const raw = dict(row);
  const session = dict(raw.session ?? raw);
  const config = dict(session.config ?? raw.config);
  const answers = dict(session.userAnswers ?? session.user_answers ?? raw.userAnswers);
  const questions = Array.isArray(session.questions)
    ? session.questions
    : Array.isArray(raw.questions)
      ? (raw.questions as unknown[])
      : [];

  const mode = attemptModeOf(row);
  const isPractice = mode === 'study';

  const answerEntries = Object.entries(answers);
  const correctFromAnswers = answerEntries.filter(
    ([, answer]) => dict(answer).isCorrect === true,
  ).length;

  // Server first, then the tally the client persists into config for a
  // practice sitting (no test_results row exists for one), then the answers
  // themselves. Zero from the server is treated as "nothing recorded" only
  // when a better source exists — a genuine 0/10 still reads 0.
  const serverTotal = pickNum(raw, 'totalQuestions', 'total_questions');
  const configTotal = pickNum(config, 'practiceTotalQuestions', 'numberOfQuestions');
  const totalQuestions =
    (serverTotal && serverTotal > 0 ? serverTotal : null) ??
    (questions.length || null) ??
    (answerEntries.length || null) ??
    (configTotal && configTotal > 0 ? configTotal : null) ??
    0;

  const serverCorrect = pickNum(raw, 'correctAnswersCount', 'correct_answers_count');
  const configCorrect = pickNum(config, 'practiceCorrectCount');
  const correctCount =
    (serverCorrect && serverCorrect > 0 ? serverCorrect : null) ??
    (correctFromAnswers || null) ??
    (configCorrect !== null && configCorrect >= 0 ? configCorrect : null) ??
    0;

  const serverScore = pickNum(raw, 'score');
  const configScore = pickNum(config, 'practiceScore');
  const derived = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const percentage =
    serverScore !== null && serverScore > 0
      ? Math.round(serverScore)
      : configScore !== null && configScore > 0
        ? Math.round(configScore)
        : derived;

  const confidenceByQuestion: Record<string, 'sure' | 'unsure'> = {};
  for (const [questionId, answer] of answerEntries) {
    const confidence = confidenceOf(answer);
    if (confidence) confidenceByQuestion[questionId] = confidence;
  }

  const passingScore = pickNum(config, 'passingScore');

  return {
    ...(mode ? { mode } : {}),
    percentage,
    correctCount,
    totalQuestions,
    // T2: practice has no pass mark, so it records none — not `false`.
    ...(isPractice ? {} : { passed: percentage >= (passingScore ?? 70) }),
    confidenceByQuestion,
  };
}
