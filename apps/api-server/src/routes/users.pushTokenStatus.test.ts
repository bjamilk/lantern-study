/**
 * GET /users/push-token/status — "is this phone actually reachable?"
 *
 * On device a generation finished and no notification ever arrived, and the
 * app could not tell "the server never sent one" from "this device was never
 * registered". This endpoint answers the second half honestly, for the
 * signed-in user only.
 */
const redisStore = new Map<string, string>();

jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => ({
    async get(key: string) {
      return redisStore.get(key) ?? null;
    },
    async set(key: string, value: string) {
      redisStore.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      redisStore.delete(key);
      return 1;
    },
  }),
}));

import router, { initializeUserRoutes } from './users';

type ProfileRow = { expo_push_token?: unknown; settings?: unknown } | null;

let profileRow: ProfileRow = null;
let profileError: unknown = null;
const updatedTokens: Array<string | null> = [];

function initWith() {
  const supabase: any = {
    getClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: profileRow, error: profileError }),
          }),
        }),
      }),
    }),
    getUserById: async () => ({ id: 'user-1', settings: profileRow?.settings ?? {} }),
    updateExpoPushToken: async (_id: string, token: string) => {
      updatedTokens.push(token);
    },
    clearExpoPushToken: async () => {
      updatedTokens.push(null);
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

async function runRoute(method: 'get' | 'post' | 'delete', path: string, req: any) {
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
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

const request = (body: any = {}) => ({ user: { id: 'user-1' }, body, query: {}, params: {}, headers: {} });

beforeEach(() => {
  redisStore.clear();
  updatedTokens.length = 0;
  profileRow = null;
  profileError = null;
  initWith();
});

describe('GET /users/push-token/status', () => {
  it('reports a registered device and the master toggle', async () => {
    profileRow = {
      expo_push_token: 'ExponentPushToken[abc]',
      settings: { notifications: { pushEnabled: true } },
    };
    const res = await runRoute('get', '/push-token/status', request());
    expect(res.body.data).toMatchObject({ hasToken: true, pushEnabled: true });
    // The shipped mobile client asks for `registered`; both names must agree.
    expect(res.body.data.registered).toBe(true);
  });

  it('does not call a non-Expo token "set up" — Expo cannot deliver to it', async () => {
    profileRow = { expo_push_token: 'fcm-raw-token', settings: {} };
    const res = await runRoute('get', '/push-token/status', request());
    expect(res.body.data.hasToken).toBe(false);
  });

  it('says no token when no device has ever registered', async () => {
    profileRow = { expo_push_token: null, settings: { notifications: { pushEnabled: true } } };
    const res = await runRoute('get', '/push-token/status', request());
    expect(res.body.data).toMatchObject({ hasToken: false, updatedAt: null });
  });

  it('separates "no device" from "push turned off"', async () => {
    profileRow = {
      expo_push_token: 'ExponentPushToken[abc]',
      settings: { notifications: { pushEnabled: false } },
    };
    const res = await runRoute('get', '/push-token/status', request());
    expect(res.body.data).toMatchObject({ hasToken: true, pushEnabled: false });
  });

  it('never returns the token itself', async () => {
    profileRow = { expo_push_token: 'ExponentPushToken[abc]', settings: {} };
    const res = await runRoute('get', '/push-token/status', request());
    expect(JSON.stringify(res.body)).not.toContain('ExponentPushToken');
  });

  it('reports when the device last registered, and forgets it on clear', async () => {
    profileRow = {
      expo_push_token: null,
      settings: { notifications: { pushEnabled: true } },
    };
    await runRoute('post', '/push-token', request({ token: 'ExponentPushToken[abc]' }));
    expect(updatedTokens).toEqual(['ExponentPushToken[abc]']);

    profileRow = {
      expo_push_token: 'ExponentPushToken[abc]',
      settings: { notifications: { pushEnabled: true } },
    };
    const registered = await runRoute('get', '/push-token/status', request());
    expect(Date.parse(registered.body.data.updatedAt)).toBeGreaterThan(0);

    await runRoute('delete', '/push-token', request());
    profileRow = { expo_push_token: null, settings: {} };
    const cleared = await runRoute('get', '/push-token/status', request());
    expect(cleared.body.data).toMatchObject({ hasToken: false, updatedAt: null });
  });
});
