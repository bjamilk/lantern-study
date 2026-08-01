import { describe, expect, it, vi, afterEach } from 'vitest';
import { toPausedSummary } from '../../../utils/sessionDraftSync';
import type { TestSessionData } from '../../../types';

describe('toPausedSummary', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a lean summary from a drafted session', () => {
    const session: TestSessionData = {
      id: 's1',
      config: {
        groupId: 'g1',
        groupName: 'Chem',
        numberOfQuestions: 2,
        questionIds: ['a', 'b'],
        allowedQuestionTypes: [],
      },
      questions: [{ id: 'a' } as any, { id: 'b' } as any],
      userAnswers: { a: { questionId: 'a' } },
      currentQuestionIndex: 1,
      startTime: new Date('2026-08-11T10:00:00.000Z'),
      remainingTime: 300,
      sessionKind: 'test',
      title: 'Chem',
    };

    expect(toPausedSummary(session, 'test', 'paused')).toMatchObject({
      id: 's1',
      sessionKind: 'test',
      status: 'paused',
      title: 'Chem',
      answeredCount: 1,
      totalQuestions: 2,
      currentQuestionIndex: 1,
      remainingTimeSeconds: 300,
      groupId: 'g1',
    });
  });

  it('derives remainingTimeSeconds from endTime when remainingTime is unset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const session: TestSessionData = {
      id: 's2',
      config: {
        groupId: 'g1',
        numberOfQuestions: 1,
        questionIds: ['a'],
        allowedQuestionTypes: [],
        timerDuration: 600,
      },
      questions: [{ id: 'a' } as any],
      userAnswers: {},
      currentQuestionIndex: 0,
      startTime: new Date('2026-07-31T18:00:00.000Z'),
      endTime: new Date('2026-07-31T18:10:00.000Z'),
      sessionKind: 'test',
    };

    expect(toPausedSummary(session, 'test', 'paused')?.remainingTimeSeconds).toBe(600);
  });

  it('returns null without a server id', () => {
    const session: TestSessionData = {
      config: {
        groupId: 'g1',
        numberOfQuestions: 1,
        questionIds: ['a'],
        allowedQuestionTypes: [],
      },
      questions: [],
      userAnswers: {},
      currentQuestionIndex: 0,
      startTime: new Date(),
    };
    expect(toPausedSummary(session, 'study')).toBeNull();
  });
});
