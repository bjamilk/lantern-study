import {
  MessageType,
  QuestionStatus,
  QuestionType,
  type Message,
  type User,
} from '../types';
import {
  getQuestionVerificationThreshold,
  isQuestionTestable,
  isQuestionVoteBalanceAcceptable,
  normalizeStoredUserAnswer,
  normalizeTestQuestionForSession,
  normalizeTestResultSession,
  checkAnswerIsCorrect,
  resolveQuestionStatusAfterVote,
  createShuffledQuestionSet,
  shuffleQuestionOptionsOnly,
} from './testHelpers';

function baseQuestion(overrides: Partial<Message> = {}): Message {
  return {
    id: 'q1',
    groupId: 'g1',
    sender: { id: 'u1', name: 'User', points: 0, stats: {} as User['stats'], badges: [] },
    timestamp: new Date(),
    type: MessageType.QUESTION,
    questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
    questionStem: 'What is 2+2?',
    options: [{ id: 'a', text: '4' }],
    correctAnswerIds: ['a'],
    questionStatus: QuestionStatus.VERIFIED,
    upvotes: 2,
    downvotes: 0,
    ...overrides,
  };
}

describe('resolveQuestionStatusAfterVote', () => {
  it('returns REJECTED when downvotes exceed upvotes', () => {
    expect(
      resolveQuestionStatusAfterVote({ upvotes: 3, downvotes: 4, memberCount: 10 })
    ).toBe(QuestionStatus.REJECTED);
  });

  it('returns VERIFIED when upvotes meet 20% threshold and downvotes do not win', () => {
    expect(
      resolveQuestionStatusAfterVote({ upvotes: 2, downvotes: 1, memberCount: 10 })
    ).toBe(QuestionStatus.VERIFIED);
  });

  it('returns PENDING when below threshold', () => {
    expect(
      resolveQuestionStatusAfterVote({ upvotes: 1, downvotes: 0, memberCount: 10 })
    ).toBe(QuestionStatus.PENDING);
  });
});

describe('getQuestionVerificationThreshold', () => {
  it('uses ceil of 20% members', () => {
    expect(getQuestionVerificationThreshold(10)).toBe(2);
    expect(getQuestionVerificationThreshold(5)).toBe(1);
  });
});

describe('isQuestionTestable', () => {
  it('rejects PENDING questions', () => {
    expect(
      isQuestionTestable(baseQuestion({ questionStatus: QuestionStatus.PENDING }))
    ).toBe(false);
  });

  it('rejects VERIFIED when downvotes exceed upvotes', () => {
    expect(
      isQuestionTestable(
        baseQuestion({ questionStatus: QuestionStatus.VERIFIED, upvotes: 2, downvotes: 3 })
      )
    ).toBe(false);
  });

  it('accepts VERIFIED with acceptable vote balance', () => {
    expect(isQuestionTestable(baseQuestion())).toBe(true);
  });

  it('rejects REJECTED status', () => {
    expect(
      isQuestionTestable(baseQuestion({ questionStatus: QuestionStatus.REJECTED }))
    ).toBe(false);
  });
});

describe('isQuestionVoteBalanceAcceptable', () => {
  it('allows equal votes', () => {
    expect(isQuestionVoteBalanceAcceptable({ upvotes: 2, downvotes: 2 })).toBe(true);
  });

  it('rejects when downvotes are higher', () => {
    expect(isQuestionVoteBalanceAcceptable({ upvotes: 1, downvotes: 2 })).toBe(false);
  });
});

describe('normalizeStoredUserAnswer', () => {
  it('maps snake_case is_correct to isCorrect', () => {
    const answer = normalizeStoredUserAnswer({ questionId: 'q1', is_correct: true });
    expect(answer.isCorrect).toBe(true);
  });
});

describe('normalizeTestResultSession', () => {
  it('coerces legacy array user_answers into a questionId map for review', () => {
    const { userAnswers } = normalizeTestResultSession({
      questions: [
        {
          id: 'q1',
          questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
          questionStem: 'Pick 4',
          options: [
            { id: 'a', text: '4' },
            { id: 'b', text: '5' },
          ],
          correctAnswerIds: ['a'],
        },
        {
          id: 'q2',
          questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
          questionStem: 'Pick 5',
          options: [
            { id: 'a', text: '4' },
            { id: 'b', text: '5' },
          ],
          correctAnswerIds: ['b'],
        },
      ],
      user_answers: [
        { questionId: 'q1', selectedOptionIds: ['a'], timeSpentSeconds: 12 },
        { selectedOptionIds: ['a'], timeSpentSeconds: 8 }, // index-fallback → q2
      ],
    });
    expect(userAnswers.q1?.isCorrect).toBe(true);
    expect(userAnswers.q2?.isCorrect).toBe(false);
    expect(userAnswers.q1?.timeSpentSeconds).toBe(12);
  });

  it('recomputes correctness from correct_answer_ids when isCorrect is missing', () => {
    const { userAnswers } = normalizeTestResultSession({
      questions: [
        {
          id: 'q1',
          questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
          questionStem: 'Pick 4',
          options: [{ id: 'a', text: '4' }],
          correct_answer_ids: ['a'],
        },
      ],
      userAnswers: {
        q1: { questionId: 'q1', selectedOptionIds: ['a'] },
      },
    });
    expect(userAnswers.q1?.isCorrect).toBe(true);
  });

  it('recomputes correctness when stored isCorrect is false but answer matches', () => {
    const question = {
      id: 'q1',
      questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
      questionStem: 'Pick 4',
      options: [{ id: 'a', text: '4' }],
      correctAnswerIds: ['a'],
    };
    const answer = normalizeStoredUserAnswer({
      questionId: 'q1',
      selectedOptionIds: ['a'],
      isCorrect: false,
    });
    const normalizedQ = normalizeTestQuestionForSession(question, 0);
    expect(checkAnswerIsCorrect(normalizedQ, answer)).toBe(true);
  });
});

describe('createShuffledQuestionSet / shuffleQuestionOptionsOnly (Shuffle options setting)', () => {
  const fourOptionQuestion = (id: string): Message =>
    baseQuestion({
      id,
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
        { id: 'd', text: 'D' },
      ],
      correctAnswerIds: ['c'],
    });

  it('keeps option order when shuffleOptions is false', () => {
    const set = createShuffledQuestionSet([fourOptionQuestion('q1')], { shuffleOptions: false });
    expect(set[0]!.options!.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('preserves the option set and the correct answer regardless of shuffling', () => {
    const [q] = createShuffledQuestionSet([fourOptionQuestion('q1')], { shuffleOptions: true });
    expect([...q!.options!.map((o) => o.id)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(q!.correctAnswerIds).toEqual(['c']);
  });

  it('shuffleQuestionOptionsOnly keeps question order but re-numbers sequentially', () => {
    const input = [fourOptionQuestion('q1'), fourOptionQuestion('q2'), fourOptionQuestion('q3')];
    const out = shuffleQuestionOptionsOnly(input);
    expect(out.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(out.map((q) => q.questionNumber)).toEqual([1, 2, 3]);
    // Options are permuted in place; the set of ids is unchanged.
    expect([...out[0]!.options!.map((o) => o.id)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
