import {
  buildAnalysisFromAttempt,
  buildRecentTestFromSessionDetail,
  isAnswerAttempted,
  resolveQuestionStatus,
} from './testAnalysisHelpers';
import type { TestAttempt } from '../stores/testStore';

describe('isAnswerAttempted / resolveQuestionStatus', () => {
  it('treats legacy isCorrect boolean as attempted when option ids are missing', () => {
    expect(isAnswerAttempted({ isCorrect: true })).toBe(true);
    expect(isAnswerAttempted({ isCorrect: false })).toBe(true);
    expect(isAnswerAttempted({ is_correct: true })).toBe(true);
    expect(resolveQuestionStatus({ isCorrect: true })).toBe('correct');
    expect(resolveQuestionStatus({ isCorrect: false })).toBe('incorrect');
    expect(resolveQuestionStatus(null)).toBe('unattempted');
  });

  it('treats selectedOptionIds as attempted', () => {
    expect(isAnswerAttempted({ selectedOptionIds: ['a'], isCorrect: true })).toBe(true);
    expect(resolveQuestionStatus({ selectedOptionIds: ['a'], isCorrect: false })).toBe(
      'incorrect'
    );
  });
});

describe('buildAnalysisFromAttempt', () => {
  it('uses per-question timeSpentSeconds for bar heights', () => {
    const attempt = {
      id: 'a1',
      testId: 't1',
      testName: 'Mock',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:10:00.000Z',
      score: 10,
      totalPoints: 20,
      percentage: 50,
      passed: false,
      timeSpent: 90,
      answers: [
        {
          questionId: 'q1',
          userAnswer: 'A',
          isCorrect: true,
          points: 10,
          questionText: 'First?',
          timeSpentSeconds: 12,
          tags: ['Anatomy'],
        },
        {
          questionId: 'q2',
          userAnswer: 'B',
          isCorrect: false,
          points: 0,
          questionText: 'Second?',
          timeSpentSeconds: 45,
          tags: ['Anatomy'],
        },
      ],
    } as TestAttempt;

    const analysis = buildAnalysisFromAttempt(attempt);
    expect(analysis.timePerQuestion.map((q) => q.time)).toEqual([12, 45]);
    expect(analysis.correctCount).toBe(1);
    expect(analysis.incorrectCount).toBe(1);
    expect(analysis.timePerTag[0]?.avgTime).toBe(29);
  });

  it('falls back to even session timing when timeSpentSeconds is sparse', () => {
    const attempt = {
      id: 'a2',
      testId: 't1',
      testName: 'Mock',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:02:00.000Z',
      score: 10,
      totalPoints: 20,
      percentage: 50,
      passed: false,
      timeSpent: 60,
      answers: [
        {
          questionId: 'q1',
          userAnswer: 'A',
          isCorrect: true,
          points: 10,
          questionText: 'First?',
          tags: ['General'],
        },
        {
          questionId: 'q2',
          isCorrect: false,
          points: 0,
          questionText: 'Second?',
          tags: ['General'],
        },
      ],
    } as TestAttempt;

    const analysis = buildAnalysisFromAttempt(attempt);
    expect(analysis.timePerQuestion).toHaveLength(2);
    expect(analysis.timePerQuestion.every((q) => q.time > 0)).toBe(true);
    expect(analysis.timePerQuestion[0].stem).toContain('First');
    expect(analysis.correctCount).toBe(1);
    expect(analysis.incorrectCount).toBe(1);
  });
});

describe('buildRecentTestFromSessionDetail', () => {
  it('builds chart bars from full session detail', () => {
    const recent = buildRecentTestFromSessionDetail(
      {
        id: 'sess-1',
        start_time: '2026-01-01T00:00:00.000Z',
        end_time: '2026-01-01T00:05:00.000Z',
        score: 50,
        config: { groupName: 'PHM 101' },
        questions: [
          {
            id: 'q1',
            questionNumber: 1,
            questionStem: 'What is osmosis?',
            questionType: 'multiple_choice_single',
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correctAnswerIds: ['a'],
            tags: ['Physio'],
          },
          {
            id: 'q2',
            questionNumber: 2,
            questionStem: 'What is diffusion?',
            questionType: 'multiple_choice_single',
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correctAnswerIds: ['a'],
            tags: ['Physio'],
          },
        ],
        user_answers: {
          q1: { selectedOptionIds: ['a'], isCorrect: true, timeSpentSeconds: 20 },
          q2: { selectedOptionIds: ['b'], isCorrect: false, timeSpentSeconds: 40 },
        },
      },
      { id: 'sess-1', groupName: 'PHM 101', score: 1, totalQuestions: 2, percentage: 50, completedAt: '', timeSpent: 60 }
    );

    expect(recent.analysis.timePerQuestion).toHaveLength(2);
    expect(recent.analysis.timePerQuestion[0].time).toBe(20);
    expect(recent.analysis.timePerQuestion[1].time).toBe(40);
    expect(recent.analysis.timePerQuestion[0].stem).toContain('osmosis');
    expect(recent.analysis.correctCount).toBe(1);
    expect(recent.analysis.incorrectCount).toBe(1);
  });

  it('handles real API shape: questionStem + selectedOptionIds + array user_answers', () => {
    const recent = buildRecentTestFromSessionDetail({
      id: 'sess-2',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:04:00.000Z',
      score: 50,
      config: { groupName: 'CHEM 201' },
      questions: [
        {
          id: 'q1',
          questionNumber: 1,
          questionStem: 'Select the correct pH range',
          questionType: 'multiple_choice_single',
          options: [
            { id: 'a', text: '0-7' },
            { id: 'b', text: '7-14' },
          ],
          correctAnswerIds: ['a'],
          tags: ['AcidBase'],
        },
        {
          id: 'q2',
          questionNumber: 2,
          questionStem: 'What is molarity?',
          questionType: 'multiple_choice_single',
          options: [
            { id: 'a', text: 'moles/L' },
            { id: 'b', text: 'grams/L' },
          ],
          correctAnswerIds: ['a'],
          tags: ['Solutions'],
        },
      ],
      // Legacy submit stored Object.values(...) as a JSON array
      user_answers: [
        {
          questionId: 'q1',
          selectedOptionIds: ['a'],
          isCorrect: true,
          timeSpentSeconds: 18,
        },
        {
          questionId: 'q2',
          selectedOptionIds: ['b'],
          isCorrect: false,
          timeSpentSeconds: 33,
        },
      ],
    });

    expect(recent.analysis.timePerQuestion).toHaveLength(2);
    expect(recent.analysis.timePerQuestion[0].stem).toContain('pH');
    expect(recent.analysis.timePerQuestion[1].stem).toContain('molarity');
    expect(recent.analysis.timePerQuestion.map((q) => q.time)).toEqual([18, 33]);
    expect(recent.analysis.correctCount).toBe(1);
    expect(recent.analysis.incorrectCount).toBe(1);
    expect(recent.analysis.unattemptedCount).toBe(0);
  });

  it('estimates bar heights when timeSpentSeconds is missing but answers exist', () => {
    const recent = buildRecentTestFromSessionDetail({
      id: 'sess-3',
      start_time: '2026-01-01T00:00:00.000Z',
      end_time: '2026-01-01T00:03:00.000Z',
      questions: [
        {
          id: 'q1',
          questionStem: 'Alpha?',
          questionType: 'multiple_choice_single',
          options: [{ id: 'x', text: 'X' }],
          correctAnswerIds: ['x'],
          tags: ['A'],
        },
        {
          id: 'q2',
          questionStem: 'Beta?',
          questionType: 'multiple_choice_single',
          options: [{ id: 'y', text: 'Y' }],
          correctAnswerIds: ['y'],
          tags: ['B'],
        },
      ],
      userAnswers: {
        q1: { selectedOptionIds: ['x'], isCorrect: true },
        // Legacy row: graded boolean only, no option ids
        q2: { isCorrect: false },
      },
    });

    expect(recent.analysis.timePerQuestion).toHaveLength(2);
    expect(recent.analysis.timePerQuestion.every((q) => q.time > 0)).toBe(true);
    expect(recent.analysis.timePerQuestion[0].stem).toContain('Alpha');
    expect(recent.analysis.correctCount).toBe(1);
    // Legacy isCorrect-only rows still count as attempted (incorrect) on web/mobile.
    expect(recent.analysis.incorrectCount).toBe(1);
  });
});
