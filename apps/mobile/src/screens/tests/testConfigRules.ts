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
