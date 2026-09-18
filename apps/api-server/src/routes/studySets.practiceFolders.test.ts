/**
 * Practice folders: the queries the database would actually see, and the
 * status each refusal answers with.
 *
 * WHY QUERY-SHAPE AND NOT JUST STATUS. The service-role client BYPASSES RLS,
 * so the `user_id` / `study_set_id` predicates in these traces ARE the access
 * control. A handler that answers 200 with the right body while having dropped
 * one `eq` is a data leak that every status assertion in the file would still
 * call green — so the traces below are the real test and the statuses are the
 * second half of it.
 *
 * THE THREE REFUSALS pinned here are the three a folder route can get wrong:
 * a folder that is not mine, a folder that is mine but in ANOTHER set, and a
 * folder that does not exist. All three must answer 404 with the same body: a
 * 403 on the first would confirm the row exists to someone who may not know.
 *
 * THE FOURTH is the migration. 20260918120000 is hand-applied and the API
 * ships first, so every path here runs at least once against a database with
 * no folders table. The list degrades to `supported: false` with a 200; every
 * write answers 503 naming the file.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router from './studySets';
import {
  createQueryRecorder,
  runRouteHandler,
  type QueryResult,
  type ResolveResult,
} from '../testSupport/queryRecorder';
import * as practiceFoldersData from '../services/data/practiceFolders';
import { initializeStudySetRoutes } from './studySets';
import { setSchemaCapabilities } from '../services/schemaCapabilities';

const SET = '11111111-1111-4111-8111-111111111111';
const FOLDER = '22222222-2222-4222-8222-222222222222';
const TEST = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';

const ok = (data: unknown): QueryResult => ({ data, error: null });
/** What PostgREST answers for a table a migration has not created yet. */
const noRelation: QueryResult = {
  data: null,
  error: { code: '42P01', message: 'relation "practice_folders" does not exist' },
};

const folderRow = {
  id: FOLDER,
  study_set_id: SET,
  title: 'Week 1',
  created_at: '2026-09-18T00:00:00.000Z',
  updated_at: '2026-09-18T00:00:00.000Z',
};

/**
 * The REAL data module bound to the recording client, exactly the way
 * `data/index.ts` binds it to the live one — so the trace is the query the
 * database would see, end to end, rather than a query a stub invented.
 */
function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  const bound = Object.fromEntries(
    Object.entries(practiceFoldersData)
      .filter(([, value]) => typeof value === 'function')
      .map(([name, fn]) => [
        name,
        (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(rec.client, ...args),
      ]),
  );
  initializeStudySetRoutes({
    getClient: () => rec.client,
    practiceFolders: bound,
  } as never);
  return rec;
}

beforeEach(() => {
  // A scripted database does not serve the probe query, so the capability is
  // forced. Each test that cares about the pre-migration side flips it.
  setSchemaCapabilities({ practiceFolders: true });
});

afterEach(() => {
  setSchemaCapabilities({ practiceFolders: null });
});

const req = (over: Record<string, unknown> = {}) => ({
  user: { id: USER },
  params: { setId: SET },
  body: {},
  ...over,
});

describe('GET /:setId/practice-folders', () => {
  it('scopes the list to this owner AND this set, newest first', async () => {
    const rec = initWith((table) =>
      table === 'practice_folders' ? ok([folderRow]) : ok([{ practice_folder_id: FOLDER }]),
    );

    const res = await runRouteHandler(router, 'get', '/:setId/practice-folders', req());

    expect(res.statusCode).toBe(200);
    expect(rec.trace.slice(0, 5)).toEqual([
      'from("practice_folders")',
      'select("id, study_set_id, title, created_at, updated_at")',
      `eq("user_id", "${USER}")`,
      `eq("study_set_id", "${SET}")`,
      'order("created_at", {"ascending":false})',
    ]);
  });

  it('counts the folder\'s items server-side, in ONE read scoped to the owner', async () => {
    // A client only ever holds one page of practice rows, so a count derived
    // locally would print "Folder · 3 items" over a folder holding thirty.
    const rec = initWith((table) =>
      table === 'practice_folders'
        ? ok([folderRow])
        : ok([{ practice_folder_id: FOLDER }, { practice_folder_id: FOLDER }]),
    );

    const res = await runRouteHandler(router, 'get', '/:setId/practice-folders', req());

    expect(res.body.data.folders[0]).toMatchObject({ id: FOLDER, itemCount: 2 });
    expect(rec.trace).toContain('from("test_sessions")');
    expect(rec.trace).toContain(`eq("user_id", "${USER}")`);
    expect(rec.trace).toContain(`in("practice_folder_id", ["${FOLDER}"])`);
  });

  it('reports supported:true with an empty list when the owner simply has none', async () => {
    initWith(ok([]));

    const res = await runRouteHandler(router, 'get', '/:setId/practice-folders', req());

    // The distinction the hub branches on: no folders YET still offers a
    // Create folder card.
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ supported: true, folders: [] });
  });

  it('degrades to supported:false — a 200, not a 500 — before the migration lands', async () => {
    setSchemaCapabilities({ practiceFolders: false });
    initWith(noRelation);

    const res = await runRouteHandler(router, 'get', '/:setId/practice-folders', req());

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ supported: false, folders: [] });
  });
});

describe('POST /:setId/practice-folders', () => {
  it('stamps the owner and the set onto the row, and starts it empty', async () => {
    const rec = initWith((table, nth) =>
      // The cap count reads first, then the insert.
      table === 'practice_folders' && nth === 0 ? ok([]) : ok(folderRow),
    );

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/practice-folders',
      req({ body: { title: 'Week 1' } }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ id: FOLDER, studySetId: SET, itemCount: 0 });
    expect(rec.trace).toContain(
      `insert({"user_id":"${USER}","study_set_id":"${SET}","title":"Week 1"})`,
    );
  });

  it('answers 503 with the migration filename, never a false 201', async () => {
    setSchemaCapabilities({ practiceFolders: false });
    initWith(noRelation);

    const res = await runRouteHandler(
      router,
      'post',
      '/:setId/practice-folders',
      req({ body: { title: 'Week 1' } }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.migration).toBe('20260918120000_practice_folders.sql');
  });
});

describe('PATCH /:setId/practice-folders/:folderId', () => {
  it('renames only a folder that matches all three predicates', async () => {
    const rec = initWith((table, nth) =>
      table === 'practice_folders' && nth === 0
        ? ok({ ...folderRow, title: 'Week 2' })
        : table === 'practice_folders'
          ? ok([{ ...folderRow, title: 'Week 2' }])
          : ok([]),
    );

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-folders/:folderId', {
      ...req({ params: { setId: SET, folderId: FOLDER }, body: { title: 'Week 2' } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.title).toBe('Week 2');
    expect(rec.trace).toContain(`eq("id", "${FOLDER}")`);
    expect(rec.trace).toContain(`eq("user_id", "${USER}")`);
    expect(rec.trace).toContain(`eq("study_set_id", "${SET}")`);
  });

  it('answers 404 — not 403 — for a folder that is not this owner\'s', async () => {
    // The predicates simply miss, so PostgREST returns no row. A 403 here
    // would confirm the id exists to somebody who does not own it.
    initWith(ok(null));

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-folders/:folderId', {
      ...req({ params: { setId: SET, folderId: FOLDER }, body: { title: 'Mine now' } }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Folder not found' });
  });

  it('answers the same 404 for this owner\'s folder in ANOTHER set', async () => {
    // Same miss, same answer: the `study_set_id` predicate is what makes a
    // folder the SET's rather than the account's.
    initWith(ok(null));

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-folders/:folderId', {
      ...req({ params: { setId: SET, folderId: FOLDER }, body: { title: 'Week 3' } }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /:setId/practice-folders/:folderId', () => {
  it('deletes the folder and NOTHING else — the contents are unfiled by the FK', async () => {
    const rec = initWith(ok({ id: FOLDER }));

    const res = await runRouteHandler(router, 'delete', '/:setId/practice-folders/:folderId', {
      ...req({ params: { setId: SET, folderId: FOLDER } }),
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace).toContain('delete()');
    // The proof that a student's quizzes survive their folder: this handler
    // issues no write at all against the sessions table. ON DELETE SET NULL
    // does the unfiling, in the same statement, and cannot half-fail.
    expect(rec.trace).not.toContain('from("test_sessions")');
  });

  it('answers 404 when nothing matched', async () => {
    initWith(ok(null));

    const res = await runRouteHandler(router, 'delete', '/:setId/practice-folders/:folderId', {
      ...req({ params: { setId: SET, folderId: FOLDER } }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /:setId/practice-items/:testId', () => {
  it('proves the DESTINATION folder is this owner\'s in this set BEFORE moving anything', async () => {
    const rec = initWith((table) =>
      table === 'practice_folders' ? ok({ id: FOLDER }) : ok({ id: TEST }),
    );

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-items/:testId', {
      ...req({
        params: { setId: SET, testId: TEST },
        body: { practiceFolderId: FOLDER },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ id: TEST, practiceFolderId: FOLDER });
    // The folder check comes first; the move's own user_id predicate is the
    // second half. Both are required — see the route comment.
    expect(rec.trace[0]).toBe('from("practice_folders")');
    expect(rec.trace).toContain(`update({"practice_folder_id":"${FOLDER}"})`);
    expect(rec.trace).toContain(`eq("id", "${TEST}")`);
    expect(rec.trace).toContain(`eq("user_id", "${USER}")`);
  });

  it('refuses a folder in another set, and never touches the test', async () => {
    const rec = initWith(ok(null));

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-items/:testId', {
      ...req({
        params: { setId: SET, testId: TEST },
        body: { practiceFolderId: FOLDER },
      }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Folder not found' });
    expect(rec.trace).not.toContain('from("test_sessions")');
  });

  it('answers 404 for a test that is not this owner\'s', async () => {
    const rec = initWith((table) =>
      table === 'practice_folders' ? ok({ id: FOLDER }) : ok(null),
    );

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-items/:testId', {
      ...req({
        params: { setId: SET, testId: TEST },
        body: { practiceFolderId: FOLDER },
      }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Test not found' });
    expect(rec.trace).toContain(`eq("user_id", "${USER}")`);
  });

  it('unfiles with null, and asks no folder question to do it', async () => {
    // "Move out" has no destination, so there is nothing to authorise beyond
    // the test's own ownership — and a folder lookup on `null` would be the
    // bug the shared helper's empty-id guard also exists for.
    const rec = initWith(ok({ id: TEST }));

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-items/:testId', {
      ...req({ params: { setId: SET, testId: TEST }, body: { practiceFolderId: null } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ id: TEST, practiceFolderId: null });
    expect(rec.trace[0]).toBe('from("test_sessions")');
    expect(rec.trace).toContain('update({"practice_folder_id":null})');
  });

  it('answers 503 before the migration rather than reporting a move that did not happen', async () => {
    setSchemaCapabilities({ practiceFolders: false });
    initWith(noRelation);

    const res = await runRouteHandler(router, 'patch', '/:setId/practice-items/:testId', {
      ...req({ params: { setId: SET, testId: TEST }, body: { practiceFolderId: null } }),
    });

    expect(res.statusCode).toBe(503);
    expect(res.body.migration).toBe('20260918120000_practice_folders.sql');
  });
});
