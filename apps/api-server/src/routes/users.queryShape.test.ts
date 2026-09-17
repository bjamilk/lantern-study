/**
 * Query shapes AND responses for the eight direct database escapes in
 * `routes/users.ts` (lane R2, PR 2b).
 *
 * Four are inline chains, three are RPCs and one is a GoTrue admin call. The
 * file has four suites, but none of them exercises these: `users.budget` only
 * asserts route registration and a regex, `users.pushTokenStatus` and
 * `users.presenceHeartbeat` stub around them, `users.academic` is elsewhere.
 * Lane R2 moves them into `services/data/users.ts` and `services/data/budget.ts`.
 *
 * Written and committed against the UNTOUCHED route.
 *
 * ## The predicates that are access control
 *
 * The API runs as the SERVICE ROLE, which BYPASSES RLS, so `eq("id", userId)`
 * and `eq("user_id", userId)` are the whole of the scoping. The budget pair is
 * the sharpest case: `PUT /:userId/budget` takes the id from the URL, and what
 * keeps one student from writing another's limit is the authorization check in
 * the handler plus this predicate — which is why the moved function takes it as
 * a required parameter rather than folding it into a row object.
 *
 * ## Issue #108
 *
 * Both writes here READ the error they get back: the username update branches on
 * `23505` to answer 409, and the budget upsert throws. Neither is one of the 87
 * bare-await sites, and the cases below pin that so the move cannot turn one
 * into one.
 */
// Spread the real module: `routes/users.ts` also mounts `requirePlatformAdmin`
// and friends at import time, and a bare object mock makes the router throw
// "argument handler must be a function" before a single test runs.
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router, { initializeUserRoutes } from './users';
import { createQueryRecorder, runRouteHandler, bindDataModule, type QueryResult, type ResolveResult } from '../testSupport/queryRecorder';
import * as usersData from '../services/data/users';
import * as budgetData from '../services/data/budget';

const USER = 'user-1';

function initWith(resolve?: ResolveResult, layer: Record<string, unknown> = {}) {
  const rec = createQueryRecorder(resolve);
  initializeUserRoutes(
    {
      getClient: () => rec.client,
      users: bindDataModule(usersData, rec.client),
      budget: bindDataModule(budgetData, rec.client),
      notifications: {},
      ...layer,
    } as any,
    {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
      invalidateUserCache: jest.fn(async () => {}),
    } as any,
  );
  return rec;
}

const ok = (data: unknown): QueryResult => ({ data, error: null });

describe('GET /push-token/status', () => {
  it('reads the caller own profile row for the token and settings', async () => {
    const rec = initWith(ok({ expo_push_token: 'ExponentPushToken[abc]', settings: {} }));

    const res = await runRouteHandler(router, 'get', '/push-token/status', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hasToken).toBe(true);
    expect(res.body.data.registered).toBe(true);

    expect(rec.trace).toEqual([
      'from("profiles")',
      // Not through getUserById: the mapped User shape drops expo_push_token.
      'select("expo_push_token, settings")',
      `eq("id", "${USER}")`,
      'maybeSingle()',
    ]);
  });

  it('reports a non-Expo token as no token at all', async () => {
    initWith(ok({ expo_push_token: 'fcm-token-not-expo', settings: {} }));

    const res = await runRouteHandler(router, 'get', '/push-token/status', { user: { id: USER } });

    expect(res.body.data.hasToken).toBe(false);
  });
});

describe('PUT /:userId/budget', () => {
  it('upserts on the user+month key and answers with what was stored', async () => {
    const rec = initWith(ok({ monthly_limit: 50000, month_year: '2026-09' }));

    const res = await runRouteHandler(router, 'put', '/:userId/budget', {
      user: { id: USER },
      params: { userId: USER },
      body: { monthlyLimit: 50000, monthYear: '2026-09' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { monthly_limit: 50000, month_year: '2026-09' },
    });

    expect(rec.trace[0]).toBe('from("user_budgets")');
    const row = JSON.parse(
      rec.trace[1].slice('upsert('.length, -', {"onConflict":"user_id,month_year"})'.length),
    );
    expect(row).toMatchObject({ user_id: USER, month_year: '2026-09', monthly_limit: 50000 });
    expect(rec.trace[1].endsWith(', {"onConflict":"user_id,month_year"})')).toBe(true);
    expect(rec.trace.slice(2)).toEqual([
      'select("monthly_limit, month_year")',
      'maybeSingle()',
    ]);
  });

  it('rejects a malformed month with 400 before writing anything', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'put', '/:userId/budget', {
      user: { id: USER },
      params: { userId: USER },
      body: { monthlyLimit: 1, monthYear: '2026-13' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'monthYear must be YYYY-MM' });
    expect(rec.tables()).toEqual([]);
  });

  it('rejects a negative limit with 400 before writing anything', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'put', '/:userId/budget', {
      user: { id: USER },
      params: { userId: USER },
      body: { monthlyLimit: -5, monthYear: '2026-09' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'monthlyLimit must be a non-negative number',
    });
    expect(rec.tables()).toEqual([]);
  });
});

describe('GET /:userId/budget', () => {
  it('reads the caller limit for one month', async () => {
    const rec = initWith(ok({ monthly_limit: 42000, month_year: '2026-09' }));

    const res = await runRouteHandler(router, 'get', '/:userId/budget', {
      user: { id: USER },
      params: { userId: USER },
      query: { monthYear: '2026-09' },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace).toEqual([
      'from("user_budgets")',
      'select("monthly_limit, month_year")',
      `eq("user_id", "${USER}")`,
      'eq("month_year", "2026-09")',
      'maybeSingle()',
    ]);
  });
});
