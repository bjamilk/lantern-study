/**
 * GET /api/v1/admin/ai/companion/:userId reads a named student's private AI
 * companion conversation — the most sensitive read in the console — and was the
 * one read that left no audit trail, while every mutating route in the file
 * audits. F10 gives it the same `logAdminAction` its neighbours use.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const logAdminAction = jest.fn(async (..._args: any[]) => undefined);
jest.mock('../services/adminAudit', () => ({
  logAdminAction: (...args: unknown[]) => (logAdminAction as any)(...args),
  countPlatformAdmins: jest.fn(async () => 2),
  invalidateBanCache: jest.fn(async () => undefined),
  getUserBlockState: jest.fn(async () => ({ banned: false, suspendedUntil: null })),
}));

import router, { initializeAdminRoutes, adminErrorHandler } from './admin';

const ADMIN = 'admin-1';
const STUDENT = 'student-1';

/** The last messages the fake table would return, newest first. */
let rows: Array<Record<string, unknown>> = [];
let readError: unknown = null;

function fakeQuery() {
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error: readError }),
  };
  return query;
}

/**
 * The route's last handler, found by walking the router recursively: the admin
 * surface is a tree of sub-routers, not a flat stack, so a `.stack.find` that
 * only looks at the top level silently finds nothing.
 */
function handlerFor(path: string): any {
  function walk(r: any): any {
    for (const layer of r?.stack ?? []) {
      if (layer.route?.path === path && layer.route?.methods?.get) {
        const stack = layer.route.stack;
        return stack[stack.length - 1].handle;
      }
      if (layer.name === 'router' && layer.handle?.stack) {
        const found = walk(layer.handle);
        if (found) return found;
      }
    }
    return undefined;
  }
  const handle = walk(router);
  if (!handle) throw new Error(`no GET ${path} in the admin router`);
  return handle;
}

/**
 * Drive the handler the way Express does after M4: the handler is wrapped in
 * `asyncHandler`, so a failure reaches `next`, and it is `adminErrorHandler`
 * (registered with `router.use` at the bottom of routes/admin.ts) that turns it
 * into the response. Calling the handler with a no-op `next` would swallow
 * every failure and make the third test below vacuous.
 */
async function call(limit?: string) {
  const req: any = { user: { id: ADMIN }, params: { userId: STUDENT }, query: limit ? { limit } : {} };
  const res: any = { statusCode: 200, body: undefined, locals: {}, headersSent: false };
  res.status = (code: number) => ((res.statusCode = code), res);
  await new Promise<void>((resolve) => {
    res.json = (body: unknown) => {
      res.body = body;
      res.headersSent = true;
      resolve();
      return res;
    };
    const next = (err?: unknown) => {
      if (err) adminErrorHandler(err, req, res, () => undefined);
    };
    void handlerFor('/ai/companion/:userId')(req, res, next);
  });
  return res;
}

beforeAll(() => {
  // The admin family is injected with the DATA LAYER now. `legacyService` is
  // the facade handle its `adminData` helpers still take whole.
  initializeAdminRoutes(
    {
      getClient: () => ({ from: () => fakeQuery() }),
      legacyService: { getClient: () => ({ from: () => fakeQuery() }) },
    } as any,
    {} as any,
  );
});

beforeEach(() => {
  logAdminAction.mockClear();
  rows = [{ id: 'm1', role: 'user', content: 'hello', created_at: '2026-09-01T00:00:00Z' }];
  readError = null;
});

describe('GET /admin/ai/companion/:userId', () => {
  it('audits the read, naming the admin and the student', async () => {
    const res = await call();
    expect(res.body.success).toBe(true);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction.mock.calls[0][1]).toMatchObject({
      actorId: ADMIN,
      action: 'ai_companion_history_view',
      targetType: 'user',
      targetId: STUDENT,
    });
  });

  it('records how much was read', async () => {
    await call('35');
    expect((logAdminAction.mock.calls[0][1] as any).metadata).toEqual({ limit: 35 });
  });

  it('audits BEFORE the read, so a failed read still leaves the trail', async () => {
    // An admin who opened the conversation and then hit a 500 still made the
    // request; a trail that only records successful reads is one to step around.
    readError = { message: 'boom' };
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
  });
});
