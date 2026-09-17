/**
 * HARNESS (monolith lane M3, Phase B, PR 4): this suite used to construct a
 * real `SupabaseService`. The class is deleted in this PR; it drives the data
 * layer's own function instead. Every `it` title, every `expect` and every
 * fixture is unchanged.
 */
jest.mock('../services/cache', () => ({
  cacheService: {
    deletePattern: jest.fn(),
    delete: jest.fn(),
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    invalidateUserCache: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: jest.fn() }),
}));

import { createDataLayer } from './data';
import { createDataClient } from './data/client';

describe('mapTestSessionRowToClient', () => {
  it('maps draft columns into client session fields', () => {
    const svc = createDataLayer({
      client: createDataClient({
        url: 'https://example.supabase.co',
        serviceRoleKey: 'test-key',
      } as never),
      supabaseUrl: 'https://example.supabase.co',
    }).tests;

    const mapped = svc.mapTestSessionRowToClient({
      id: 'draft-1',
      user_id: 'user-1',
      config: { groupId: 'g1', groupName: 'Bio' },
      questions: [{ id: 'q1' }],
      user_answers: { q1: { questionId: 'q1' } },
      start_time: '2026-08-11T12:00:00.000Z',
      end_time: null,
      is_offline: false,
      status: 'paused',
      session_kind: 'study',
      current_question_index: 2,
      remaining_time_seconds: 120,
      title: 'Bio study',
      updated_at: '2026-08-11T12:30:00.000Z',
      paused_at: '2026-08-11T12:30:00.000Z',
    });

    expect(mapped).toMatchObject({
      id: 'draft-1',
      sessionKind: 'study',
      status: 'paused',
      currentQuestionIndex: 2,
      remainingTime: 120,
      title: 'Bio study',
      userId: 'user-1',
    });
    expect(mapped.userAnswers).toEqual({ q1: { questionId: 'q1' } });
    expect(mapped.startTime).toBeInstanceOf(Date);
  });

  it('coerces array user_answers so history hydrate keeps answers', () => {
    const svc = createDataLayer({
      client: createDataClient({
        url: 'https://example.supabase.co',
        serviceRoleKey: 'test-key',
      } as never),
      supabaseUrl: 'https://example.supabase.co',
    }).tests;

    const mapped = svc.mapTestSessionRowToClient({
      id: 'session-1',
      user_id: 'user-1',
      config: {},
      questions: [{ id: 'q1' }, { id: 'q2' }],
      user_answers: [
        { questionId: 'q1', selectedOptionIds: ['a'], isCorrect: true },
        { selectedOptionIds: ['b'], isCorrect: false },
      ],
      start_time: '2026-08-11T12:00:00.000Z',
      status: 'completed',
      session_kind: 'test',
    });

    expect(mapped.userAnswers).toEqual({
      q1: { questionId: 'q1', selectedOptionIds: ['a'], isCorrect: true },
      q2: { questionId: 'q2', selectedOptionIds: ['b'], isCorrect: false },
    });
  });
});
