import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  mergeDraftOntoSession,
  mergeUserAnswersPreferLocal,
  toPausedSummary,
} from '../../../utils/sessionDraftSync';
import type { TestSessionData } from '../../../types';

function baseSession(overrides: Partial<TestSessionData> = {}): TestSessionData {
  return {
    config: {
      groupId: 'g1',
      groupName: 'Chem',
      numberOfQuestions: 2,
      questionIds: ['a', 'b'],
      allowedQuestionTypes: [],
      timerDuration: 600,
    },
    questions: [{ id: 'a' } as any, { id: 'b' } as any],
    userAnswers: {},
    currentQuestionIndex: 0,
    startTime: new Date('2026-07-31T18:00:00.000Z'),
    endTime: new Date('2026-07-31T18:10:00.000Z'),
    sessionKind: 'test',
    status: 'in_progress',
    title: 'Chem',
    ...overrides,
  };
}

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

describe('mergeDraftOntoSession', () => {
  it('does not let a stale draft patch reset currentQuestionIndex or wipe newer answers', () => {
    const local = baseSession({
      id: 'draft-1',
      currentQuestionIndex: 1,
      userAnswers: {
        a: { questionId: 'a', selectedOptionIds: ['opt1'] },
        b: { questionId: 'b', selectedOptionIds: ['opt2'] },
      },
      endTime: new Date('2026-07-31T18:10:00.000Z'),
    });
    // Stale autosave snapshot still on Q0 with only Q1 answered
    const staleRemote = baseSession({
      id: 'draft-1',
      currentQuestionIndex: 0,
      userAnswers: {
        a: { questionId: 'a', selectedOptionIds: ['opt1'] },
      },
      endTime: undefined,
      updatedAt: '2026-07-31T18:00:01.000Z',
    });

    const merged = mergeDraftOntoSession(local, staleRemote, 'test', 'in_progress');

    expect(merged.currentQuestionIndex).toBe(1);
    expect(merged.userAnswers).toEqual(local.userAnswers);
    expect(merged.endTime).toEqual(local.endTime);
    expect(merged.id).toBe('draft-1');
    expect(merged.updatedAt).toBe('2026-07-31T18:00:01.000Z');
  });

  it('keeps local answers when binding a freshly created draft id', () => {
    const localDuringCreate = baseSession({
      currentQuestionIndex: 0,
      userAnswers: {
        a: { questionId: 'a', selectedOptionIds: ['x'] },
      },
    });
    const created = baseSession({
      id: 'server-draft',
      currentQuestionIndex: 0,
      userAnswers: {},
      endTime: undefined,
    });

    const merged = mergeDraftOntoSession(localDuringCreate, created, 'test', 'in_progress');
    expect(merged.id).toBe('server-draft');
    expect(merged.userAnswers.a?.selectedOptionIds).toEqual(['x']);
    expect(merged.endTime).toEqual(localDuringCreate.endTime);
  });

  it('merges userAnswers with local keys winning', () => {
    expect(
      mergeUserAnswersPreferLocal(
        { a: { questionId: 'a', fillText: 'local' }, b: { questionId: 'b', fillText: 'new' } },
        { a: { questionId: 'a', fillText: 'stale' }, c: { questionId: 'c', fillText: 'remote-only' } },
      ),
    ).toEqual({
      a: { questionId: 'a', fillText: 'local' },
      b: { questionId: 'b', fillText: 'new' },
      c: { questionId: 'c', fillText: 'remote-only' },
    });
  });
});
