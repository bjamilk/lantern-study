/**
 * Test-result submission must be idempotent (F2 · E3 C6/H11).
 *
 * The offline replay is two dependent writes — create the session, then post
 * its result. Both were unkeyed, so a retry after a lost response wrote a
 * SECOND session and a second result for one sitting: duplicate attempts in
 * History, points and badges awarded twice. These pin that a replay carrying
 * the same key is served the FIRST response and performs no second write.
 */

/** Stands in for the api_idempotency_keys table: one key -> one stored response. */
const idempotencyStore = new Map<string, unknown>();

jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: (header: string | string[] | undefined, fallback?: string) =>
    (Array.isArray(header) ? header[0] : header) || fallback || null,
  withIdempotency: async (
    _client: unknown,
    userId: string,
    op: string,
    key: string | null,
    fn: () => Promise<unknown>,
  ) => {
    if (!key) return fn();
    const storeKey = `${userId}:${op}:${key}`;
    if (idempotencyStore.has(storeKey)) return idempotencyStore.get(storeKey);
    const result = await fn();
    idempotencyStore.set(storeKey, result);
    return result;
  },
}));

const getWalletBalance = jest.fn(async () => 10);
const awardWalletOnce = jest.fn(async () => ({ awarded: 0, walletBalance: 10 }));
jest.mock('../services/walletService', () => ({
  getWalletService: () => ({ getWalletBalance, awardWalletOnce }),
}));

import { setIdempotencyClient } from '../middleware/idempotency';
import router, { initializeTestRoutes } from './tests';
import { stubDataLayer } from '../services/data/testStub';

setIdempotencyClient(() => ({}) as any);

const createTest = jest.fn();
const createTestResult = jest.fn();

const cache = {
  get: async () => null,
  set: async () => {},
  delete: async () => {},
  deletePattern: async () => {},
};

initializeTestRoutes(stubDataLayer({ createTest, createTestResult }) as any, cache as any);

/**
 * Drive one route's handlers directly. `skip` is how many leading handlers
 * (authMiddleware, requireTestOwner) to bypass; express-validator chains in
 * between are skipped by running only the middleware at `skip` and the final
 * asyncHandler, which is what this file is about.
 */
async function runRoute(path: string, skip: number, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post,
  );
  if (!layer) throw new Error(`route POST ${path} not found`);
  const stack = layer.route.stack.map((s: any) => s.handle);
  const handlers = [stack[skip], stack[stack.length - 1]];

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    let index = 0;
    const next = (err?: unknown) => {
      if (err) return reject(err);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route never responded'));
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (thrown) {
        reject(thrown);
      }
    };
    next();
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

const request = (body: any, headers: Record<string, string> = {}, params: any = {}) => ({
  user: { id: 'user-1' },
  body,
  headers,
  query: {},
  params,
});

beforeEach(() => {
  idempotencyStore.clear();
  jest.clearAllMocks();
});

describe('POST /tests (session create)', () => {
  it('replays the FIRST session on a retry with the same Idempotency-Key', async () => {
    let created = 0;
    createTest.mockImplementation(async () => ({ id: `session-${++created}` }));

    const body = { config: {}, questions: [], score: 80 };
    const headers = { 'idempotency-key': 'test-result:attempt-1' };

    const first = await runRoute('/', 1, request(body, headers));
    const second = await runRoute('/', 1, request(body, headers));

    expect(first.statusCode).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.body.data.id).toBe('session-1');
    expect(createTest).toHaveBeenCalledTimes(1);
  });

  it('accepts the key in the body, for clients that cannot set headers', async () => {
    let created = 0;
    createTest.mockImplementation(async () => ({ id: `session-${++created}` }));

    const body = { config: {}, questions: [], idempotencyKey: 'test-result:attempt-2' };
    await runRoute('/', 1, request(body));
    const second = await runRoute('/', 1, request(body));

    expect(second.body.data.id).toBe('session-1');
    expect(createTest).toHaveBeenCalledTimes(1);
  });

  it('still creates a session when no key is sent at all', async () => {
    let created = 0;
    createTest.mockImplementation(async () => ({ id: `session-${++created}` }));

    await runRoute('/', 1, request({ config: {}, questions: [] }));
    await runRoute('/', 1, request({ config: {}, questions: [] }));

    expect(createTest).toHaveBeenCalledTimes(2);
  });
});

describe('POST /tests/:testId/results', () => {
  it('returns the first result on a duplicate submission for the same session', async () => {
    let created = 0;
    createTestResult.mockImplementation(async () => ({
      id: `result-${++created}`,
      score: 80,
    }));

    const req = () =>
      request(
        { score: 80, correctAnswersCount: 8, totalQuestions: 10 },
        {},
        { testId: 'session-1' },
      );

    const first = await runRoute('/:testId/results', 2, req());
    const second = await runRoute('/:testId/results', 2, req());

    expect(first.statusCode).toBe(201);
    expect(first.body.data.id).toBe('result-1');
    expect(second.body).toEqual(first.body);
    // The whole point: no second row, and no second coin award.
    expect(createTestResult).toHaveBeenCalledTimes(1);
    expect(awardWalletOnce).toHaveBeenCalledTimes(1);
  });

  it('keys per session, so a different sitting still records its own result', async () => {
    let created = 0;
    createTestResult.mockImplementation(async () => ({ id: `result-${++created}` }));

    await runRoute(
      '/:testId/results',
      2,
      request({ score: 80, correctAnswersCount: 8, totalQuestions: 10 }, {}, { testId: 's1' }),
    );
    const other = await runRoute(
      '/:testId/results',
      2,
      request({ score: 50, correctAnswersCount: 5, totalQuestions: 10 }, {}, { testId: 's2' }),
    );

    expect(other.body.data.id).toBe('result-2');
    expect(createTestResult).toHaveBeenCalledTimes(2);
  });
});
