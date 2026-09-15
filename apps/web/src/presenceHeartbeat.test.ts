import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/supabase', () => ({
  getAuthHeaders: vi.fn(),
  getApiRoot: () => 'https://api.example.com',
  withApiCredentials: (init: RequestInit) => init,
  setCachedAuthToken: vi.fn(),
  supabase: {
    auth: {
      refreshSession: vi.fn(),
    },
  },
}));

vi.mock('../../../services/sessionHandler', async () => {
  const actual = await vi.importActual<typeof import('../../../services/sessionHandler')>(
    '../../../services/sessionHandler',
  );
  return {
    ...actual,
  };
});

// Static, not `await import()` inside a test: a dynamic import charges the
// module graph's load time to that test's 5s budget and fails under load.
import { getAuthHeaders, supabase } from '../../../services/supabase';
import {
  handleApiAuthFailure,
  resetSessionExpiredGuard,
  setSessionExpiredHandler,
} from '../../../services/sessionHandler';
import {
  sendPresenceHeartbeat,
  shouldRunPresenceHeartbeat,
} from '../../../services/presenceHeartbeat';

describe('shouldRunPresenceHeartbeat', () => {
  it('requires user, auth readiness, and online-status preference', () => {
    expect(
      shouldRunPresenceHeartbeat({
        userId: 'user-1',
        authTokenReady: true,
        showOnlineStatus: true,
      }),
    ).toBe(true);
  });

  it('does not run for logged-out / guest landing', () => {
    expect(
      shouldRunPresenceHeartbeat({
        userId: null,
        authTokenReady: false,
        showOnlineStatus: true,
      }),
    ).toBe(false);
  });

  it('does not run before authTokenReady even with a cached user id', () => {
    expect(
      shouldRunPresenceHeartbeat({
        userId: 'stale-user',
        authTokenReady: false,
        showOnlineStatus: true,
      }),
    ).toBe(false);
  });
});

describe('sendPresenceHeartbeat', () => {
  beforeEach(() => {
    resetSessionExpiredGuard();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setSessionExpiredHandler(() => undefined);
    resetSessionExpiredGuard();
    vi.unstubAllGlobals();
  });

  it('skips the request when there is no Authorization header', async () => {
    vi.mocked(getAuthHeaders).mockResolvedValue({ 'Content-Type': 'application/json' });
    await expect(sendPresenceHeartbeat()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  // FIXED (SW) [Sentry WEB-17]: a heartbeat 401 schedules ONE refresh and stops
  // the interval. It must never sign the user out — that is what turned a
  // two-minute online-status ping into 57 "Unexpected sign-out" events.
  it('a 401 tries one refresh and never signs the user out', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.mocked(getAuthHeaders).mockResolvedValue({
      Authorization: 'Bearer stale-token',
      'Content-Type': 'application/json',
    });
    vi.mocked(fetch).mockResolvedValue({ status: 401, ok: false } as Response);

    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token', status: 401 } as any,
    } as any);

    await expect(sendPresenceHeartbeat()).resolves.toBe(false);
    expect(onExpired).not.toHaveBeenCalled();
    // One beat, one refresh attempt, no retry storm.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);

    // A real API call still owns the sign-out decision.
    await expect(handleApiAuthFailure(401)).resolves.toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  // A transient refresh failure (API 503 / cold start / wifi) is not a
  // revocation: the session survives and the next call retries.
  it('does not sign out when the refresh is merely unavailable', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.mocked(getAuthHeaders).mockResolvedValue({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    vi.mocked(fetch).mockResolvedValue({ status: 401, ok: false } as Response);

    vi.mocked(supabase.auth.refreshSession).mockRejectedValue(new Error('Failed to fetch'));

    await expect(sendPresenceHeartbeat()).resolves.toBe(false);
    expect(onExpired).not.toHaveBeenCalled();
    await expect(handleApiAuthFailure(401)).resolves.toBe(false);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('retries once after a successful session refresh', async () => {
    vi.mocked(getAuthHeaders).mockResolvedValue({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce({ status: 401, ok: false } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);

    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'fresh-token',
          user: { id: 'user-1' },
        },
      },
      error: null,
    } as any);

    await expect(sendPresenceHeartbeat()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
