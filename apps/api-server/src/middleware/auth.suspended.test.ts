/**
 * rejectIfBanned (Phase 1 · E): a time-boxed suspension answers 403
 * ACCOUNT_SUSPENDED with the date (no global sign-out), a ban keeps answering
 * ACCOUNT_BANNED, a clear account passes. The block state itself is covered
 * by services/adminAudit.suspended.test.ts; here it is mocked.
 */
jest.mock('../services/adminAudit', () => ({
  getUserBlockState: jest.fn(),
  isUserBanned: jest.fn(),
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

import { getUserBlockState } from '../services/adminAudit';
import { initializeAuthMiddleware, rejectIfBanned, rejectIfBannedOnly } from './auth';

function fakeRes() {
  const out: any = { statusCode: undefined, body: undefined };
  out.status = (code: number) => ((out.statusCode = code), out);
  out.json = (body: unknown) => ((out.body = body), out);
  return out;
}

beforeAll(() => {
  initializeAuthMiddleware({} as any);
});

describe('rejectIfBanned', () => {
  it('answers 403 ACCOUNT_SUSPENDED with the date for a future suspension', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({ banned: false, suspendedUntil: '2026-09-05T12:00:00Z' });
    const res = fakeRes();
    await expect(rejectIfBanned('u1', res)).resolves.toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      suspendedUntil: '2026-09-05T12:00:00Z',
      message: expect.stringMatching(/^Account suspended until 5 September 2026$/),
    });
  });

  it('answers 403 ACCOUNT_BANNED for a ban', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({ banned: true, suspendedUntil: null });
    const res = fakeRes();
    await expect(rejectIfBanned('u1', res)).resolves.toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_BANNED' });
  });

  it('passes a clear account (including a lapsed suspension, which the state layer reports as null)', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({ banned: false, suspendedUntil: null });
    const res = fakeRes();
    await expect(rejectIfBanned('u1', res)).resolves.toBe(false);
    expect(res.statusCode).toBeUndefined();
  });
});

/**
 * F10 (coordinator R1). The session gates in routes/auth.ts must NOT end a
 * suspended student's session: the product keeps them signed in so they can
 * read the dated notice, and suspension is enforced per request by the
 * middleware instead. `rejectIfBanned` fires on both states, so those gates use
 * this one.
 */
describe('rejectIfBannedOnly', () => {
  it('lets a SUSPENDED account through — the session must survive so the notice can be shown', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({
      banned: false,
      suspendedUntil: '2026-09-05T12:00:00Z',
    });
    const res = fakeRes();
    await expect(rejectIfBannedOnly('u1', res)).resolves.toBe(false);
    expect(res.statusCode).toBeUndefined();
    expect(res.body).toBeUndefined();
  });

  it('still refuses a BAN with the same body rejectIfBanned writes', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({ banned: true, suspendedUntil: null });
    const res = fakeRes();
    await expect(rejectIfBannedOnly('u1', res)).resolves.toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_BANNED' });
  });

  it('refuses a ban that also carries a suspension date', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({
      banned: true,
      suspendedUntil: '2026-09-05T12:00:00Z',
    });
    const res = fakeRes();
    await expect(rejectIfBannedOnly('u1', res)).resolves.toBe(true);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_BANNED' });
  });

  it('passes a clear account', async () => {
    (getUserBlockState as jest.Mock).mockResolvedValueOnce({ banned: false, suspendedUntil: null });
    const res = fakeRes();
    await expect(rejectIfBannedOnly('u1', res)).resolves.toBe(false);
  });
});
