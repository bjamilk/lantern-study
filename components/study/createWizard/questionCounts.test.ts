/**
 * The total-plus-types screen, turned back into per-type counts.
 *
 * The load-bearing row is the first one: 20 questions, multiple choice only,
 * must still be exactly `DEFAULT_QUIZ_TYPE_COUNTS` — the mix the wizard has
 * sent since before the split.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUIZ_TYPE_COUNTS, quizTypeCountTotal } from '@lantern/shared';
import {
  ALL_QUIZ_TYPES,
  QUESTION_COUNT_CHOICES,
  clampQuestionTotal,
  enabledTypesFrom,
  splitQuestionCounts,
  type QuizTypeKey,
} from './questionCounts';

const subsets = (): QuizTypeKey[][] => {
  const out: QuizTypeKey[][] = [];
  for (let mask = 1; mask < 1 << ALL_QUIZ_TYPES.length; mask += 1) {
    out.push(ALL_QUIZ_TYPES.filter((_key, index) => mask & (1 << index)));
  }
  return out;
};

describe('splitQuestionCounts', () => {
  it('reproduces the wizard default: 20 multiple choice, nothing else', () => {
    expect(splitQuestionCounts(20, ['multiple_choice'])).toEqual(DEFAULT_QUIZ_TYPE_COUNTS);
  });

  it('spreads a total evenly when it divides', () => {
    expect(splitQuestionCounts(20, ALL_QUIZ_TYPES)).toEqual({
      multiple_choice: 5,
      true_false: 5,
      fill_in_blank: 5,
      short_answer: 5,
    });
    expect(splitQuestionCounts(10, ['multiple_choice', 'true_false'])).toEqual({
      multiple_choice: 5,
      true_false: 5,
      fill_in_blank: 0,
      short_answer: 0,
    });
  });

  it('hands the remainder to the earlier types, in the order the chips are drawn', () => {
    expect(splitQuestionCounts(10, ALL_QUIZ_TYPES)).toEqual({
      multiple_choice: 3,
      true_false: 3,
      fill_in_blank: 2,
      short_answer: 2,
    });
    expect(splitQuestionCounts(5, ALL_QUIZ_TYPES)).toEqual({
      multiple_choice: 2,
      true_false: 1,
      fill_in_blank: 1,
      short_answer: 1,
    });
  });

  it('does not depend on the order the student tapped the chips', () => {
    expect(splitQuestionCounts(7, ['short_answer', 'multiple_choice'])).toEqual(
      splitQuestionCounts(7, ['multiple_choice', 'short_answer'])
    );
    expect(splitQuestionCounts(7, ['short_answer', 'multiple_choice'])).toEqual({
      multiple_choice: 4,
      true_false: 0,
      fill_in_blank: 0,
      short_answer: 3,
    });
  });

  it('keeps the total exactly, for every chip and every subset of types', () => {
    for (const total of [...QUESTION_COUNT_CHOICES, 1, 3, 7, 13, 17, 33, 40]) {
      for (const types of subsets()) {
        const counts = splitQuestionCounts(total, types);
        expect(quizTypeCountTotal(counts)).toBe(total);
        // A type that is off must be sent as zero, never as a stray one.
        for (const key of ALL_QUIZ_TYPES) {
          if (!types.includes(key)) expect(counts[key]).toBe(0);
          else expect(counts[key]).toBeGreaterThanOrEqual(Math.floor(total / types.length));
        }
      }
    }
  });

  it('gives all zeros rather than a quiz with no questions in it', () => {
    const zero = { multiple_choice: 0, true_false: 0, fill_in_blank: 0, short_answer: 0 };
    expect(splitQuestionCounts(20, [])).toEqual(zero);
    expect(splitQuestionCounts(0, ALL_QUIZ_TYPES)).toEqual(zero);
    expect(splitQuestionCounts(-5, ALL_QUIZ_TYPES)).toEqual(zero);
    expect(splitQuestionCounts(Number.NaN, ALL_QUIZ_TYPES)).toEqual(zero);
  });

  it('ignores a type named twice', () => {
    expect(splitQuestionCounts(10, ['multiple_choice', 'multiple_choice'])).toEqual({
      multiple_choice: 10,
      true_false: 0,
      fill_in_blank: 0,
      short_answer: 0,
    });
  });
});

describe('enabledTypesFrom', () => {
  it('reads back the types a per-type mix switched on', () => {
    expect(enabledTypesFrom(DEFAULT_QUIZ_TYPE_COUNTS)).toEqual(['multiple_choice']);
    expect(enabledTypesFrom(splitQuestionCounts(20, ALL_QUIZ_TYPES))).toEqual([...ALL_QUIZ_TYPES]);
  });

  it('round-trips a split back to the types it was given', () => {
    for (const types of subsets()) {
      expect(enabledTypesFrom(splitQuestionCounts(20, types))).toEqual(types);
    }
  });
});

describe('clampQuestionTotal', () => {
  it('holds a custom total inside the range the input allows', () => {
    expect(clampQuestionTotal(0)).toBe(1);
    expect(clampQuestionTotal(-3)).toBe(1);
    expect(clampQuestionTotal(12)).toBe(12);
    expect(clampQuestionTotal(12.7)).toBe(12);
    expect(clampQuestionTotal(400)).toBe(40);
    expect(clampQuestionTotal(Number.NaN)).toBe(1);
  });
});
