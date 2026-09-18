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
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
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

  /**
   * The copy above is only worth anything if it IS the copy. While the wizard
   * still builds its payload inline, this reads the expression out of the
   * component and compares it to the reference; when the builder is extracted
   * into its own module this assertion is replaced by importing it.
   */
  it('matches the expression the wizard builds its payload with', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CreateFromSource.tsx'),
      'utf8'
    );
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    for (const line of [
      'questionCount: quizTypeCountTotal(counts) || (quizWizard ? QUIZ_FROM_CARDS_COUNT : undefined)',
      'title: title.trim() || undefined',
      'focus: focus.trim() || undefined',
      'quizTypes: counts',
      "lessonMode: kind === 'lesson' ? lessonMode : undefined",
      "recapStyle: kind === 'recap' ? recapStyle : undefined",
      "recapLength: kind === 'recap' ? recapLength : undefined",
      "rubricText: kind === 'essay' ? rubricText.trim() || undefined : undefined",
    ]) {
      expect(flat(source)).toContain(line);
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

export { referenceOptions, draft as payloadDraft };
