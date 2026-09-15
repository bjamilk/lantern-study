/**
 * `optionalAuthMiddleware` answered every verification failure the same way:
 * continue anonymously. That collapsed "this token is bad" into "Supabase is
 * unreachable", so a single blip downgraded a signed-in caller to a visitor —
 * an allowlisted buyer saw MARKETPLACE_PRIVATE, and every optional-auth route
 * served the public view of the caller's own data with a 200.
 *
 * F10: a transient failure now answers 503 AUTH_TEMPORARILY_UNAVAILABLE. A
 * genuinely bad credential still falls through to anonymous, because that is
 * the contract the public routes depend on.
 */
jest.mock('../services/adminAudit', () => ({
  getUserBlockState: jest.fn(async () => ({ banned: false, suspendedUntil: null })),
  isUserBanned: jest.fn(async () => false),
}));
jest.mock('../services/apiKey', () => ({
  apiKeyService: { isApiKeyFormat: () => false, validateKey: jest.fn(), hasPermission: () => true },
}));
jest.mock('../services/tokenDenylist', () => ({
  isAccessTokenDenied: jest.fn(async () => false),
  isTokenIssuedBeforeUserCutoff: jest.fn(async () => false),
  // SW: the middleware reads the tri-state twins so it can tell "revoked"
  // (401 SESSION_REVOKED) from "Redis unreachable" (503, retry).
  checkAccessTokenDenied: jest.fn(async () => 'allowed'),
  checkTokenIssuedBeforeUserCutoff: jest.fn(async () => 'allowed'),
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

import { initializeAuthMiddleware, optionalAuthMiddleware } from './auth';
import { isTransientAuthError } from '../services/supabase';

const verifySupabaseTokenDetailed = jest.fn();

function fakeRes() {
  const out: any = { statusCode: undefined, body: undefined };
  out.status = (code: number) => ((out.statusCode = code), out);
  out.json = (body: unknown) => ((out.body = body), out);
  return out;
}

async function run(headers: Record<string, string>) {
  const req: any = { headers, method: 'GET', path: '/api/v1/marketplace/listings', cookies: {} };
  const res = fakeRes();
  let nextCalled = false;
  await optionalAuthMiddleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

beforeEach(() => {
  verifySupabaseTokenDetailed.mockReset();
  initializeAuthMiddleware({ verifySupabaseTokenDetailed } as any);
});

describe('optionalAuthMiddleware and infrastructure failures', () => {
  it('answers 503 with a retryable code when verification could not be reached', async () => {
    verifySupabaseTokenDetailed.mockResolvedValue({ user: null, isValid: false, transient: true });
    const { res, nextCalled } = await run({ authorization: 'Bearer tok' });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
    // Not SESSION_REVOKED: the client must retry, not sign the student out.
    expect(res.body.code).not.toBe('SESSION_REVOKED');
  });

  it('answers 503 rather than anonymous when something on the path throws', async () => {
    verifySupabaseTokenDetailed.mockRejectedValue(new Error('redis exploded'));
    const { res, nextCalled } = await run({ authorization: 'Bearer tok' });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
  });

  it('still continues anonymously for a genuinely bad token', async () => {
    verifySupabaseTokenDetailed.mockResolvedValue({ user: null, isValid: false, transient: false });
    const { req, res, nextCalled } = await run({ authorization: 'Bearer nonsense' });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('still continues anonymously with no credential at all, without asking Supabase', async () => {
    const { nextCalled } = await run({});
    expect(nextCalled).toBe(true);
    expect(verifySupabaseTokenDetailed).not.toHaveBeenCalled();
  });

  it('still attaches the user on a good token', async () => {
    verifySupabaseTokenDetailed.mockResolvedValue({
      user: { id: 'user-1', app_metadata: {} },
      isValid: true,
      transient: false,
    });
    const { req, nextCalled } = await run({ authorization: 'Bearer good' });
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'user-1', credentialType: 'jwt' });
  });
});

describe('isTransientAuthError', () => {
  it('calls a 401/403 the token’s fault', () => {
    expect(isTransientAuthError({ status: 401 })).toBe(false);
    expect(isTransientAuthError({ status: 403 })).toBe(false);
  });

  it('calls a network or gateway failure the infrastructure’s fault', () => {
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isTransientAuthError({ status: 503 })).toBe(true);
    expect(isTransientAuthError({ status: 500 })).toBe(true);
  });

  it('treats an unrecognised shape as transient, because the other mistake signs a student out', () => {
    expect(isTransientAuthError({})).toBe(true);
    expect(isTransientAuthError(null)).toBe(true);
    expect(isTransientAuthError(new Error('boom'))).toBe(true);
  });
});
