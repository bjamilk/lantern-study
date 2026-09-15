/**
 * POST /users/presence/heartbeat and a slow upstream.
 *
 * SW / Sentry LANTERN-STUDY-API-2 (25 events, "Error: Gateway Timeout"): the
 * presence write was unbounded and unguarded, so a PostgREST timeout escaped
 * the handler as a STATUS-LESS Error. @sentry/node files a status-less error as
 * a 500, so a two-minute online-status ping read as a server crash — and the
 * web client, whose breadcrumbs in WEB-17 start with exactly this route, saw a
 * hard failure on a beat that is fire-and-forget by design.
 */
jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => null,
}));

import router, { initializeUserRoutes } from './users';

let touchBehaviour: 'ok' | 'hang' | 'throw' = 'ok';

function initWith() {
  const supabase: any = {
    getClient: () => ({}),
    touchLastSeen: async () => {
      if (touchBehaviour === 'throw') throw new Error('Gateway Timeout');
      if (touchBehaviour === 'hang') await new Promise(() => {});
    },
  };
  const cache: any = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    deletePattern: async () => {},
  };
  initializeUserRoutes(supabase, cache);
}

async function runRoute(method: 'post', path: string, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);

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
    // Index 0 is authMiddleware; req.user is supplied directly.
    let index = 1;
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
    setTimeout(() => reject(new Error('route never responded')), 12_000).unref?.();
  });
  return res;
}

const request = (body: any = {}) => ({
  user: { id: 'user-1' },
  body,
  query: {},
  params: {},
  headers: {},
});

beforeEach(() => {
  touchBehaviour = 'ok';
  initWith();
});

describe('POST /users/presence/heartbeat', () => {
  it('answers success on a healthy beat', async () => {
    const res = await runRoute('post', '/presence/heartbeat', request());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('answers 504 with a body — never a thrown, status-less Error — when the upstream times out', async () => {
    touchBehaviour = 'hang';
    const res = await runRoute('post', '/presence/heartbeat', request());
    expect(res.statusCode).toBe(504);
    expect(res.body).toMatchObject({ success: false, code: 'PRESENCE_UNAVAILABLE' });
  }, 15_000);

  it('answers 504 rather than propagating an upstream rejection', async () => {
    touchBehaviour = 'throw';
    const res = await runRoute('post', '/presence/heartbeat', request());
    expect(res.statusCode).toBe(504);
    expect(res.body).toMatchObject({ code: 'PRESENCE_UNAVAILABLE' });
  });

  it('never answers 401/403 for an upstream failure — a heartbeat must not end a session', async () => {
    touchBehaviour = 'throw';
    const res = await runRoute('post', '/presence/heartbeat', request());
    expect([401, 403]).not.toContain(res.statusCode);
  });
});
