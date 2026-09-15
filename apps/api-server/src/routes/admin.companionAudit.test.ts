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

import router, { initializeAdminRoutes } from './admin';

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

function handlerFor(path: string) {
  const layer: any = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.get
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

async function call(limit?: string) {
  const req: any = { user: { id: ADMIN }, params: { userId: STUDENT }, query: limit ? { limit } : {} };
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  await new Promise<void>((resolve) => {
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    void handlerFor('/ai/companion/:userId')(req, res, () => undefined);
  });
  return res;
}

beforeAll(() => {
  initializeAdminRoutes({ getClient: () => ({ from: () => fakeQuery() }) } as any, {} as any);
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
