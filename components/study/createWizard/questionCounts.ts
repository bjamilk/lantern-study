/**
 * How many questions, and of which types — the two answers the counts screen
 * used to collect as four number inputs on one screen.
 *
 * WHY A SPLITTER AND NOT FOUR INPUTS. Four boxes and a running total is a
 * sum the student is asked to do in their head before they can press Next.
 * The screen now asks a total (a chip row) and a set of types (toggle chips),
 * and this file turns that pair back into the per-type counts the generator
 * has always been handed. The four boxes are still reachable behind "Set each
 * type" — removed from the default face, not removed.
 *
 * Touches: `CountStep`, `TypesStep` and `CreateFromSource`'s draft. The output
 * shape is `QuizTypeCounts`, which is what `CreateFromSourceOptions.quizTypes`
 * carries and what `quizTypeCountTotal` sums.
 *
 * Gotcha: the canonical order below is the order a remainder is handed out in,
 * so the split is deterministic — it does not depend on the order the student
 * happened to tap the type chips.
 */
import {
  DEFAULT_QUIZ_TYPE_COUNTS,
  quizTypeCountTotal,
  type QuizTypeCounts,
} from '@lantern/shared';

export type QuizTypeKey = keyof QuizTypeCounts;

/**
 * The canonical order: how the chips are drawn, and who gets the remainder
 * first. Moved here verbatim from `CreateFromSource`.
 */
export const QUIZ_TYPE_FIELDS: ReadonlyArray<{ key: QuizTypeKey; label: string }> = [
  { key: 'multiple_choice', label: 'Multiple choice' },
  { key: 'true_false', label: 'True / false' },
  { key: 'fill_in_blank', label: 'Fill in the blank' },
  { key: 'short_answer', label: 'Short answer' },
];

export const ALL_QUIZ_TYPES: readonly QuizTypeKey[] = QUIZ_TYPE_FIELDS.map((field) => field.key);

/** The chip row. Custom is the fifth chip and reveals one number input. */
export const QUESTION_COUNT_CHOICES: readonly number[] = [5, 10, 15, 20];

/** 20 — the total the wizard has always started from. */
export const DEFAULT_QUESTION_TOTAL = quizTypeCountTotal(DEFAULT_QUIZ_TYPE_COUNTS);

export const QUESTION_TOTAL_MIN = 1;
export const QUESTION_TOTAL_MAX = 40;

const ZERO: QuizTypeCounts = {
  multiple_choice: 0,
  true_false: 0,
  fill_in_blank: 0,
  short_answer: 0,
};

/**
 * Spread `total` questions across the types that are switched on.
 *
 * Even shares, and the remainder goes to the earlier types in
 * `QUIZ_TYPE_FIELDS` order — so 10 across all four is 3/3/2/2, and 20 across
 * multiple choice alone is the 20/0/0/0 the wizard has always defaulted to.
 *
 * No type on, or nothing to share, gives all zeros: the screen keeps Next
 * disabled in that state rather than sending a quiz with no questions in it.
 */
export function splitQuestionCounts(
  total: number,
  enabledTypes: readonly QuizTypeKey[]
): QuizTypeCounts {
  const order = ALL_QUIZ_TYPES.filter((key) => enabledTypes.includes(key));
  const whole = Math.max(0, Math.floor(total) || 0);
  if (order.length === 0 || whole === 0) return { ...ZERO };

  const base = Math.floor(whole / order.length);
  const remainder = whole % order.length;
  const counts: QuizTypeCounts = { ...ZERO };
  order.forEach((key, index) => {
    counts[key] = base + (index < remainder ? 1 : 0);
  });
  return counts;
}

/** Which types a per-type mix has switched on — the inverse face of the split. */
export function enabledTypesFrom(counts: QuizTypeCounts): QuizTypeKey[] {
  return ALL_QUIZ_TYPES.filter((key) => counts[key] > 0);
}

/** Clamp a typed-in custom total to the range the number input allows. */
export function clampQuestionTotal(value: number): number {
  if (!Number.isFinite(value)) return QUESTION_TOTAL_MIN;
  return Math.max(QUESTION_TOTAL_MIN, Math.min(QUESTION_TOTAL_MAX, Math.floor(value)));
}
