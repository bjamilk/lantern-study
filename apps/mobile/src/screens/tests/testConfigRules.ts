/**
 * The rules that decide whether a test/study configuration can be started,
 * and how long the session runs.
 *
 * Pure on purpose, and importing only other pure rules: mobile jest runs on
 * the `node` environment with `testMatch: ['**\/*.test.ts']` and cannot
 * transform a native module, so the modal keeps no judgement of its own — it
 * renders what these return.
 * Living beside the tests screens (rather than next to the modal in
 * components/) is what makes them reachable from a unit test at all.
 */

export interface TestConfigValidity {
  /** Questions actually available after the current filters. */
  effectiveMaxQuestions: number;
  /** How many the reader asked for. */
  numberOfQuestions: number;
  /** Study sessions have no timer and no question-type requirement. */
  isStudyMode: boolean;
  useSpacedRepetition: boolean;
  focusOnNew: boolean;
  /** How many question types are ticked. */
  selectedQuestionTypeCount: number;
}

/**
 * Why the configuration cannot be started, or `null` when it can.
 *
 * One function, so the disabled Start button and the sentence under it can
 * never disagree — the button used to be disabled by a condition the hint did
 * not mention, and vice versa.
 *
 * NOTE: there is deliberately NO timer condition. Timer "None" is a real
 * choice — an untimed test — and refusing to start on it is what left Start
 * Test inert with "Set a timer for the test." showing under it. Downstream
 * already reads a time limit of 0 as "No limit": the countdown is skipped and
 * the header clock is not drawn.
 */
export function testConfigValidationHint(input: TestConfigValidity): string | null {
  const { effectiveMaxQuestions, numberOfQuestions, isStudyMode } = input;
  const { useSpacedRepetition, focusOnNew, selectedQuestionTypeCount } = input;

  if (!Number.isFinite(effectiveMaxQuestions) || effectiveMaxQuestions <= 0) {
    return 'No testable questions match your filters.';
  }
  if (!Number.isFinite(numberOfQuestions) || numberOfQuestions <= 0) {
    return 'Choose at least one question.';
  }
  if (numberOfQuestions > effectiveMaxQuestions) {
    return effectiveMaxQuestions === 1
      ? 'Only 1 question matches your filters.'
      : `Only ${effectiveMaxQuestions} questions match your filters.`;
  }
  // Spaced repetition and Focus on New pick the types themselves.
  if (!isStudyMode && !useSpacedRepetition && !focusOnNew && selectedQuestionTypeCount === 0) {
    return 'Select at least one question type.';
  }
  return null;
}

/** Whether Start Test / Start Studying may be pressed. */
export function isTestConfigValid(input: TestConfigValidity): boolean {
  return testConfigValidationHint(input) === null;
}

/**
 * The timer rule no longer lives here.
 *
 * It was one of THREE copies of "how long does this session run" — this one,
 * `utils/resolveAttemptTimeLimitMinutes` (used by the store), and a third
 * written inline in GroupChatScreen. Fixing the config sheet therefore fixed
 * exactly one of the three paths, and a "None" test started from a group chat
 * still came up with a 10:00 countdown. There is now one rule, in
 * `utils/resolveAttemptTimeLimitMinutes.ts`; this is the name the tests
 * screens already import it by.
 */
export {
  resolveSessionTimeLimitMinutes as resolveTestTimeLimitMinutes,
  type TestTimeLimitInput,
} from '../../utils/resolveAttemptTimeLimitMinutes';

/**
 * The minutes a test STARTS with before anyone touches a timer chip — the one
 * answer the mode sheet prints, the config sheet opens on, and the launch
 * uses.
 *
 * There were two answers on build 162 (finding T4). The mode sheet printed
 * `test.timeLimit`, which is `resolveAttemptTimeLimitMinutes(row.config)` and
 * therefore 0 for every test saved without a timer key — "∞ / No Limit". The
 * config sheet for the SAME test opened on its own auto rule (one minute per
 * question) and said "5 min". Whichever the student read, the other was
 * lying, and the sheet's own Start honoured neither: it launched with 0 and
 * TestTaking drew no countdown.
 *
 * The rule, in one place:
 *   - a test that RECORDED a timer choice keeps it, 0 ("No limit") included.
 *     An explicit "no limit" is an answer, never a missing value to fill in.
 *   - a test that recorded none gets one minute per question, which is what
 *     the config sheet has always defaulted to. At least one minute, so a
 *     one-question test is not born untimed by rounding.
 */
export function resolveDefaultSessionMinutes(input: {
  /** Did the stored config express a timer at all? (`hasStoredTimerChoice`) */
  timerChosen: boolean;
  /** The minutes that choice resolved to. Only read when `timerChosen`. */
  storedMinutes: number;
  /** Questions in the test, for the fallback. */
  questionCount: number;
}): number {
  const { timerChosen, storedMinutes, questionCount } = input;
  if (timerChosen && Number.isFinite(storedMinutes)) {
    return Math.max(0, Math.round(storedMinutes));
  }
  if (!Number.isFinite(questionCount) || questionCount <= 0) return 1;
  return Math.max(1, Math.round(questionCount));
}

/* ------------------------------------------------------------------ *
 * Remembering a timer
 * ------------------------------------------------------------------ */

/**
 * Which way the sheet closed. It does NOT change the answer — see below.
 */
export type TimerChoiceExit = 'start' | 'cancel' | 'dismiss';

/**
 * The timer the config sheet is closing with, in MINUTES, as a recorded
 * choice — or null when there is nothing to record.
 *
 * The sheet's chips are seconds and its Start already converts them; this is
 * the same conversion for all THREE exits — Start, Cancel and ×. Build 163
 * kept none of them: a reader set "No limit", pressed ×, reopened the sheet
 * and found 5 min waiting again, because nothing outside the launch ever saw
 * the choice. Build 164 kept × and dropped Cancel, which is worse: the same
 * two presses on the same sheet meant different things, and neither is
 * signposted.
 *
 * So `exit` is accepted and deliberately ignored. A TIMER IS A SETTING, NOT A
 * FORM FIELD: "5 min" is an answer about this test, and backing out of the
 * sheet is not a retraction of it. Taking the parameter — rather than leaving
 * the exits unmentioned — is what lets a test assert that all three agree.
 * Study mode has no Timer section at all, so it never records one; writing 0
 * there would silently retimetable the test itself.
 */
export function planTimerChoicePersist(input: {
  timerDurationSeconds: number;
  sessionMode: 'test' | 'study';
  /** Every exit keeps a choice the reader actually made. */
  exit?: TimerChoiceExit;
  /**
   * Whether the reader touched the timer control. Cancel/× on an untouched
   * sheet must NOT turn the seeded default into a recorded choice (opening
   * and closing the sheet on a 30-question test recorded 10 min as its timer
   * — build 164 review residual). Start always records what it launches with.
   */
  touched?: boolean;
}): number | null {
  if (input.sessionMode !== 'test') return null;
  if (input.exit && input.exit !== 'start' && input.touched === false) return null;
  const seconds = input.timerDurationSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

/** A test row carrying whatever timer it was listed with. */
export interface TimerChoiceRow {
  id: string;
  timeLimit: number;
  timerChosen?: boolean;
}

/**
 * Put the choices this device recorded back onto a freshly fetched list.
 *
 * `GET /tests` answers with the row's STORED config, which has no timer key
 * for any test the server never had one written for — so a fetch would undo
 * the choice a reader had just made in the config sheet, and the "No limit"
 * they picked would come back as a minute per question. The local record is
 * the more recent answer and wins; it is dropped only when the test is.
 */
export function applyTimerChoices<T extends TimerChoiceRow>(
  tests: readonly T[],
  choices: Readonly<Record<string, number>>
): T[] {
  return tests.map(test => {
    const minutes = choices[test.id];
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return test;
    return { ...test, timeLimit: Math.max(0, Math.round(minutes)), timerChosen: true };
  });
}

/** Forget choices for tests that are no longer listed, so the map cannot grow forever. */
export function pruneTimerChoices(
  choices: Readonly<Record<string, number>>,
  liveTestIds: readonly string[]
): Record<string, number> {
  const live = new Set(liveTestIds);
  const next: Record<string, number> = {};
  for (const [id, minutes] of Object.entries(choices)) {
    if (live.has(id)) next[id] = minutes;
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * What the mode cards promise
 * ------------------------------------------------------------------ */

/**
 * The line under "Test Mode" in the start sheet.
 *
 * It was the constant "Timed • Scored", printed beside a stats strip that
 * said "∞ / No limit" for the very same test (device finding, build 172): the
 * card promised a clock the session would never draw. The timer is a property
 * of THIS test, so the card reads it from the same minutes the strip and the
 * launch use — `resolveDefaultSessionMinutes`.
 */
export function describeTestModeCard(minutes: number): string {
  const timing = Number.isFinite(minutes) && minutes > 0 ? `${Math.round(minutes)} min` : 'Untimed';
  return `${timing} • Scored\nNo hints`;
}

/** The line under "Study Mode". A practice sitting has no timer, ever. */
export function describeStudyModeCard(): string {
  return 'Untimed • Feedback\nLearn as you go';
}
