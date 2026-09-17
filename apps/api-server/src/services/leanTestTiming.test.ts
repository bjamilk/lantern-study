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

const capturedSelect: string[] = [];
let rows: any[] = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      // Every builder method returns the same chainable stub; `range` resolves.
      const builder: any = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then') return undefined; // not a thenable
            if (prop === 'select') {
              return (cols: string) => {
                capturedSelect.push(cols);
                return builder;
              };
            }
            if (prop === 'range') {
              return async () => ({ data: rows, error: null, count: rows.length });
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  }),
}));

import { createDataLayer } from './data';
import { createDataClient } from './data/client';

/**
 * Server half of the "Avg / question" fix.
 *
 * Lean completed history omits user_answers to keep all-time pagination light,
 * but the dashboards derive question timing from exactly those records — so the
 * tile showed a dash on web, iOS and Android. getUserTests now folds the answers
 * into a sum and a count server-side and drops the raw map.
 *
 * These tests drive the real method and pin the field names and the numbers it
 * emits. The client half — normalizing those fields and dividing them into an
 * average — is pinned in packages/shared/src/utils/questionTimingParity.test.ts.
 * The two halves are tested separately because the shared package's server build
 * deliberately excludes the client-only dashboard builder.
 */
/**
 * HARNESS (monolith lane M3, Phase B, PR 4): this suite used to construct a
 * real `SupabaseService` over a mocked `@supabase/supabase-js`. The class is
 * deleted in this PR, so it builds the data layer over the same mocked client
 * instead — `createDataLayer` binds the same domain functions the facade
 * delegated to. Every `it` title, every `expect` and every fixture is
 * unchanged.
 */
const layer = () =>
  createDataLayer({
    client: createDataClient({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
    } as never),
    supabaseUrl: 'https://example.supabase.co',
  });

/** The one namespace this suite drives, under the name it already used. */
const service = () => ({ getUserTests: (...args: any[]) => (layer().tests.getUserTests as any)(...args) });

const sessionRow = (id: string, answers: Record<string, any>, startTime: string) => ({
  id,
  start_time: startTime,
  end_time: startTime,
  status: 'completed',
  session_kind: 'test',
  config: {},
  user_answers: answers,
  test_results: [{ score: 80, correct_answers_count: 4, total_questions: 5 }],
});

beforeEach(() => {
  capturedSelect.length = 0;
  rows = [];
});

describe('getUserTests — lean completed history', () => {
  it('reads user_answers so timing can be computed', async () => {
    rows = [sessionRow('t1', { q1: { timeSpentSeconds: 30 } }, '2026-01-01T00:00:00Z')];
    await service().getUserTests('user-1', { lean: true, status: 'completed' });

    expect(capturedSelect[0]).toContain('user_answers');
    // The heavy column stays out — that is what keeps the response lean.
    expect(capturedSelect[0]).not.toContain('questions,');
  });

  it('returns the timing aggregate and withholds the raw answers', async () => {
    rows = [
      sessionRow(
        't1',
        { q1: { timeSpentSeconds: 30 }, q2: { timeSpentSeconds: 50 } },
        '2026-01-01T00:00:00Z'
      ),
    ];

    const { tests } = await service().getUserTests('user-1', {
      lean: true,
      status: 'completed',
    });

    expect(tests[0]).toMatchObject({ timeSpentSeconds: 80, questionsWithTime: 2 });
    // The payload must stay lean: answers are summarised, never shipped.
    expect(tests[0].session.userAnswers).toEqual({});
  });

  it('counts only answers that carry a usable time', async () => {
    rows = [
      sessionRow(
        't1',
        {
          q1: { timeSpentSeconds: 40 },
          q2: {},
          q3: { timeSpentSeconds: null },
          q4: { timeSpentSeconds: 'twelve' },
        },
        '2026-01-01T00:00:00Z'
      ),
    ];

    const { tests } = await service().getUserTests('user-1', {
      lean: true,
      status: 'completed',
    });

    expect(tests[0]).toMatchObject({ timeSpentSeconds: 40, questionsWithTime: 1 });
  });

  it('reports zero rather than throwing when a session has no answers at all', async () => {
    rows = [sessionRow('t1', {}, '2026-01-01T00:00:00Z')];
    const { tests } = await service().getUserTests('user-1', {
      lean: true,
      status: 'completed',
    });
    expect(tests[0]).toMatchObject({ timeSpentSeconds: 0, questionsWithTime: 0 });
  });

  it('emits the aggregate on every row of a multi-test page', async () => {
    rows = [
      sessionRow(
        't1',
        { q1: { timeSpentSeconds: 30 }, q2: { timeSpentSeconds: 50 } },
        '2026-01-01T00:00:00Z'
      ),
      sessionRow(
        't2',
        { q1: { timeSpentSeconds: 20 }, q2: { timeSpentSeconds: 20 } },
        '2026-01-02T00:00:00Z'
      ),
    ];

    const { tests } = await service().getUserTests('user-1', {
      lean: true,
      status: 'completed',
    });

    // 120s over 4 questions once the client divides them — a 30s average.
    expect(tests.map((t: any) => [t.timeSpentSeconds, t.questionsWithTime])).toEqual([
      [80, 2],
      [40, 2],
    ]);
  });
});
