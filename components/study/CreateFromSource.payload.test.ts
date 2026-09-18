/**
 * What the create wizard SENDS, frozen before the wizard's screens were split.
 *
 * WHY THIS FILE EXISTS. `CreateFromSource` is being re-cut into one question
 * per step: the four per-type number inputs become a total plus a set of
 * enabled types, and the topic screen splits in two. None of that may change
 * the payload handed to `onPickNote` / `onPickTopic` / `onPickDecks`, because
 * downstream those become the generator call and the credit charge.
 *
 * So the payload builder is written down here TWICE, on purpose:
 *
 *  1. `referenceOptions` is a verbatim copy of the `options()` closure as it
 *     stood before the split (CreateFromSource.tsx, 2026-09-17). It is frozen:
 *     nothing in this file may be "fixed" to make a new implementation pass.
 *  2. `PAYLOAD_TABLE` writes the answer out as literal objects — kind by kind,
 *     path by path — so a change of behaviour has to be typed out by hand
 *     rather than sliding through a shared helper both sides call.
 *
 * The third assertion is the bridge: the same payload must come out of the
 * NEW screens' state (a total plus enabled types) as came out of the old
 * four-number screen, for inputs that mean the same thing.
 */
import { describe, expect, it } from 'vitest';
import { buildCreateOptions } from './createWizard/createOptions';
import { splitQuestionCounts, type QuizTypeKey } from './createWizard/questionCounts';
import {
  DEFAULT_QUIZ_TYPE_COUNTS,
  QUIZ_FROM_CARDS_COUNT,
  quizTypeCountTotal,
  type CreateFromSourceKind,
  type CreateFromSourceOptions,
  type LessonMode,
  type QuizTypeCounts,
  type RecapLength,
  type RecapStyle,
} from '@lantern/shared';

/** Every field the old wizard held that could reach a payload. */
export interface WizardDraft {
  counts: QuizTypeCounts;
  title: string;
  focus: string;
  lessonMode: LessonMode;
  recapStyle: RecapStyle;
  recapLength: RecapLength;
  rubricText: string;
}

/** The old wizard's initial state, field for field. */
const draft = (over: Partial<WizardDraft> = {}): WizardDraft => ({
  counts: { ...DEFAULT_QUIZ_TYPE_COUNTS },
  title: '',
  focus: '',
  lessonMode: 'explore',
  recapStyle: 'podcast',
  recapLength: 'medium',
  rubricText: '',
  ...over,
});

/**
 * FROZEN. Copied character for character out of the pre-split `options()`
 * closure, with `counts`/`title`/... read off a draft instead of off hooks.
 * `quizWizard` was `kind === 'quiz'`.
 */
function referenceOptions(kind: CreateFromSourceKind, d: WizardDraft): CreateFromSourceOptions {
  const quizWizard = kind === 'quiz';
  return {
    questionCount: quizTypeCountTotal(d.counts) || (quizWizard ? QUIZ_FROM_CARDS_COUNT : undefined),
    title: d.title.trim() || undefined,
    focus: d.focus.trim() || undefined,
    quizTypes: d.counts,
    lessonMode: kind === 'lesson' ? d.lessonMode : undefined,
    recapStyle: kind === 'recap' ? d.recapStyle : undefined,
    recapLength: kind === 'recap' ? d.recapLength : undefined,
    rubricText: kind === 'essay' ? d.rubricText.trim() || undefined : undefined,
  };
}

const ALL_MC: QuizTypeCounts = {
  multiple_choice: 20,
  true_false: 0,
  fill_in_blank: 0,
  short_answer: 0,
};

/**
 * kind × path × what the student answered → the exact payload, written out.
 * `path` is documentation: the payload builder never saw it, which is itself
 * the invariant (the same answers send the same thing whichever door they
 * were collected behind).
 */
export const PAYLOAD_TABLE: ReadonlyArray<{
  name: string;
  kind: CreateFromSourceKind;
  path: 'materials' | 'topic' | 'flashcards';
  draft: WizardDraft;
  expected: CreateFromSourceOptions;
}> = [
  {
    name: 'quiz from materials, nothing touched',
    kind: 'quiz',
    path: 'materials',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'quiz from materials, a mixed count and a name',
    kind: 'quiz',
    path: 'materials',
    draft: draft({
      counts: { multiple_choice: 5, true_false: 3, fill_in_blank: 2, short_answer: 0 },
      title: '  Midterm one  ',
      focus: ' glycolysis ',
    }),
    expected: {
      questionCount: 10,
      title: 'Midterm one',
      focus: 'glycolysis',
      quizTypes: { multiple_choice: 5, true_false: 3, fill_in_blank: 2, short_answer: 0 },
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'quiz with every count zeroed falls back to the from-cards count',
    kind: 'quiz',
    path: 'materials',
    draft: draft({
      counts: { multiple_choice: 0, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    }),
    expected: {
      questionCount: QUIZ_FROM_CARDS_COUNT,
      title: undefined,
      focus: undefined,
      quizTypes: { multiple_choice: 0, true_false: 0, fill_in_blank: 0, short_answer: 0 },
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'quiz from flashcards, nothing touched',
    kind: 'quiz',
    path: 'flashcards',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'quiz from a topic',
    kind: 'quiz',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'cards from a topic, card count left alone',
    kind: 'cards',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'cards from a topic, 12 cards asked for',
    kind: 'cards',
    path: 'topic',
    draft: draft({
      counts: { multiple_choice: 12, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    }),
    expected: {
      questionCount: 12,
      title: undefined,
      focus: undefined,
      quizTypes: { multiple_choice: 12, true_false: 0, fill_in_blank: 0, short_answer: 0 },
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'lesson from materials keeps the mode and drops the recap fields',
    kind: 'lesson',
    path: 'materials',
    draft: draft({ lessonMode: 'drill', title: 'Krebs' }),
    expected: {
      questionCount: 20,
      title: 'Krebs',
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: 'drill',
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'lesson from a topic, mode left at explore',
    kind: 'lesson',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: 'explore',
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'recap from a topic carries style and length, not the lesson mode',
    kind: 'recap',
    path: 'topic',
    draft: draft({ recapStyle: 'lecture', recapLength: 'long' }),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: 'lecture',
      recapLength: 'long',
      rubricText: undefined,
    },
  },
  {
    name: 'recap from materials at its defaults',
    kind: 'recap',
    path: 'materials',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: 'podcast',
      recapLength: 'medium',
      rubricText: undefined,
    },
  },
  {
    name: 'essay from materials trims the rubric',
    kind: 'essay',
    path: 'materials',
    draft: draft({ rubricText: '  argument\nevidence  ' }),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: 'argument\nevidence',
    },
  },
  {
    name: 'essay with a whitespace-only rubric sends nothing',
    kind: 'essay',
    path: 'materials',
    draft: draft({ rubricText: '   ' }),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'essay from a topic',
    kind: 'essay',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'play from a topic',
    kind: 'play',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'test from materials',
    kind: 'test',
    path: 'materials',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'starter materials from a topic',
    kind: 'materials',
    path: 'topic',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
  {
    name: 'notes from materials',
    kind: 'notes',
    path: 'materials',
    draft: draft(),
    expected: {
      questionCount: 20,
      title: undefined,
      focus: undefined,
      quizTypes: ALL_MC,
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    },
  },
];

describe('the payload the create wizard sends, frozen', () => {
  it.each(PAYLOAD_TABLE.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    expect(referenceOptions(row.kind, row.draft)).toEqual(row.expected);
  });

  it('never sends a question count of zero', () => {
    for (const row of PAYLOAD_TABLE) {
      expect(row.expected.questionCount).toBeGreaterThan(0);
    }
  });

  it('only quiz falls back to the from-cards count when every type is zero', () => {
    const empty = draft({
      counts: { multiple_choice: 0, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    });
    expect(referenceOptions('quiz', empty).questionCount).toBe(QUIZ_FROM_CARDS_COUNT);
    expect(referenceOptions('cards', empty).questionCount).toBeUndefined();
  });
});

describe('the wizard still sends the frozen payload after the screens were split', () => {
  it.each(PAYLOAD_TABLE.map((row) => [row.name, row] as const))(
    'buildCreateOptions matches the frozen answer: %s',
    (_name, row) => {
      expect(buildCreateOptions(row.kind, row.draft)).toEqual(row.expected);
      expect(buildCreateOptions(row.kind, row.draft)).toEqual(
        referenceOptions(row.kind, row.draft)
      );
    }
  );
});

/**
 * The bridge between the two step machines.
 *
 * `old` is what the pre-split screen held — four numbers the student typed.
 * `next` is what the new screens hold — a total chip and a set of type chips.
 * Rows pair answers that MEAN the same thing; the payloads must be identical.
 */
const EQUIVALENCE_TABLE: ReadonlyArray<{
  name: string;
  kind: CreateFromSourceKind;
  old: QuizTypeCounts;
  next: { total: number; enabled: QuizTypeKey[] };
}> = [
  {
    name: 'the untouched default: 20, multiple choice only',
    kind: 'quiz',
    old: { multiple_choice: 20, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    next: { total: 20, enabled: ['multiple_choice'] },
  },
  {
    name: 'the 5 chip, multiple choice only',
    kind: 'quiz',
    old: { multiple_choice: 5, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    next: { total: 5, enabled: ['multiple_choice'] },
  },
  {
    name: 'the 10 chip across all four types',
    kind: 'quiz',
    old: { multiple_choice: 3, true_false: 3, fill_in_blank: 2, short_answer: 2 },
    next: { total: 10, enabled: ['multiple_choice', 'true_false', 'fill_in_blank', 'short_answer'] },
  },
  {
    name: 'the 20 chip across all four types',
    kind: 'quiz',
    old: { multiple_choice: 5, true_false: 5, fill_in_blank: 5, short_answer: 5 },
    next: { total: 20, enabled: ['multiple_choice', 'true_false', 'fill_in_blank', 'short_answer'] },
  },
  {
    name: 'the 15 chip across two types',
    kind: 'quiz',
    old: { multiple_choice: 8, true_false: 7, fill_in_blank: 0, short_answer: 0 },
    next: { total: 15, enabled: ['multiple_choice', 'true_false'] },
  },
  {
    name: 'a custom total of 12 across three types',
    kind: 'quiz',
    old: { multiple_choice: 4, true_false: 4, fill_in_blank: 4, short_answer: 0 },
    next: { total: 12, enabled: ['multiple_choice', 'true_false', 'fill_in_blank'] },
  },
  {
    name: 'a custom total of 7 on short answer alone',
    kind: 'quiz',
    old: { multiple_choice: 0, true_false: 0, fill_in_blank: 0, short_answer: 7 },
    next: { total: 7, enabled: ['short_answer'] },
  },
  {
    name: 'a card count, which rides in multiple_choice on the cards door',
    kind: 'cards',
    old: { multiple_choice: 12, true_false: 0, fill_in_blank: 0, short_answer: 0 },
    next: { total: 12, enabled: ['multiple_choice'] },
  },
];

describe('the old screen and the new screens send the same payload', () => {
  it.each(EQUIVALENCE_TABLE.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const before = referenceOptions(row.kind, draft({ counts: row.old }));
    const after = buildCreateOptions(
      row.kind,
      draft({ counts: splitQuestionCounts(row.next.total, row.next.enabled) })
    );
    expect(after).toEqual(before);
  });

  it('carries the name, focus, mode, style and rubric across untouched', () => {
    for (const kind of ['quiz', 'lesson', 'recap', 'essay'] as CreateFromSourceKind[]) {
      const answers = draft({
        counts: splitQuestionCounts(20, ['multiple_choice']),
        title: ' Finals ',
        focus: ' enzymes ',
        lessonMode: 'drill',
        recapStyle: 'lecture',
        recapLength: 'short',
        rubricText: ' thesis ',
      });
      expect(buildCreateOptions(kind, answers)).toEqual(referenceOptions(kind, answers));
    }
  });
});

export { referenceOptions, draft as payloadDraft };
