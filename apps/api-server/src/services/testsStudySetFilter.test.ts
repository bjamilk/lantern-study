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
const capturedEq: Array<[string, unknown]> = [];
let rows: any[] = [];
let rowCount = 0;
let rangeError: { code?: string; message?: string } | null = null;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
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
            if (prop === 'eq') {
              return (column: string, value: unknown) => {
                capturedEq.push([column, value]);
                return builder;
              };
            }
            if (prop === 'range') {
              return async () => ({ data: rows, error: rangeError, count: rowCount });
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  }),
}));

import { setSchemaCapabilities } from './schemaCapabilities';
import { createDataLayer } from './data';
import { createDataClient } from './data/client';

/**
 * "Tests in this set" has to be one query.
 *
 * The route used to ask for one page of every test the user owned and then
 * filter that page by study set in JavaScript, reporting `total: filed.length`
 * and `hasMore: false`. A set whose tests were not among the newest 20 showed
 * none of them, the count on screen described the accident of that page, and
 * there was no second page to ask for. These tests pin the filter to the query
 * and the totals to the database's own count.
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

const sessionRow = (id: string) => ({
  id,
  start_time: '2026-09-01T10:00:00.000Z',
  end_time: '2026-09-01T10:30:00.000Z',
  status: 'completed',
  session_kind: 'test',
  config: {},
  study_set_id: 'set-1',
  user_answers: {},
  test_results: [{ score: 80, correct_answers_count: 4, total_questions: 5 }],
});

afterEach(() => {
  setSchemaCapabilities({ practiceFolders: null });
});

const eqFor = (column: string) => capturedEq.filter(([name]) => name === column);

describe('getUserTests · study set filter', () => {
  beforeEach(() => {
  // `getUserTests` asks whether `test_sessions.practice_folder_id` exists
  // before it builds the select (20260918120000 is hand-applied). Forcing the
  // answer is what `setSchemaCapabilities` is for: this scripted database has
  // no probe to serve, and an unforced probe would issue a `select("id")` of
  // its own that the capture below would read as the list query's.
  setSchemaCapabilities({ practiceFolders: true });
    capturedSelect.length = 0;
    capturedEq.length = 0;
    rows = [];
    rowCount = 0;
    rangeError = null;
  });

  it('filters in the query rather than after the fetch', async () => {
    rows = [sessionRow('t1')];
    rowCount = 1;
    await service().getUserTests('user-1', { studySetId: 'set-1' });
    expect(eqFor('study_set_id')).toEqual([['study_set_id', 'set-1']]);
  });

  it('leaves the query alone when no set is asked for', async () => {
    rows = [sessionRow('t1')];
    rowCount = 1;
    await service().getUserTests('user-1', {});
    expect(eqFor('study_set_id')).toEqual([]);
  });

  it('reports the database count, not the size of the page it fetched', async () => {
    // The defect: 57 tests in the set, 20 on this page — total used to say 20
    // and hasMore used to say false, stranding the other 37.
    rows = Array.from({ length: 20 }, (_, i) => sessionRow(`t${i}`));
    rowCount = 57;
    const result = await service().getUserTests('user-1', {
      studySetId: 'set-1',
      page: 1,
      limit: 20,
    });
    expect(result.tests).toHaveLength(20);
    expect(result.total).toBe(57);
  });

  it('pages honestly: later pages still carry the filter and the same total', async () => {
    rows = Array.from({ length: 17 }, (_, i) => sessionRow(`t${i}`));
    rowCount = 57;
    const result = await service().getUserTests('user-1', {
      studySetId: 'set-1',
      page: 3,
      limit: 20,
    });
    expect(eqFor('study_set_id')).toEqual([['study_set_id', 'set-1']]);
    expect(result.total).toBe(57);
    expect(result.tests).toHaveLength(17);
  });

  it('projects study_set_id on a lean read, but only when it is being filtered', async () => {
    rows = [sessionRow('t1')];
    rowCount = 1;
    await service().getUserTests('user-1', { studySetId: 'set-1', lean: true });
    expect(capturedSelect[0]).toContain('study_set_id');

    capturedSelect.length = 0;
    await service().getUserTests('user-1', { lean: true });
    expect(capturedSelect[0]).not.toContain('study_set_id');
  });

  it('answers empty — never the whole archive — when the column is not there yet', async () => {
    rangeError = { code: '42703', message: 'column test_sessions.study_set_id does not exist' };
    const result = await service().getUserTests('user-1', { studySetId: 'set-1' });
    expect(result).toEqual({ tests: [], total: 0 });
  });

  it('still filters on the highestScore fallback path', async () => {
    rangeError = { code: 'PGRST100', message: 'failed to parse order (test_results.score)' };
    rowCount = 0;
    await service()
      .getUserTests('user-1', { studySetId: 'set-1', sort: 'highestScore' })
      .catch(() => undefined);
    // Once for the ordered attempt, once for the retry.
    expect(eqFor('study_set_id')).toEqual([
      ['study_set_id', 'set-1'],
      ['study_set_id', 'set-1'],
    ]);
  });
});
