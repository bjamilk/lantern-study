// @vitest-environment jsdom
/**
 * The cookie-mode token restore budget (F1 / E3 H13).
 *
 * The bug this guards: the give-up counter was per PAGE LOAD and was never
 * re-opened. Three failed restores during a Render cold start or a wifi drop
 * meant `getAuthHeaders` sent no Authorization for the REST of the session —
 * and because the token cache stayed null, the session-expired notice was
 * suppressed too, so the student just saw silently empty screens until they
 * reloaded by hand. It re-opens now on a cooldown, on `online` /
 * `visibilitychange`, and on any successful token set; a successful restore
 * zeroes it outright.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_AUTH_COOKIE_MODE', 'true');

import { getAuthHeaders, setCachedAuthToken, resetCookieRestoreState } from './supabase';
import { applyMemorySession } from './authCookieSession';

/** A JWT whose `exp` is an hour out; only the payload segment is ever read. */
function makeToken(sub = 'user-1'): string {
  const body = { sub, exp: Math.floor(Date.now() / 1000) + 3600 };
  return `h.${btoa(JSON.stringify(body)).replace(/=+$/, '')}.s`;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every cookie endpoint fails — the cold-start / offline shape. */
function failEverything() {
  fetchMock.mockResolvedValue(new Response('', { status: 503 }));
}

/** /auth/refresh answers with a live session. */
function succeedWith(token: string) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { session: { access_token: token }, user: { id: 'user-1' } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

/** Burn the budget: MAX_COOKIE_RESTORE_ATTEMPTS (3) failed restores. */
async function exhaustBudget() {
  failEverything();
  for (let i = 0; i < 3; i += 1) {
    setCachedAuthToken(null, null);
    await getAuthHeaders();
  }
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCachedAuthToken(null, null);
  resetCookieRestoreState();
  applyMemorySession(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cookie restore budget', () => {
  it('stops calling the BFF once the budget is spent', async () => {
    await exhaustBudget();
    const callsAfterBudget = fetchMock.mock.calls.length;

    setCachedAuthToken(null, null);
    const headers = await getAuthHeaders();

    expect(headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls.length).toBe(callsAfterBudget);
  });

  it('re-opens the budget when the cooldown passes, and a successful restore then works', async () => {
    vi.useFakeTimers();
    await exhaustBudget();

    // Past the 30s cooldown: the next call is allowed to try again.
    vi.setSystemTime(Date.now() + 31_000);
    const token = makeToken();
    succeedWith(token);
    setCachedAuthToken(null, null);

    const headers = await getAuthHeaders();
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('re-opens the budget on `online`', async () => {
    await exhaustBudget();

    window.dispatchEvent(new Event('online'));

    const token = makeToken('user-2');
    succeedWith(token);
    setCachedAuthToken(null, null);
    const headers = await getAuthHeaders();
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('re-opens the budget when a token is cached (sign-in after a failed boot)', async () => {
    await exhaustBudget();

    // Sign-in warms the cache; clearing it afterwards must NOT land back in the
    // spent-budget state.
    setCachedAuthToken(makeToken('user-3'), 'user-3');
    setCachedAuthToken(null, null);

    const token = makeToken('user-3');
    succeedWith(token);
    const headers = await getAuthHeaders();
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('a successful restore zeroes the failure count, so three LATER failures are needed again', async () => {
    failEverything();
    setCachedAuthToken(null, null);
    await getAuthHeaders();
    await (async () => {
      setCachedAuthToken(null, null);
      await getAuthHeaders();
    })();

    // One success in between.
    const token = makeToken('user-4');
    succeedWith(token);
    setCachedAuthToken(null, null);
    expect((await getAuthHeaders()).Authorization).toBe(`Bearer ${token}`);

    // Two more failures must NOT be enough to spend the budget.
    failEverything();
    for (let i = 0; i < 2; i += 1) {
      setCachedAuthToken(null, null);
      await getAuthHeaders();
    }
    const before = fetchMock.mock.calls.length;
    setCachedAuthToken(null, null);
    await getAuthHeaders();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
