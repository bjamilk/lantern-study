/**
 * The web auth-retry policy (F1 / E3 C4).
 *
 * The bug these guard: a 403 answered on a still-valid session (a suspended
 * account gets one on EVERY authenticated call) went through the same
 * refresh-and-retry path as an expired 401. The refresh succeeded, the caller
 * recursed, the server answered 403 again — an unbounded refresh + request loop
 * that pinned the tab and hammered the API. The rules now: one retry per
 * request, never a retry on a 403, and a banned/revoked session signs out once
 * with the reason instead of being refreshed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshSession = vi.fn();
const setCachedAuthToken = vi.fn();
const noteSuspendedResponse = vi.fn(async () => true);

vi.mock('./supabase', () => ({
  supabase: { auth: { refreshSession: (...a: unknown[]) => refreshSession(...a) } },
  setCachedAuthToken: (...a: unknown[]) => setCachedAuthToken(...a),
}));
vi.mock('./accountSuspension', () => ({
  noteSuspendedResponse: (...a: unknown[]) => noteSuspendedResponse(...a),
}));

function authResponse(status: number, code?: string): Response {
  return new Response(JSON.stringify(code ? { code } : {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadHandler() {
  vi.resetModules();
  return import('./sessionHandler');
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } }, error: null });
});

describe('retry budget', () => {
  it('allows the first retry after a successful refresh', async () => {
    const h = await loadHandler();
    await expect(h.handleApiAuthFailure(authResponse(401), { attempt: 0 })).resolves.toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a second retry and does not refresh again', async () => {
    const h = await loadHandler();
    expect(await h.handleApiAuthFailure(authResponse(401), { attempt: 0 })).toBe(true);
    refreshSession.mockClear();

    expect(await h.handleApiAuthFailure(authResponse(401), { attempt: 1 })).toBe(false);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('never retries a 403, even one that would refresh cleanly (the C4 loop)', async () => {
    const h = await loadHandler();
    expect(await h.handleApiAuthFailure(authResponse(403), { attempt: 0 })).toBe(false);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('records an ACCOUNT_SUSPENDED 403 without retrying and without signing out', async () => {
    const h = await loadHandler();
    const expired = vi.fn();
    h.setSessionExpiredHandler(expired);

    expect(await h.handleApiAuthFailure(authResponse(403, 'ACCOUNT_SUSPENDED'), { attempt: 0 })).toBe(false);

    expect(noteSuspendedResponse).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    // A suspended student stays signed in so the blocking notice can render.
    expect(expired).not.toHaveBeenCalled();
  });

  // CHANGED (SW) [Sentry WEB-17]: a refresh failure the client cannot classify
  // is no longer a sign-out. Signing a student out because we could not TELL
  // whether the session was dead is the whole disease behind the 57
  // "Unexpected sign-out" events — an API 503 during a Redis blip, a Render
  // cold start and a dropped wifi all arrive here as an unclassifiable failure.
  // The request still fails and the caller still surfaces it; the session is
  // simply kept so the next call can succeed.
  it('gives up without refreshing, and without signing out, on an unclassifiable failure', async () => {
    const h = await loadHandler();
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'no' } });
    const expired = vi.fn();
    h.setSessionExpiredHandler(expired);

    expect(await h.handleApiAuthFailure(authResponse(401), { attempt: 0 })).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it('still signs out when the refresh is REFUSED (a dead refresh token)', async () => {
    const h = await loadHandler();
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token: Already Used', status: 400 },
    });
    const expired = vi.fn();
    h.setSessionExpiredHandler(expired);

    expect(await h.handleApiAuthFailure(authResponse(401), { attempt: 0 })).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe('banned / revoked sign-out', () => {
  for (const code of ['ACCOUNT_BANNED', 'SESSION_REVOKED', 'ACCOUNT_DEACTIVATED'] as const) {
    it(`${code}: signs out once with a reason and never retries`, async () => {
      const h = await loadHandler();
      const expired = vi.fn();
      h.setSessionExpiredHandler(expired);

      expect(await h.handleApiAuthFailure(authResponse(401, code), { attempt: 0 })).toBe(false);
      expect(refreshSession).not.toHaveBeenCalled();
      expect(expired).toHaveBeenCalledTimes(1);
      expect(String(expired.mock.calls[0][0])).not.toHaveLength(0);

      // Once — a second failure must not raise a second notice.
      await h.handleApiAuthFailure(authResponse(401, code), { attempt: 0 });
      expect(expired).toHaveBeenCalledTimes(1);
    });
  }

  it('signs out on a 403 carrying a terminal code too', async () => {
    const h = await loadHandler();
    const expired = vi.fn();
    h.setSessionExpiredHandler(expired);

    expect(await h.handleApiAuthFailure(authResponse(403, 'ACCOUNT_BANNED'), { attempt: 0 })).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('classifies without acting', async () => {
    const h = await loadHandler();
    expect(h.classifyAuthFailure(401, undefined)).toBe('refresh');
    expect(h.classifyAuthFailure(401, 'ACCOUNT_BANNED')).toBe('sign-out');
    expect(h.classifyAuthFailure(403, undefined)).toBe('give-up');
    expect(h.classifyAuthFailure(403, 'ACCOUNT_SUSPENDED')).toBe('suspended');
    expect(h.classifyAuthFailure(500, undefined)).toBe('give-up');
  });
});
