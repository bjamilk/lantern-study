/**
 * Query shape AND responses for `GET /tests/sessions/:sessionId` (lane R2, PR 2b).
 *
 * The one remaining inline chain in `routes/tests.ts`: everything else in the
 * file already goes through `data/tests.ts`. Lane R2 moves it there too.
 *
 * Written and committed against the UNTOUCHED route.
 *
 * ## `eq("user_id", …)` is the access control, and the 404 is deliberate
 *
 * The API runs as the service role and BYPASSES RLS, so without that predicate
 * this endpoint hands any signed-in student any other student's exam session —
 * questions, answers and all. The route then answers "not found or access
 * denied" for both a missing session and a foreign one, on purpose: a 403 would
 * confirm that a session id exists. Both halves are frozen below.
 */
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router, { initializeTestRoutes } from './tests';
import { createQueryRecorder, runRouteHandler, type ResolveResult } from '../testSupport/queryRecorder';

const USER = 'user-1';
const SESSION = 'session-9';

function initWith(resolve?: ResolveResult) {
  const rec = createQueryRecorder(resolve);
  initializeTestRoutes(
    {
      getClient: () => rec.client,
      tests: {
        mapTestSessionRowToClient: (row: any) => ({ ...row, mapped: true }),
        attachSourceNoteTitles: jest.fn(async () => {}),
      },
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

describe('GET /sessions/:sessionId', () => {
  it('reads the session by id AND owner', async () => {
    const rec = initWith({ data: { id: SESSION, user_id: USER }, error: null });

    const res = await runRouteHandler(router, 'get', '/sessions/:sessionId', {
      user: { id: USER },
      params: { sessionId: SESSION },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(rec.trace).toEqual([
      'from("test_sessions")',
      'select("*")',
      `eq("id", "${SESSION}")`,
      // Without this, any signed-in student can read any exam session.
      `eq("user_id", "${USER}")`,
      'maybeSingle()',
    ]);
  });

  it('answers 404 for a session that is not the caller own', async () => {
    initWith({ data: null, error: null });

    const res = await runRouteHandler(router, 'get', '/sessions/:sessionId', {
      user: { id: USER },
      params: { sessionId: SESSION },
    });

    expect(res.statusCode).toBe(404);
    // One message for "missing" and for "not yours": a 403 would confirm the id.
    expect(res.body).toEqual({
      success: false,
      error: 'Test session not found or access denied',
    });
  });

  it('propagates a database error rather than answering 404', async () => {
    initWith({ data: null, error: { code: '42P01', message: 'no relation' } });

    await expect(
      runRouteHandler(router, 'get', '/sessions/:sessionId', {
        user: { id: USER },
        params: { sessionId: SESSION },
      }),
    ).rejects.toBeTruthy();
  });
});
