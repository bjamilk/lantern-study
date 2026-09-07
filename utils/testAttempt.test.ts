import { describe, expect, it } from 'vitest';
import { QuestionType, type TestQuestion, type UserAnswerRecord } from '../types';
import {
  calibrationNote,
  isAnswerRecorded,
  provenanceChipLabel,
  readProvenance,
  tallyAttempt,
  unansweredNote,
} from './testAttempt';

/**
 * A real, gradable question. The tally RE-GRADES from the question rather than
 * trusting a stored `isCorrect`, so a stub with no correct answer would score
 * zero — which is the behaviour, not a broken fixture.
 */
const q = (id: string): TestQuestion =>
  ({
    id,
    questionStem: `Q ${id}`,
    questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
    options: [
      { id: 'right', text: 'Right' },
      { id: 'wrong', text: 'Wrong' },
    ],
    correctAnswerIds: ['right'],
  }) as unknown as TestQuestion;

const answer = (over: Partial<UserAnswerRecord>): UserAnswerRecord =>
  ({ questionId: 'x', ...over }) as UserAnswerRecord;

describe('isAnswerRecorded', () => {
  it('is true only when something was actually put down', () => {
    expect(isAnswerRecorded(undefined)).toBe(false);
    expect(isAnswerRecorded(answer({}))).toBe(false);
    expect(isAnswerRecorded(answer({ selectedOptionIds: [] }))).toBe(false);
    expect(isAnswerRecorded(answer({ fillText: '   ' }))).toBe(false);
    expect(isAnswerRecorded(answer({ selectedOptionIds: ['right'] }))).toBe(true);
    expect(isAnswerRecorded(answer({ fillText: 'mitosis' }))).toBe(true);
  });

  it('does not read a graded-false answer as unanswered', () => {
    // The trap: the server marks an untouched question `isCorrect: false` too,
    // so correctness can never be the test for "did they answer".
    expect(isAnswerRecorded(answer({ selectedOptionIds: ['right'], isCorrect: false }))).toBe(true);
    expect(isAnswerRecorded(answer({ isCorrect: false }))).toBe(false);
  });
});

describe('tallyAttempt', () => {
  const session = {
    questions: [q('a'), q('b'), q('c'), q('d')],
    userAnswers: {
      a: answer({ selectedOptionIds: ['right'], confidence: 'sure' }),
      b: answer({ selectedOptionIds: ['wrong'], confidence: 'sure' }),
      c: answer({ selectedOptionIds: ['right'], confidence: 'unsure' }),
      // d was never reached.
    },
  };

  it('keeps unanswered out of incorrect', () => {
    const tally = tallyAttempt(session);
    expect(tally).toMatchObject({ total: 4, answered: 3, correct: 2, incorrect: 1, unanswered: 1 });
  });

  it('splits by what the student said before the reveal', () => {
    const tally = tallyAttempt(session);
    expect(tally.byConfidence.sure).toEqual({ correct: 1, incorrect: 1, answered: 2 });
    expect(tally.byConfidence.unsure).toEqual({ correct: 1, incorrect: 0, answered: 1 });
    expect(tally.byConfidence.unspecified).toEqual({ correct: 0, incorrect: 0, answered: 0 });
  });

  it('files an exam attempt under unspecified, not under a confidence level', () => {
    const tally = tallyAttempt({
      questions: [q('a')],
      userAnswers: { a: answer({ selectedOptionIds: ['right'] }) },
    });
    expect(tally.byConfidence.unspecified.correct).toBe(1);
    expect(tally.byConfidence.sure.answered).toBe(0);
    expect(tally.byConfidence.unsure.answered).toBe(0);
  });

  it('handles an attempt with nothing answered at all', () => {
    const tally = tallyAttempt({ questions: [q('a'), q('b')], userAnswers: {} });
    expect(tally).toMatchObject({ total: 2, answered: 0, correct: 0, incorrect: 0, unanswered: 2 });
  });

  it('never reports a negative unanswered count', () => {
    const tally = tallyAttempt({
      questions: [],
      userAnswers: { ghost: answer({ selectedOptionIds: ['right'] }) },
    });
    expect(tally.unanswered).toBe(0);
  });
});

describe('unansweredNote', () => {
  it('says nothing when every question was attempted', () => {
    expect(unansweredNote(tallyAttempt({ questions: [], userAnswers: {} }))).toBe(null);
  });

  it('names the count and says it is not counted as wrong', () => {
    const note = unansweredNote(tallyAttempt({ questions: [q('a'), q('b')], userAnswers: {} }));
    expect(note).toBe('2 questions left unanswered — not counted as wrong.');
  });

  it('is singular for one', () => {
    expect(unansweredNote(tallyAttempt({ questions: [q('a')], userAnswers: {} }))).toMatch(
      /^1 question /
    );
  });
});

describe('calibrationNote', () => {
  it('is silent when confidence was never asked', () => {
    const tally = tallyAttempt({
      questions: [q('a')],
      userAnswers: { a: answer({ selectedOptionIds: ['right'] }) },
    });
    expect(calibrationNote(tally)).toBe(null);
  });

  it('leads with the sure-but-wrong gap', () => {
    const tally = tallyAttempt({
      questions: [q('a'), q('b')],
      userAnswers: {
        a: answer({ selectedOptionIds: ['wrong'], confidence: 'sure' }),
        b: answer({ selectedOptionIds: ['right'], confidence: 'unsure' }),
      },
    });
    expect(calibrationNote(tally)).toMatch(/sure about 1 answer/);
  });

  it('encourages when unsure answers turned out right', () => {
    const tally = tallyAttempt({
      questions: [q('a')],
      userAnswers: { a: answer({ selectedOptionIds: ['right'], confidence: 'unsure' }) },
    });
    expect(calibrationNote(tally)).toMatch(/know more than you think/);
  });
});

describe('readProvenance / provenanceChipLabel', () => {
  it('prefers the server-resolved provenance when there is one', () => {
    const resolved = { noteId: 'n1', deckId: null, groupId: null, title: 'Lecture 4' };
    expect(readProvenance({ config: { groupId: 'g1' } as any, provenance: resolved })).toBe(resolved);
  });

  it('falls back to the config for a session held only in memory', () => {
    expect(
      readProvenance({
        config: { groupId: 'g1', groupName: 'Bio 201', numberOfQuestions: 1, questionIds: [], allowedQuestionTypes: [] },
      })
    ).toEqual({ noteId: null, deckId: null, groupId: 'g1', title: 'Bio 201' });
  });

  it('returns nulls rather than undefined, so callers need no guard', () => {
    const p = readProvenance({ config: {} as any });
    expect(p).toEqual({ noteId: null, deckId: null, groupId: null, title: null });
    expect(provenanceChipLabel(p)).toBe(null);
  });

  it('labels the chip by which source is real', () => {
    expect(provenanceChipLabel({ noteId: 'n', deckId: null, groupId: null, title: 'L4' })).toBe('Note · L4');
    expect(provenanceChipLabel({ noteId: null, deckId: 'd', groupId: null, title: 'Cards' })).toBe('Deck · Cards');
    expect(provenanceChipLabel({ noteId: null, deckId: null, groupId: 'g', title: 'Bio' })).toBe('Group · Bio');
  });
});
