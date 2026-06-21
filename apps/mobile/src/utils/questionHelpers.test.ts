import {
  groupMessageToTestQuestion,
  resolveOptionText,
  resolveCorrectAnswerLabel,
  formatCorrectAnswerDisplay,
} from './questionHelpers';
import type { TestQuestion } from '../stores/testStore';

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
