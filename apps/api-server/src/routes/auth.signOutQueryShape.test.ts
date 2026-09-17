/**
 * The two GoTrue global sign-outs in `routes/auth.ts` (lane R2, PR 2b).
 *
 * `POST /logout` and `POST /revoke-other-sessions` each call
 * `getClient().auth.admin.signOut(userId, 'global')` directly. Lane R2 moves
 * them into `services/data/users.ts` as a typed function; they are service-role
 * calls made from a route file, like any other escape.
 *
 * Written and committed against the UNTOUCHED routes.
 *
 * ## The ORDER is the security property
 *
 * A credential change must not leave a session alive on a device the user may no
 * longer control. `setUserSessionCutoff` is what actually enforces that — every
 * token issued before the cutoff stops being accepted — and it runs BEFORE the
 * GoTrue call, so a GoTrue failure cannot leave the old sessions valid. The
 * cases below pin that order, and pin that the route still answers 200 when
 * GoTrue fails, because the cutoff has already done the work.
 *
 * ## Issue #108, the GoTrue variant
 *
 * `auth.admin.signOut` RESOLVES with `{ error }`; it does not throw. The
 * `try/catch` around it therefore only catches a transport-level throw, and a
 * GoTrue-reported failure is dropped on the floor — the same shape as the 87
 * bare awaited writes, one layer up. Behaviour is frozen exactly as it is here;
 * see the KNOWN ISSUE at the call site.
 */
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const setUserSessionCutoff = jest.fn(async () => {});
const denylistAccessToken = jest.fn(async () => {});

jest.mock('../services/tokenDenylist', () => ({
  ...jest.requireActual('../services/tokenDenylist'),
  denylistAccessToken: (...a: unknown[]) => denylistAccessToken(...(a as [])),
  setUserSessionCutoff: (...a: unknown[]) => setUserSessionCutoff(...(a as [])),
}));

import router, { initializeAuthRoutes } from './auth';
import { createQueryRecorder, bindDataModule } from '../testSupport/queryRecorder';
import * as usersData from '../services/data/users';
import { runRouteHandler } from '../testSupport/queryRecorder';

const USER = 'user-1';

function initWith(authResult: Record<string, unknown> = { data: {}, error: null }) {
  const rec = createQueryRecorder({ data: null, error: null }, authResult);
  initializeAuthRoutes({
    getClient: () => rec.client,
    users: bindDataModule(usersData, rec.client),
  } as any, {
    invalidateUserCache: jest.fn(async () => {}),
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
  } as any);
  return rec;
}

beforeEach(() => {
  setUserSessionCutoff.mockClear();
  denylistAccessToken.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /logout', () => {
  it('signs the caller out of GoTrue globally, after setting the cutoff', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'post', '/logout', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Logged out successfully' });
    expect(rec.authCalls).toEqual([`signOut("${USER}", "global")`]);
    expect(setUserSessionCutoff).toHaveBeenCalledWith(USER);
    // No table is touched by this handler.
    expect(rec.tables()).toEqual([]);
  });

  it('still answers 200 when GoTrue throws — the cutoff already ended the sessions', async () => {
    const rec = createQueryRecorder({ data: null, error: null });
    rec.client.auth.admin.signOut = jest.fn(async () => {
      throw new Error('gotrue unreachable');
    });
    initializeAuthRoutes({
      getClient: () => rec.client,
      users: bindDataModule(usersData, rec.client),
    } as any, {
      invalidateUserCache: jest.fn(async () => {}),
    } as any);

    const res = await runRouteHandler(router, 'post', '/logout', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(setUserSessionCutoff).toHaveBeenCalledWith(USER);
  });
});

describe('POST /revoke-other-sessions', () => {
  it('sets the cutoff, then signs out globally', async () => {
    const rec = initWith();

    const res = await runRouteHandler(router, 'post', '/revoke-other-sessions', {
      user: { id: USER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Other sessions revoked' });
    expect(setUserSessionCutoff).toHaveBeenCalledWith(USER);
    expect(rec.authCalls).toEqual([`signOut("${USER}", "global")`]);
  });

  it('answers 200 even when GoTrue REPORTS an error — see the KNOWN ISSUE (#108)', async () => {
    // KNOWN ISSUE (tracked, #108): signOut resolves with `{error}` rather than
    // throwing, so the try/catch never fires and a GoTrue-reported failure is
    // discarded. Frozen as-is; R2 moves calls, it does not fix them.
    const rec = initWith({ data: {}, error: { message: 'user not found' } });

    const res = await runRouteHandler(router, 'post', '/revoke-other-sessions', {
      user: { id: USER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Other sessions revoked' });
    expect(rec.authCalls).toEqual([`signOut("${USER}", "global")`]);
  });
});
