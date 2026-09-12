/**
 * The "New test" plan — the three sources a test can be built from, and the
 * handful of settings that shape it.
 *
 * Pure, so the summary line the student reads above the footer and the rules
 * that decide whether Start is live are the same code, tested once. The screen
 * only renders what this returns.
 */

import type { TestAttemptKind, TestSessionKind } from '../types';

export type TestSourceKind = 'deck' | 'note' | 'group';

/**
 * Re-exported, not re-declared: the same union is written into the saved test's
 * config and read back on launch, so it has to be one type or the builder and
 * the launcher can drift apart without the compiler noticing.
 */
export type { TestAttemptKind };

export interface TestSourceOption {
  id: TestSourceKind;
  label: string;
  /** One line, said plainly — what this source actually does. */
  description: string;
}

/**
 * Three doors, in the order a student is most likely to want them. "With your
 * group" is last and honest about where it goes: group tests are built inside
 * the group's chat, so choosing it leaves this page rather than pretending the
 * page can finish the job.
 */
export const TEST_SOURCES: readonly TestSourceOption[] = [
  {
    id: 'deck',
    label: 'From a deck',
    description: 'Turn the cards in one of your decks into questions.',
  },
  {
    id: 'note',
    label: 'From a note',
    description: 'Generate questions from a note, a lecture recording or an imported PDF.',
  },
  {
    id: 'group',
    label: 'With your group',
    description: 'Sit your group’s past questions. This opens the group chat, where group tests are set up.',
  },
];

export const QUESTION_COUNT_CHOICES: readonly number[] = [5, 10, 20, 30];

/** Minutes. 0 is untimed, and it is the default — a clock is a choice. */
export const TIMER_CHOICES: readonly number[] = [0, 5, 10, 15, 30, 60];

export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 50;

export interface TestPlanDraft {
  source: TestSourceKind | null;
  sourceId: string | null;
  sourceTitle: string | null;
  questionCount: number;
  attemptKind: TestAttemptKind;
  /** Minutes; 0 means untimed. Only meaningful for an exam attempt. */
  timerMinutes: number;
  /**
   * The set room the builder was opened from, when it was opened from one.
   *
   * The generator used to take the set off the SOURCE (the deck's or note's own
   * `studySetId`), so building a test inside a set from an unfiled deck made a
   * test belonging to no set — which the room's Test tab then could not list.
   * The room knows where the student is standing; the source only knows where
   * it is filed.
   */
  studySetId?: string | null;
}

export function defaultTestPlan(): TestPlanDraft {
  return {
    source: null,
    sourceId: null,
    sourceTitle: null,
    questionCount: 10,
    attemptKind: 'practice',
    timerMinutes: 0,
  };
}

export function clampQuestionCount(value: number, available?: number | null): number {
  const ceiling =
    typeof available === 'number' && available > 0
      ? Math.min(MAX_QUESTION_COUNT, available)
      : MAX_QUESTION_COUNT;
  if (!Number.isFinite(value)) return MIN_QUESTION_COUNT;
  return Math.max(MIN_QUESTION_COUNT, Math.min(ceiling, Math.round(value)));
}

/**
 * Choosing "With your group" is a navigation, not a configuration: the rest of
 * the page does not apply to it, so the screen collapses the settings and the
 * footer becomes "Open group chat".
 */
export function isNavigationSource(source: TestSourceKind | null): boolean {
  return source === 'group';
}

export interface TestPlanValidity {
  canStart: boolean;
  /** Why not — shown next to a disabled action, never as a silent dead button. */
  blocker: string | null;
}

export function validateTestPlan(
  plan: TestPlanDraft,
  context: { deckCount?: number; noteCount?: number } = {}
): TestPlanValidity {
  if (!plan.source) return { canStart: false, blocker: 'Pick where the questions come from.' };
  if (plan.source === 'group') return { canStart: true, blocker: null };
  if (plan.source === 'deck' && (context.deckCount ?? 0) === 0) {
    return { canStart: false, blocker: 'You have no decks yet. Make one in your Library first.' };
  }
  if (plan.source === 'note' && (context.noteCount ?? 0) === 0) {
    return { canStart: false, blocker: 'You have no notes yet. Import or write one first.' };
  }
  if (!plan.sourceId) {
    return {
      canStart: false,
      blocker: plan.source === 'deck' ? 'Choose a deck.' : 'Choose a note.',
    };
  }
  if (plan.questionCount < MIN_QUESTION_COUNT) {
    return { canStart: false, blocker: 'A test needs at least one question.' };
  }
  return { canStart: true, blocker: null };
}

function timerPhrase(minutes: number): string {
  if (minutes <= 0) return 'no timer';
  return `${minutes} min`;
}

/**
 * The summary line above the footer: one sentence that says exactly what
 * pressing Start will produce, so the student never has to scroll back up
 * through the settings to check what they chose.
 */
export function summarizeTestPlan(plan: TestPlanDraft): string {
  if (!plan.source) return 'Pick a source to begin.';
  if (plan.source === 'group') {
    return 'Group tests are set up in the group chat — this opens it.';
  }
  const from = plan.sourceTitle
    ? ` from “${plan.sourceTitle}”`
    : plan.source === 'deck'
      ? ' from a deck'
      : ' from a note';
  const noun = plan.questionCount === 1 ? 'question' : 'questions';
  if (plan.attemptKind === 'practice') {
    return `${plan.questionCount} ${noun}${from} · practice · answers revealed as you go.`;
  }
  return `${plan.questionCount} ${noun}${from} · exam · ${timerPhrase(plan.timerMinutes)} · scored at the end.`;
}

/** Label for the footer's primary action — it changes with the source. */
export function primaryActionLabel(plan: TestPlanDraft): string {
  if (plan.source === 'group') return 'Open group chat';
  return plan.attemptKind === 'practice' ? 'Start practice' : 'Start test';
}

/**
 * The config a plan is saved with — the whole point of the builder surviving
 * the trip to the server.
 *
 * Everything the student chose after "which source" (practice or exam, and how
 * long) lived only in this draft: the save request sent a title, a source and
 * the questions, so a test built as practice came back indistinguishable from
 * an exam and launched as one — plain, untimed, no confidence gate. This is the
 * mapping that travels with it, written into `config` at creation and read back
 * on every later launch.
 */
export type GeneratedTestConfig = {
  attemptKind: TestAttemptKind;
  /** How the taking screen should run: practice studies, an exam is sat. */
  mode: TestSessionKind;
  /**
   * Seconds, and only ever present on a timed exam. Absent — rather than 0 —
   * for practice and for an untimed exam, because `buildRetakeSession` arms the
   * clock on any truthy value and an explicit 0 would read as "no timer" only
   * by luck.
   */
  timerDuration?: number;
  /**
   * The set the test was built in. Stored on the config so it survives into
   * every session started from this test: a retake builds its session from the
   * saved config, and the create call files the session by what the config
   * says. Absent when the test belongs to no set.
   */
  studySetId?: string;
};

export function testConfigForPlan(plan: TestPlanDraft): GeneratedTestConfig {
  const room =
    typeof plan.studySetId === 'string' && plan.studySetId.trim()
      ? { studySetId: plan.studySetId.trim() }
      : {};
  // Practice is untimed by definition: the screen stops after every question to
  // show the answer, so a clock would be measuring the explanations.
  if (plan.attemptKind === 'practice') {
    return { attemptKind: 'practice', mode: 'study', ...room };
  }
  const minutes = Number.isFinite(plan.timerMinutes) ? Math.floor(plan.timerMinutes) : 0;
  return {
    attemptKind: 'exam',
    mode: 'test',
    ...(minutes > 0 ? { timerDuration: minutes * 60 } : {}),
    ...room,
  };
}

/**
 * Read the attempt kind back off a saved test's config.
 *
 * Absent means exam: every test written before the builder existed has no
 * `attemptKind`, and an exam is the safe reading — it reveals nothing early.
 */
export function attemptKindFromConfig(
  config: { attemptKind?: string | null } | null | undefined
): TestAttemptKind {
  return config?.attemptKind === 'practice' ? 'practice' : 'exam';
}
