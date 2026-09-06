import {
  groupMessageToTestQuestion,
  resolveOptionText,
  resolveCorrectAnswerLabel,
  formatCorrectAnswerDisplay,
  canonicalOfflineQuestionType,
  matchesOfflineQuestionTypeFilter,
  normalizeApiQuestions,
  restoreMatchingAnswerMap,
} from './questionHelpers';
import { normalizeTestQuestionForSession } from '@lantern/shared/utils/testHelpers';
import type { TestQuestion } from '../stores/testStore';

describe('offline question type normalize', () => {
  it('maps kebab UI filters and API enums to the same canonical type', () => {
    expect(canonicalOfflineQuestionType('mcq-single')).toBe('multiple_choice_single');
    expect(canonicalOfflineQuestionType('MULTIPLE_CHOICE_SINGLE')).toBe('multiple_choice_single');
  });

  it('accepts MULTIPLE_CHOICE_SINGLE when options include mcq-single', () => {
    expect(matchesOfflineQuestionTypeFilter('MULTIPLE_CHOICE_SINGLE', ['mcq-single'])).toBe(true);
    expect(matchesOfflineQuestionTypeFilter('multiple_choice_single', ['mcq-single'])).toBe(true);
    expect(matchesOfflineQuestionTypeFilter('TRUE_FALSE', ['mcq-single'])).toBe(false);
  });
});

describe('resolveOptionText', () => {
  it('maps semantic true/false ids to labels', () => {
    expect(resolveOptionText(['True', 'False'], undefined, 'true')).toBe('True');
    expect(resolveOptionText(['True', 'False'], undefined, 'FALSE')).toBe('False');
  });

  it('maps UUID option ids via optionItems', () => {
    const items = [
      { id: 'abc-uuid-true', text: 'True' },
      { id: 'abc-uuid-false', text: 'False' },
    ];
    expect(resolveOptionText(['True', 'False'], items, 'abc-uuid-true')).toBe('True');
    expect(resolveOptionText(['True', 'False'], items, 'abc-uuid-false')).toBe('False');
  });

  it('maps mobile QuestionModal ids 1 and 2 via optionItems', () => {
    const items = [
      { id: '1', text: 'True' },
      { id: '2', text: 'False' },
    ];
    expect(resolveOptionText(['True', 'False'], items, '1')).toBe('True');
    expect(resolveOptionText(['True', 'False'], items, '2')).toBe('False');
  });
});

describe('groupMessageToTestQuestion true_false', () => {
  it('resolves correct answer from optionItems instead of raw id', () => {
    const question = groupMessageToTestQuestion({
      id: 'q1',
      type: 'question',
      text: 'The sky is blue',
      questionStem: 'The sky is blue',
      questionType: 'TRUE_FALSE',
      options: ['True', 'False'],
      optionItems: [
        { id: '9f3a1c2b-1111-2222-3333-444455556666', text: 'True' },
        { id: '9f3a1c2b-7777-8888-9999-000011112222', text: 'False' },
      ],
      correctAnswerIds: ['9f3a1c2b-1111-2222-3333-444455556666'],
      createdAt: new Date().toISOString(),
      groupId: 'g1',
      senderId: 'u1',
      senderName: 'User',
    });

    expect(question.type).toBe('true_false');
    expect(question.correctAnswer).toBe('True');
    expect(formatCorrectAnswerDisplay(question)).toBe('True');
  });
});

describe('resolveCorrectAnswerLabel', () => {
  it('re-resolves stored id snapshots for display', () => {
    const question: TestQuestion = {
      id: 'q1',
      type: 'true_false',
      question: 'Sample',
      options: ['True', 'False'],
      optionItems: [
        { id: '1', text: 'True' },
        { id: '2', text: 'False' },
      ],
      correctAnswer: '2',
      points: 10,
    };

    expect(resolveCorrectAnswerLabel(question)).toBe('False');
  });
});

describe('normalizeApiQuestions — session round-trip', () => {
  // What a session/draft row actually stores: the MESSAGE type in `type`
  // ("QUESTION") and the real question type in `questionType`.
  const sessionMatching = {
    id: 'q-match',
    type: 'QUESTION',
    questionType: 'MATCHING',
    questionStem: 'The meaning of life is which matching',
    matchingPromptItems: [
      { id: 'p1', text: 'Alpha' },
      { id: 'p2', text: 'Beta' },
    ],
    matchingAnswerItems: [
      { id: 'p1-ans', text: 'First' },
      { id: 'p2-ans', text: 'Second' },
    ],
    correctMatches: [
      { promptItemId: 'p1', answerItemId: 'p1-ans' },
      { promptItemId: 'p2', answerItemId: 'p2-ans' },
    ],
  };

  it('keeps a matching question matching instead of a blank Multiple Choice card', () => {
    const [q] = normalizeApiQuestions([sessionMatching]);
    expect(q.type).toBe('matching');
    expect(q.matchingPairs).toEqual([
      { id: 'p1', left: 'Alpha', right: 'First' },
      { id: 'p2', left: 'Beta', right: 'Second' },
    ]);
  });

  it('keeps a stored multiple-choice question answerable', () => {
    const [q] = normalizeApiQuestions([
      {
        id: 'q-mcq',
        type: 'QUESTION',
        questionType: 'MULTIPLE_CHOICE_SINGLE',
        questionStem: 'Pick one',
        options: [
          { id: '1', text: 'Alpha' },
          { id: '2', text: 'Beta' },
        ],
        correctAnswerIds: ['2'],
      },
    ]);
    expect(q.type).toBe('multiple_choice_single');
    expect(q.options).toEqual(['Alpha', 'Beta']);
    expect(q.correctAnswer).toBe('Beta');
  });

  it('keeps a diagram question a diagram', () => {
    const [q] = normalizeApiQuestions([
      {
        id: 'q-diagram',
        type: 'QUESTION',
        questionType: 'DIAGRAM_LABELING',
        questionStem: 'Label it',
        imageUrl: 'https://example.test/diagram.png',
        diagramLabels: [{ id: 'l1', text: 'Nucleus', x: 10, y: 20 }],
      },
    ]);
    expect(q.type).toBe('diagram_labeling');
    expect(q.diagramLabels).toEqual([{ id: 'l1', label: 'Nucleus', x: 10, y: 20 }]);
  });

  it('restores a fill-in-the-blank answer so grading has something to compare', () => {
    const [q] = normalizeApiQuestions([
      {
        id: 'q-fill',
        type: 'QUESTION',
        questionType: 'FILL_IN_THE_BLANK',
        questionStem: 'The capital is ___',
        acceptableAnswers: ['Accra', 'accra'],
      },
    ]);
    expect(q.type).toBe('fill_in_blank');
    expect(q.correctAnswer).toBe('Accra');
    expect(q.keywords).toEqual(['Accra', 'accra']);
  });

  it('still reads a mobile-shaped question, which carries its type in `type`', () => {
    const [q] = normalizeApiQuestions([
      { id: 'q-mobile', type: 'true_false', question: 'Yes?', options: ['True', 'False'] },
    ]);
    expect(q.type).toBe('true_false');
  });

  it('survives a real normalizeTestQuestionForSession round-trip', () => {
    const [restored] = normalizeApiQuestions([
      normalizeTestQuestionForSession(
        {
          id: 'q-match',
          type: 'matching',
          question: 'Match them',
          matchingPairs: [
            { id: 'a', left: 'Alpha', right: 'First' },
            { id: 'b', left: 'Beta', right: 'Second' },
          ],
        },
        0
      ) as unknown as Record<string, unknown>,
    ]);
    expect(restored.type).toBe('matching');
    expect(restored.matchingPairs?.map(p => [p.left, p.right])).toEqual([
      ['Alpha', 'First'],
      ['Beta', 'Second'],
    ]);
  });
});

describe('restoreMatchingAnswerMap', () => {
  const stored = {
    id: 'q-match',
    matchingPromptItems: [
      { id: 'p1', text: 'Alpha' },
      { id: 'p2', text: 'Beta' },
    ],
    matchingAnswerItems: [
      { id: 'a1', text: 'First' },
      { id: 'a2', text: 'Second' },
    ],
  };

  it('turns the draft\'s id pairs back into the board\'s text pairs', () => {
    expect(
      restoreMatchingAnswerMap(stored, [
        { promptItemId: 'p1', answerItemId: 'a2' },
        { promptItemId: 'p2', answerItemId: 'a1' },
      ])
    ).toEqual({ Alpha: 'Second', Beta: 'First' });
  });

  it('falls back to the ids when the item lists are missing', () => {
    expect(restoreMatchingAnswerMap({}, [{ promptItemId: 'p1', answerItemId: 'a1' }])).toEqual({
      p1: 'a1',
    });
  });

  it('is empty for a question with no saved matches', () => {
    expect(restoreMatchingAnswerMap(stored, undefined)).toEqual({});
  });
});
