// @vitest-environment jsdom
/**
 * Regression cover for the cookie-auth boot redirect loop: a 200 /auth/session
 * payload the client rejected wiped the token cache, restore still reported
 * ok, and every concurrent boot fetch re-ran its own restore.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_AUTH_COOKIE_MODE', 'true');

import { applyMemorySession, fetchCookieSession } from './authCookieSession';
import { getAuthHeaders, setCachedAuthToken, resetCookieRestoreState } from './supabase';

/** A JWT whose `exp` is an hour out; only the payload segment is ever read. */
function makeToken(sub = 'user-1'): string {
  const body = { sub, exp: Math.floor(Date.now() / 1000) + 3600 };
  return `h.${btoa(JSON.stringify(body)).replace(/=+$/, '')}.s`;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCachedAuthToken(null, null);
  resetCookieRestoreState();
  applyMemorySession(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizeMemorySession tolerance', () => {
  it('accepts a session with access_token but no user (user arrives as a sibling)', async () => {
    const token = makeToken('user-9');
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { session: { access_token: token }, user: { id: 'user-9' } },
      })
    );

    const session = await fetchCookieSession();

    expect(session?.access_token).toBe(token);
    expect(session?.user?.id).toBe('user-9');
    // expires_at is absent from the server payload; derived from the JWT exp.
    expect(typeof session?.expires_at).toBe('number');
  });

  it('accepts a session with access_token and no user anywhere', async () => {
    const token = makeToken();
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { session: { access_token: token } } })
    );

    await expect(fetchCookieSession()).resolves.toMatchObject({ access_token: token });
  });
});

describe('applyMemorySession never wipes on an unparseable 200', () => {
  it('keeps the cached token and logs the payload keys', async () => {
    const good = makeToken('user-3');
    applyMemorySession({ access_token: good, user: { id: 'user-3' } } as never);

    const before = await getAuthHeaders();
    expect(before.Authorization).toBe(`Bearer ${good}`);

    applyMemorySession({ token_type: 'bearer', expires_in: 3600 } as never);

    expect(console.error).toHaveBeenCalledWith(
      '[auth] session payload rejected',
      expect.arrayContaining(['token_type', 'expires_in'])
    );
    const after = await getAuthHeaders();
    expect(after.Authorization).toBe(`Bearer ${good}`);
  });

  it('still wipes on an explicit signed-out (null) result', async () => {
    applyMemorySession({ access_token: makeToken(), user: { id: 'u' } } as never);
    applyMemorySession(null);
    fetchMock.mockResolvedValue(jsonResponse({ success: false }, 401));

    const headers = await getAuthHeaders();
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('getAuthHeaders cookie restore', () => {
  it('runs exactly ONE restore for 10 concurrent callers with an empty cache', async () => {
    const token = makeToken('user-7');
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        return jsonResponse({
          success: true,
          data: { session: { access_token: token }, user: { id: 'user-7' } },
        });
      }
      return jsonResponse({ success: false }, 401);
    });

    const results = await Promise.all(Array.from({ length: 10 }, () => getAuthHeaders()));

    for (const headers of results) {
      expect(headers.Authorization).toBe(`Bearer ${token}`);
    }
    const restoreCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/v1/auth/')
    );
    expect(restoreCalls.filter((c) => String(c[0]).includes('/auth/refresh'))).toHaveLength(1);
  });

  it('stops retrying after 3 failed restores', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500));

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await expect(getAuthHeaders()).resolves.not.toHaveProperty('Authorization');
    }
    const afterThree = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/v1/auth/')
    ).length;
    expect(afterThree).toBeGreaterThan(0);

    await getAuthHeaders();
    await getAuthHeaders();

    const afterFive = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/v1/auth/')
    ).length;
    expect(afterFive).toBe(afterThree);
  });
});
