import {
  buildAnalysisFromAttempt,
  buildRecentTestFromSessionDetail,
} from './testAnalysisHelpers';
import type { TestAttempt } from '../stores/testStore';

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
});

describe('buildRecentTestFromSessionDetail', () => {
  it('builds chart bars from full session detail', () => {
    const recent = buildRecentTestFromSessionDetail(
      {
        id: 'sess-1',
        start_time: '2026-01-01T00:00:00.000Z',
        end_time: '2026-01-01T00:05:00.000Z',
        score: 100,
        config: { groupName: 'PHM 101' },
        questions: [
          {
            id: 'q1',
            questionNumber: 1,
            question: 'What is osmosis?',
            tags: ['Physio'],
          },
          {
            id: 'q2',
            questionNumber: 2,
            question: 'What is diffusion?',
            tags: ['Physio'],
          },
        ],
        user_answers: {
          q1: { answer: 'A', isCorrect: true, timeSpentSeconds: 20 },
          q2: { answer: 'B', isCorrect: false, timeSpentSeconds: 40 },
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
});
