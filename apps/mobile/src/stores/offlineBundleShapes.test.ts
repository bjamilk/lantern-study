/**
 * Offline bundles are shared storage between web and mobile, and the two write
 * different question shapes. A cloud bundle — a web-created one, or a
 * marketplace question bank delivered to a buyer — arrives web-shaped
 * ({questionStem, options:[{id,text}], correctAnswerIds}) while the mobile test
 * runner reads {stem, options:[{text,isCorrect}]}.
 *
 * Regression: purchased question banks opened with an empty stem and no
 * options because the cloud path cast instead of converting.
 */
import { offlineQuestionsToTestQuestions } from '../utils/questionHelpers';
// The SHIPPED mapper, not a copy of it. This file used to mirror
// offlineStore's private version, so it stayed green while the real one
// dropped every option's text (build 172).
import { normalizeOfflineBundleQuestion as mapMessageToOfflineQuestion } from '../utils/offlineQuestionShape';

const WEB_SHAPED = {
  id: 'q1',
  type: 'QUESTION',
  questionStem: 'What is the capital of Nigeria?',
  questionType: 'multiple_choice_single',
  options: [
    { id: 'o1', text: 'Lagos' },
    { id: 'o2', text: 'Abuja' },
  ],
  correctAnswerIds: ['o2'],
  tags: ['Geography'],
};

const MOBILE_SHAPED = {
  id: 'q2',
  stem: 'Nigeria has how many states?',
  type: 'mcq-single',
  options: [
    { id: 'a', text: '36', isCorrect: true },
    { id: 'b', text: '30', isCorrect: false },
  ],
  tags: [],
};

describe('cloud offline bundle question shapes', () => {
  it('converts a web-shaped question into a playable test question', () => {
    const normalized = [mapMessageToOfflineQuestion(WEB_SHAPED, 0)!];
    const [q] = offlineQuestionsToTestQuestions(normalized as any);

    expect(q.question).toBe('What is the capital of Nigeria?');
    expect(q.options).toEqual(['Lagos', 'Abuja']);
    expect(q.correctAnswer).toBe('Abuja');
  });

  it('still handles a mobile-shaped question', () => {
    const normalized = [mapMessageToOfflineQuestion(MOBILE_SHAPED, 0)!];
    const [q] = offlineQuestionsToTestQuestions(normalized as any);

    expect(q.question).toBe('Nigeria has how many states?');
    expect(q.correctAnswer).toBe('36');
  });

  it('rebuilds playable matching pairs from the web Message structures', () => {
    const WEB_MATCHING = {
      id: 'q3',
      type: 'QUESTION',
      questionStem: 'Match the capital to the country',
      questionType: 'matching',
      matchingPromptItems: [
        { id: 'p1', text: 'Nigeria' },
        { id: 'p2', text: 'Ghana' },
      ],
      matchingAnswerItems: [
        { id: 'a1', text: 'Abuja' },
        { id: 'a2', text: 'Accra' },
      ],
      correctMatches: [
        { promptItemId: 'p1', answerItemId: 'a1' },
        { promptItemId: 'p2', answerItemId: 'a2' },
      ],
      tags: [],
    };

    const normalized = [mapMessageToOfflineQuestion(WEB_MATCHING, 0)!];
    const [q] = offlineQuestionsToTestQuestions(normalized as any);

    expect(q.question).toBe('Match the capital to the country');
    expect(q.matchingPairs).toEqual([
      { id: 'p1', left: 'Nigeria', right: 'Abuja' },
      { id: 'p2', left: 'Ghana', right: 'Accra' },
    ]);
  });

  it('keeps fill-in-blank answers so grading works', () => {
    const WEB_FILL = {
      id: 'q4',
      type: 'QUESTION',
      questionStem: 'The sex of Michael is ___?',
      questionType: 'fill_in_the_blank',
      acceptableAnswers: ['Male', 'male'],
      tags: [],
    };

    const normalized = [mapMessageToOfflineQuestion(WEB_FILL, 0)!];
    const [q] = offlineQuestionsToTestQuestions(normalized as any);

    expect(q.correctAnswer).toBe('Male');
    expect(q.keywords).toEqual(['Male', 'male']);
  });

  it('drops entries with no stem rather than rendering a blank question', () => {
    expect(mapMessageToOfflineQuestion({ id: 'x', type: 'QUESTION' }, 0)).toBeNull();
  });
});
