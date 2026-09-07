/**
 * The three-way attempt tally and the confidence that rides with an answer.
 *
 * The bug these guard: every results screen derived "missed" as
 * total - correct, so a student who ran out of time was told they got the
 * questions they never saw WRONG, and "review my mistakes" opened questions
 * they had never been shown.
 */
import {
    normalizeAnswerConfidence,
    normalizeQuestionExplanation,
    normalizeStoredUserAnswer,
    sanitizeAnswerConfidences,
    tallyTestAttempt,
} from './testHelpers';

const question = (id: string, correct: string) => ({
    id,
    question: `Question ${id}`,
    type: 'multiple_choice_single',
    options: ['yes', 'no'],
    correctAnswer: correct,
});

const questions = [question('q1', 'yes'), question('q2', 'yes'), question('q3', 'yes')];

/**
 * The id the normaliser assigns to the nth string option — 1-based, and NOT
 * derived from the question id.
 */
const optionId = (_questionId: string, index: number) => String(index + 1);

describe('tallyTestAttempt', () => {
    it('counts a question that was never answered as unanswered, not incorrect', () => {
        const tally = tallyTestAttempt(questions, {
            q1: { questionId: 'q1', selectedOptionIds: [optionId('q1', 0)] },
        });

        expect(tally.total).toBe(3);
        expect(tally.answered).toBe(1);
        expect(tally.unanswered).toBe(2);
        // The whole point: the two untouched questions are NOT wrong.
        expect(tally.incorrect).toBe(0);
    });

    it('splits answered questions into correct and incorrect', () => {
        const tally = tallyTestAttempt(questions, {
            q1: { questionId: 'q1', selectedOptionIds: [optionId('q1', 0)] },
            q2: { questionId: 'q2', selectedOptionIds: [optionId('q2', 1)] },
        });

        expect(tally.correct).toBe(1);
        expect(tally.incorrect).toBe(1);
        expect(tally.unanswered).toBe(1);
        expect(tally.correct + tally.incorrect + tally.unanswered).toBe(tally.total);
    });

    it('keeps the confidence split apart from "never asked"', () => {
        const tally = tallyTestAttempt(questions, {
            q1: { questionId: 'q1', selectedOptionIds: [optionId('q1', 0)], confidence: 'sure' },
            q2: { questionId: 'q2', selectedOptionIds: [optionId('q2', 1)], confidence: 'unsure' },
            q3: { questionId: 'q3', selectedOptionIds: [optionId('q3', 0)] },
        });

        expect(tally.byConfidence.sure).toEqual({ correct: 1, incorrect: 0, answered: 1 });
        expect(tally.byConfidence.unsure).toEqual({ correct: 0, incorrect: 1, answered: 1 });
        // An exam answer has no confidence — that is a third state, not a
        // third confidence level.
        expect(tally.byConfidence.unspecified).toEqual({ correct: 1, incorrect: 0, answered: 1 });
    });

    it('tallies an empty session to zeroes rather than throwing', () => {
        const tally = tallyTestAttempt([], null);
        expect(tally).toMatchObject({ total: 0, answered: 0, correct: 0, incorrect: 0, unanswered: 0 });
    });

    it('reads the legacy array answer shape', () => {
        const tally = tallyTestAttempt(questions, [
            { questionId: 'q1', selectedOptionIds: [optionId('q1', 0)] },
        ]);
        expect(tally.correct).toBe(1);
        expect(tally.unanswered).toBe(2);
    });
});

describe('normalizeAnswerConfidence', () => {
    it('accepts only the two reportable values', () => {
        expect(normalizeAnswerConfidence('sure')).toBe('sure');
        expect(normalizeAnswerConfidence('UNSURE')).toBe('unsure');
    });

    it('drops anything else so it cannot become a confidence level of its own', () => {
        expect(normalizeAnswerConfidence('maybe')).toBeUndefined();
        expect(normalizeAnswerConfidence(true)).toBeUndefined();
        expect(normalizeAnswerConfidence(undefined)).toBeUndefined();
    });
});

describe('sanitizeAnswerConfidences', () => {
    it('keeps a valid confidence and removes an invalid one, leaving the rest untouched', () => {
        const out = sanitizeAnswerConfidences({
            q1: { questionId: 'q1', confidence: 'sure', timeSpentSeconds: 4 },
            q2: { questionId: 'q2', confidence: 'quite sure', fillText: 'photosynthesis' },
        });

        expect(out.q1).toEqual({ questionId: 'q1', confidence: 'sure', timeSpentSeconds: 4 });
        expect(out.q2).toEqual({ questionId: 'q2', fillText: 'photosynthesis' });
    });

    it('leaves the array shape an array — turning it into an object loses every answer', () => {
        const out = sanitizeAnswerConfidences([{ questionId: 'q1', confidence: 'unsure' }]);
        expect(Array.isArray(out)).toBe(true);
        expect(out[0]).toEqual({ questionId: 'q1', confidence: 'unsure' });
    });
});

describe('normalizeStoredUserAnswer', () => {
    it('carries confidence through', () => {
        expect(normalizeStoredUserAnswer({ questionId: 'q1', confidence: 'unsure' }).confidence).toBe(
            'unsure'
        );
    });

    it('leaves confidence absent when none was reported', () => {
        expect(normalizeStoredUserAnswer({ questionId: 'q1' }).confidence).toBeUndefined();
    });
});

describe('normalizeQuestionExplanation', () => {
    it('reads the rationale whatever the generator called it', () => {
        expect(normalizeQuestionExplanation({ explanation: 'Because X.' })).toBe('Because X.');
        expect(normalizeQuestionExplanation({ rationale: 'Because Y.' })).toBe('Because Y.');
    });

    it('treats the generator placeholder as no explanation at all', () => {
        expect(normalizeQuestionExplanation({ explanation: 'No explanation available.' })).toBeUndefined();
        expect(normalizeQuestionExplanation({ explanation: '   ' })).toBeUndefined();
    });
});
