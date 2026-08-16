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

// Mirrors mapMessageToOfflineQuestion in offlineStore (not exported).
function mapMessageToOfflineQuestion(message: any, index: number) {
  const payload = message.question || message.questionData || message;
  const stem = payload.questionStem || payload.stem || message.text || message.content;
  if (!stem) return null;
  const rawOptions = payload.options || [];
  const options = Array.isArray(rawOptions)
    ? rawOptions.map((opt: any, i: number) => ({
        id: String(opt.id ?? `opt-${i}`),
        text: String(opt.text ?? ''),
        isCorrect: Boolean(opt.isCorrect ?? payload.correctAnswerIds?.includes?.(opt.id)),
      }))
    : [];
  return {
    id: String(message.id ?? `q-${index}`),
    stem: String(stem),
    type: String(payload.questionType || payload.type || 'mcq-single'),
    options,
    tags: payload.tags || message.tags || [],
  };
}

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

  it('drops entries with no stem rather than rendering a blank question', () => {
    expect(mapMessageToOfflineQuestion({ id: 'x', type: 'QUESTION' }, 0)).toBeNull();
  });
});
