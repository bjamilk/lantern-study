/**
 * SW / Sentry WEB-17 ("Unexpected sign-out", 57 events / 5 users).
 *
 * The revocation gates fail CLOSED when Redis is unreachable — correct, and
 * unchanged here. What was wrong is the ANSWER: `401 SESSION_REVOKED` is a
 * terminal code, and the web client signs the user out on it without trying to
 * refresh. One Redis blip therefore ended every live session, which is exactly
 * the breadcrumb trail in WEB-17: two healthy heartbeats, then a burst of 401s
 * across unrelated URLs, then sign-out.
 */
jest.mock('../services/adminAudit', () => ({
  getUserBlockState: jest.fn(async () => ({ banned: false, suspendedUntil: null })),
  isUserBanned: jest.fn(async () => false),
}));
jest.mock('../services/apiKey', () => ({
  apiKeyService: { isApiKeyFormat: () => false, validateKey: jest.fn(), hasPermission: () => true },
}));
const checkAccessTokenDenied = jest.fn();
const checkTokenIssuedBeforeUserCutoff = jest.fn();
jest.mock('../services/tokenDenylist', () => ({
  isAccessTokenDenied: jest.fn(async () => false),
  isTokenIssuedBeforeUserCutoff: jest.fn(async () => false),
  checkAccessTokenDenied: (...args: any[]) => checkAccessTokenDenied(...args),
  checkTokenIssuedBeforeUserCutoff: (...args: any[]) => checkTokenIssuedBeforeUserCutoff(...args),
}));
jest.mock('../services/accountLifecycle', () => ({
  getAccountLifecycle: jest.fn(),
  isAccountDeactivated: () => false,
  isDeactivatedLifecycleRoute: () => false,
}));
jest.mock('../services/dataLoaders', () => ({ createRequestContext: () => ({}) }));
jest.mock('./rateLimit', () => ({
  authenticatedRateLimit: (_req: any, _res: any, next: any) => next(),
  apiKeyAuthRateLimit: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../utils/platformAdminAuth', () => ({ isLivePlatformAdmin: jest.fn(async () => false) }));
jest.mock('../utils/authCookies', () => ({ readAccessCookie: () => null }));

import { authMiddleware, initializeAuthMiddleware } from './auth';

const verifySupabaseToken = jest.fn();

function fakeRes() {
  const out: any = { statusCode: undefined, body: undefined };
  out.status = (code: number) => ((out.statusCode = code), out);
  out.json = (body: unknown) => ((out.body = body), out);
  return out;
}

async function run() {
  const req: any = {
    headers: { authorization: 'Bearer live-token' },
    method: 'POST',
    path: '/api/v1/users/presence/heartbeat',
    cookies: {},
  };
  const res = fakeRes();
  let nextCalled = false;
  await authMiddleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

beforeEach(() => {
  verifySupabaseToken.mockReset();
  verifySupabaseToken.mockResolvedValue({ isValid: true, user: { id: 'user-1' } });
  checkAccessTokenDenied.mockReset().mockResolvedValue('allowed');
  checkTokenIssuedBeforeUserCutoff.mockReset().mockResolvedValue('allowed');
  initializeAuthMiddleware({ verifySupabaseToken } as any);
});

describe('authMiddleware and an unverifiable revocation state', () => {
  it('answers 503 AUTH_TEMPORARILY_UNAVAILABLE when the denylist cannot be read', async () => {
    checkAccessTokenDenied.mockResolvedValue('unavailable');
    const { res, nextCalled } = await run();
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
    // The regression that matters: this must NOT read as a dead session.
    expect(res.body.code).not.toBe('SESSION_REVOKED');
  });

  it('answers 503 when the session-cutoff watermark cannot be read', async () => {
    checkTokenIssuedBeforeUserCutoff.mockResolvedValue('unavailable');
    const { res, nextCalled } = await run();
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
  });

  it('still answers 401 SESSION_REVOKED for a genuinely revoked token', async () => {
    checkAccessTokenDenied.mockResolvedValue('denied');
    const { res, nextCalled } = await run();
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('lets a healthy request through', async () => {
    const req: any = {
      headers: { authorization: 'Bearer live-token' },
      method: 'POST',
      path: '/api/v1/users/presence/heartbeat',
      cookies: {},
    };
    const res = fakeRes();
    // proceedWithAuth reaches next() from a floating async IIFE (the
    // deactivation gate), so next() lands a tick after authMiddleware resolves.
    const reached = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      void authMiddleware(req, res, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    expect(res.statusCode).toBeUndefined();
    expect(reached).toBe(true);
  });
});
