/**
 * POST /auth/refresh minted fresh access cookies from any still-valid refresh
 * token, checking neither the ban list nor the per-user session cutoff. A banned
 * user, or a session the user had force-revoked from another device, therefore
 * kept refreshing itself indefinitely — the revocation only ever bit the access
 * token it was stamped against.
 *
 * Fixing `/refresh` alone left the hole open one door down: `GET /auth/session`
 * falls back to the same refresh cookie (twice — once when no access token is
 * presented, once when the presented one no longer verifies) and minted tokens
 * with no gate at all. These tests pin both routes to the shared
 * `rejectRevokedSession` gate, because "the other refresh path forgot the
 * check" is exactly how this class of bug comes back.
 */
const logged: Array<{ level: string; message: string }> = [];
jest.mock('../utils/logger', () => ({
  logger: {
    debug: (message: string) => logged.push({ level: 'debug', message }),
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string) => logged.push({ level: 'error', message }),
  },
}));

const refreshSession = jest.fn();
const signInWithPassword = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { refreshSession, signInWithPassword, autoRefreshToken: false } }),
}));

/**
 * Mirrors the real helper: it writes its own 403 into the response it is given.
 *
 * F10 (coordinator R1): the gate is `rejectIfBannedOnly`, not `rejectIfBanned`.
 * The mock is DRIVEN BY BLOCK STATE rather than hard-wired, so the tests below
 * can say "this student is suspended" and the mock answers the way the real
 * ban-only helper does — otherwise a regression back to the suspension-aware
 * gate would still pass. The ban-only helper's own behaviour is pinned in
 * `middleware/auth.suspended.test.ts`.
 */
const blockState = { banned: false, suspendedUntil: null as string | null };
const rejectIfBannedOnly = jest.fn(async (_userId: string, res: any) => {
  if (!blockState.banned) return false;
  res.status(403).json({ error: 'Forbidden', message: 'suspended', code: 'ACCOUNT_BANNED' });
  return true;
});
jest.mock('../middleware/auth', () => ({
  authMiddleware: function authMiddleware(_req: any, _res: any, next: any) { next(); },
  optionalAuthMiddleware: function optionalAuthMiddleware(_req: any, _res: any, next: any) { next(); },
  evictAuthTokenCache: jest.fn(),
  rejectIfBannedOnly: (...args: any[]) => (rejectIfBannedOnly as any)(...args),
}));

const isTokenIssuedBeforeUserCutoff = jest.fn(async () => false);
jest.mock('../services/tokenDenylist', () => ({
  denylistAccessToken: jest.fn(),
  setUserSessionCutoff: jest.fn(),
  isTokenIssuedBeforeUserCutoff: (...args: any[]) =>
    isTokenIssuedBeforeUserCutoff(...(args as [])),
}));

import router, { initializeAuthRoutes } from './auth';
import { stubDataLayer } from '../services/data/testStub';

function routeHandler(path: string, method: 'get' | 'post') {
  const layer: any = router.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

/**
 * asyncHandler does not return its inner promise, so the handler is still in
 * flight when the call returns — drain the microtask queue until it settles.
 */
async function invoke(req: any, res: any, handler = routeHandler('/refresh', 'post')) {
  handler(req, res, jest.fn());
  for (let i = 0; i < 50 && res.body === null && res.cookies.length === 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function mockReqRes(cookies: Record<string, string> = { lantern_refresh: 'refresh-token' }) {
  const req: any = {
    method: 'POST',
    path: '/refresh',
    headers: {},
    body: {},
    cookies,
  };
  const res: any = {
    statusCode: 200,
    body: null as any,
    cleared: [] as string[],
    cookies: [] as string[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    cookie(name: string) {
      this.cookies.push(name);
      return this;
    },
    clearCookie(name: string) {
      this.cleared.push(name);
      return this;
    },
  };
  return { req, res };
}

const validSession = {
  session: {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1' },
  },
  user: { id: 'user-1' },
};

/** Put the fixture account in one of the three block states. */
function setBlockState(state: 'clear' | 'banned' | 'suspended'): void {
  blockState.banned = state === 'banned';
  blockState.suspendedUntil = state === 'suspended' ? '2026-09-05T12:00:00Z' : null;
}

describe('POST /auth/refresh guards', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost:55421';
    process.env.SUPABASE_ANON_KEY = 'anon';
    refreshSession.mockReset().mockResolvedValue({ data: validSession, error: null });
    setBlockState('clear');
    isTokenIssuedBeforeUserCutoff.mockReset().mockResolvedValue(false);
  });

  it('refuses a banned user with the ban status and body, not a bare 200', async () => {
    setBlockState('banned');
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BANNED');
  });

  it('issues cookies for a healthy session', async () => {
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
  });

  it('refuses to refresh a session issued before the user cutoff', async () => {
    isTokenIssuedBeforeUserCutoff.mockResolvedValue(true);
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
    expect(res.cookies).toHaveLength(0);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  it('refuses to refresh a banned user and clears their cookies', async () => {
    setBlockState('banned');
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.cookies).toHaveLength(0);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  it('checks the cutoff against the NEWLY issued access token', async () => {
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(isTokenIssuedBeforeUserCutoff).toHaveBeenCalledWith('new-access', 'user-1');
  });
});

/**
 * `GET /session` reaches for the refresh cookie on two paths: no access token
 * at all, and an access token that no longer verifies. Both mint a fresh
 * session, so both must pass the same gate `/refresh` does.
 */
describe('GET /auth/session refresh fallbacks are gated too', () => {
  const sessionHandler = () => routeHandler('/session', 'get');

  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost:55421';
    process.env.SUPABASE_ANON_KEY = 'anon';
    refreshSession.mockReset().mockResolvedValue({ data: validSession, error: null });
    setBlockState('clear');
    isTokenIssuedBeforeUserCutoff.mockReset().mockResolvedValue(false);
    // Only the expired-access-token path consults Supabase; treat the presented
    // token as expired so that path falls through to the refresh cookie.
    initializeAuthRoutes(
      stubDataLayer({ verifySupabaseToken: jest.fn(async () => ({ isValid: false, user: null })) }) as any,
      { invalidateUserCache: jest.fn() } as any
    );
  });

  it('refreshes a healthy session when no access token is presented', async () => {
    const { req, res } = mockReqRes({ lantern_refresh: 'refresh-token' });
    await invoke(req, res, sessionHandler());
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
  });

  it('refuses a banned user and clears their cookies', async () => {
    setBlockState('banned');
    const { req, res } = mockReqRes({ lantern_refresh: 'refresh-token' });
    await invoke(req, res, sessionHandler());
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BANNED');
    expect(res.cookies).toHaveLength(0);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  it('refuses a session issued before the user cutoff', async () => {
    isTokenIssuedBeforeUserCutoff.mockResolvedValue(true);
    const { req, res } = mockReqRes({ lantern_refresh: 'refresh-token' });
    await invoke(req, res, sessionHandler());
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
    expect(res.cookies).toHaveLength(0);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  it('gates the expired-access-token fallback as well', async () => {
    setBlockState('banned');
    const { req, res } = mockReqRes({
      lantern_access: 'stale-access',
      lantern_refresh: 'refresh-token',
    });
    await invoke(req, res, sessionHandler());
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BANNED');
    expect(res.cookies).toHaveLength(0);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  it('still refreshes the expired-access-token fallback for a healthy user', async () => {
    const { req, res } = mockReqRes({
      lantern_access: 'stale-access',
      lantern_refresh: 'refresh-token',
    });
    await invoke(req, res, sessionHandler());
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
    expect(isTokenIssuedBeforeUserCutoff).toHaveBeenCalledWith('new-access', 'user-1');
  });
});

describe('POST /auth/exchange verifies the refresh token it is handed', () => {
  it('redeems the supplied refresh token instead of trusting it', () => {
    const source = require('fs').readFileSync(__dirname + '/auth.ts', 'utf8');
    const handler = source.slice(
      source.indexOf("'/exchange'"),
      source.indexOf("'/refresh'")
    );
    expect(handler).toContain('refreshSession({');
    expect(handler).toContain('Invalid refresh token');
  });
});

/**
 * F10 (coordinator R1). A temporary suspension must not end the session.
 *
 * The gate used to be `rejectIfBanned`, which also fires on a suspension: a
 * suspended student was cookie-cleared on /session, 403'd on /refresh and
 * refused at /login, so the web client signed them out and they never reached
 * the dated notice the product shows them
 * (`apps/web/src/services/accountSuspension.ts`). Suspension is enforced on
 * every ordinary request by the auth middleware, which answers
 * ACCOUNT_SUSPENDED with the date — these routes only ask about bans.
 */
describe('a SUSPENDED account keeps its session', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost:55421';
    process.env.SUPABASE_ANON_KEY = 'anon';
    refreshSession.mockReset().mockResolvedValue({ data: validSession, error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: validSession, error: null });
    isTokenIssuedBeforeUserCutoff.mockReset().mockResolvedValue(false);
    setBlockState('suspended');
    initializeAuthRoutes(
      stubDataLayer({ verifySupabaseToken: jest.fn(async () => ({ isValid: false, user: null })) }) as any,
      { invalidateUserCache: jest.fn() } as any
    );
  });

  it('POST /refresh still issues cookies', async () => {
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
    expect(res.cleared).toHaveLength(0);
  });

  it('GET /session still refreshes from the refresh cookie', async () => {
    const { req, res } = mockReqRes({ lantern_refresh: 'refresh-token' });
    await invoke(req, res, routeHandler('/session', 'get'));
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
    expect(res.cleared).toHaveLength(0);
  });

  it('POST /login still signs them in', async () => {
    const { req, res } = mockReqRes({});
    req.body = { email: 'a@b.com', password: 'secret' };
    await invoke(req, res, routeHandler('/login', 'post'));
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
  });

  it('but a BAN still stops /login', async () => {
    setBlockState('banned');
    const { req, res } = mockReqRes({});
    req.body = { email: 'a@b.com', password: 'secret' };
    await invoke(req, res, routeHandler('/login', 'post'));
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BANNED');
    expect(res.cookies).toHaveLength(0);
  });
});

/**
 * F10. The marker on /refresh claimed the API had no refresh-token reuse
 * detection. It does — GoTrue's: `supabase/config.toml` sets
 * `enable_refresh_token_rotation = true` with `refresh_token_reuse_interval =
 * 10`, so a token redeemed twice past that window revokes the whole family. A
 * second denylist here could not revoke a family, would have to fail closed on
 * a Redis incident, and would punish a retried request. What the API owed the
 * route was the ALARM, so the reuse codes are logged at error level and an
 * ordinary expiry is not — otherwise the signal is buried in routine noise.
 */
describe('POST /auth/refresh reports GoTrue reuse detection', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost:55421';
    process.env.SUPABASE_ANON_KEY = 'anon';
    logged.length = 0;
    setBlockState('clear');
    isTokenIssuedBeforeUserCutoff.mockReset().mockResolvedValue(false);
    refreshSession.mockReset();
  });

  it.each([
    ['refresh_token_already_used', undefined],
    ['refresh_token_not_found', undefined],
    [undefined, 'Invalid Refresh Token: Already Used'],
  ])('logs an alarm for code=%s message=%s', async (code, message) => {
    refreshSession.mockResolvedValue({ data: {}, error: { code, message, status: 400 } });
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
    expect(res.cleared.length).toBeGreaterThan(0);
    expect(logged.some((entry) => entry.level === 'error' && /reuse/i.test(entry.message))).toBe(true);
  });

  it('stays quiet for an ordinary expiry, so the alarm means something', async () => {
    refreshSession.mockResolvedValue({
      data: {},
      error: { code: 'refresh_token_expired', message: 'Token expired', status: 400 },
    });
    const { req, res } = mockReqRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(401);
    expect(logged.some((entry) => entry.level === 'error')).toBe(false);
  });
});
