import {
  buildQuestionBankPreview,
  sanitizeQuestionForPreview,
  QUESTION_BANK_PREVIEW_LIMIT,
} from './questionBankPreview';

/**
 * A preview is served to anyone, including guests who have not bought the
 * bank. Leaking any answer key here gives the product away, so the sanitizer
 * is an allowlist and these tests assert the negative: nothing answer-shaped
 * survives, including fields invented after this code was written.
 */
const FULL_QUESTION = {
  id: 'q1',
  type: 'question',
  questionType: 'mcq-single',
  questionStem: 'What is the capital of Nigeria?',
  options: [
    { id: 'o1', text: 'Lagos' },
    { id: 'o2', text: 'Abuja' },
  ],
  imageUrl: 'https://example.test/img.png',
  tags: ['geography'],
  // Everything below must never reach a viewer.
  correctAnswerIds: ['o2'],
  acceptableAnswers: ['Abuja'],
  correctMatches: [{ promptItemId: 'p1', answerItemId: 'a1' }],
  explanation: 'Abuja became the capital in 1991.',
  upvotes: 3,
  downvotes: 0,
};

describe('sanitizeQuestionForPreview', () => {
  it('keeps the readable parts of a question', () => {
    const preview = sanitizeQuestionForPreview(FULL_QUESTION)!;
    expect(preview).toMatchObject({
      id: 'q1',
      questionStem: 'What is the capital of Nigeria?',
      questionType: 'mcq-single',
      imageUrl: 'https://example.test/img.png',
      tags: ['geography'],
    });
    expect(preview.options).toEqual([
      { id: 'o1', text: 'Lagos' },
      { id: 'o2', text: 'Abuja' },
    ]);
  });

  it.each([
    'correctAnswerIds',
    'acceptableAnswers',
    'correctMatches',
    'explanation',
  ])('strips %s', (field) => {
    expect(sanitizeQuestionForPreview(FULL_QUESTION)).not.toHaveProperty(field);
  });

  it('drops unknown fields rather than passing them through', () => {
    const preview = sanitizeQuestionForPreview({
      ...FULL_QUESTION,
      answerKeyAddedLater: 'o2',
      solutionVideoUrl: 'https://example.test/solution',
    })!;
    expect(preview).not.toHaveProperty('answerKeyAddedLater');
    expect(preview).not.toHaveProperty('solutionVideoUrl');
  });

  it('strips correctness markers from options', () => {
    const preview = sanitizeQuestionForPreview({
      ...FULL_QUESTION,
      options: [
        { id: 'o1', text: 'Lagos', isCorrect: false },
        { id: 'o2', text: 'Abuja', isCorrect: true, correct: true },
      ],
    })!;
    expect(preview.options).toEqual([
      { id: 'o1', text: 'Lagos' },
      { id: 'o2', text: 'Abuja' },
    ]);
  });

  it('returns null for non-objects', () => {
    expect(sanitizeQuestionForPreview(null)).toBeNull();
    expect(sanitizeQuestionForPreview('question')).toBeNull();
  });
});

describe('buildQuestionBankPreview', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...FULL_QUESTION, id: `q${i}` }));

  it('caps the sample at the preview limit', () => {
    expect(buildQuestionBankPreview(many)).toHaveLength(QUESTION_BANK_PREVIEW_LIMIT);
  });

  it('sanitizes every question it returns', () => {
    for (const q of buildQuestionBankPreview(many)) {
      expect(q).not.toHaveProperty('correctAnswerIds');
      expect(q).not.toHaveProperty('explanation');
    }
  });

  it('handles missing or malformed question arrays', () => {
    expect(buildQuestionBankPreview(undefined)).toEqual([]);
    expect(buildQuestionBankPreview('nope')).toEqual([]);
    expect(buildQuestionBankPreview([null, undefined])).toEqual([]);
  });
});
