/**
 * Client half of HttpOnly-cookie ("BFF") auth: the browser never holds a refresh
 * token, so the real session lives in cookies and this module keeps a
 * memory-only mirror of the access token for supabase-js and the API layer.
 *
 * Exports:
 *  - isCookieAuthEnabled()      — mode switch (PROD default on, VITE_AUTH_COOKIE_MODE overrides)
 *  - memoryAuthStorage          — the SupportedStorage handed to supabase-js in cookie mode
 *  - applyMemorySession()       — install/clear the session + token cache + refresh timer
 *  - cookieAuthFetch()          — fetch against /api/v1/auth with credentials + timeout
 *  - loginViaCookieBff(), refreshCookieSession(), fetchCookieSession(),
 *    restoreCookieSession(), exchangeCookieSession(), logoutCookieSession()
 *  - migrateLegacyLocalSession(), purgeLegacyLocalSession() — one-time localStorage migration
 *
 * Touches: the API server's /api/v1/auth/{login,refresh,session,exchange,logout};
 * `setCachedAuthToken` in ./supabase (circular — hence the dynamic import in
 * refreshAndPropagate); localStorage keys `sb-*-auth-token` (legacy only);
 * a `visibilitychange` listener; module-level memorySession + refreshTimer.
 *
 * Gotchas:
 *  - `refresh_token` is the literal placeholder `'cookie-managed'` in this mode.
 *    gotrue-js auto-refreshes internally whenever anything touches an expired
 *    session (getSession/setSession/refreshSession) and would POST that
 *    placeholder to /auth/v1/token, get a 400, and emit a spurious SIGNED_OUT.
 *    What makes those calls safe is the `global.fetch` interceptor on the
 *    supabase client in ./supabase — any second supabase client needs the same
 *    interceptor, or the random-sign-out bug returns.
 *  - Never send the placeholder back to /exchange: it would overwrite the real
 *    refresh cookie with the string 'cookie-managed' and the session could then
 *    never refresh. Guarded here and server-side.
 *  - autoRefreshToken is OFF in cookie mode, so the proactive timer below is the
 *    only thing keeping the access token alive past ~1h.
 *  - A non-null payload that fails to normalize must NOT wipe the token cache:
 *    doing so produced a boot redirect loop (empty cache, restore still ok).
 *    This module is deliberately tolerant; keep it that way.
 *  - Module-level state (memorySession, refreshTimer, visibilityHooked) survives
 *    a user switch — sign-out must go through applyMemorySession(null).
 *
 * State/history for individual decisions is documented at each function.
 */
import type { Session, SupportedStorage } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { getApiBaseUrl, getSupabaseUrl, getSupabaseAnonKey } from '@lantern/shared';
import { setCachedAuthToken } from './supabase';

/** Resolve per call so deployed web can use same-origin '' after config remap. */
function cookieAuthApiBase(): string {
  return (getApiBaseUrl() || '').replace(/\/$/, '');
}

/**
 * HttpOnly cookie BFF auth.
 *
 * Default ON in production builds; localStorage sessions remain the dev
 * default. Override either way with VITE_AUTH_COOKIE_MODE=true|false.
 *
 * History, because the OFF default survived long past its reason: cookie mode
 * was disabled in July 2026 blaming Cloudflare Pages Functions for stripping
 * Set-Cookie on proxied responses. Probing production (Aug 2026) shows both
 * auth cookies pass through the /api proxy intact, SameSite rewritten to Lax.
 * The real killers were two of our own bugs, both fixed: GET /session cleared
 * the refresh cookie on an expired access token instead of using it, and the
 * SIGNED_IN handler exchanged the 'cookie-managed' placeholder into the
 * refresh cookie, replacing the real token with a literal placeholder string.
 */
export function isCookieAuthEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const override = import.meta.env.VITE_AUTH_COOKIE_MODE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return import.meta.env.PROD === true;
}

let memorySession: Session | null = null;

// supabase-js persistence adapter for cookie mode: the session lives only in the
// module variable above, so nothing reaches localStorage and a closed tab has no
// recoverable token. Only the `*-auth-token` key is serviced; every other key
// reads as absent, which is what keeps supabase-js from persisting anything else.
export const memoryAuthStorage: SupportedStorage = {
  getItem: (key: string) => {
    if (!memorySession) return null;
    if (key.includes('auth-token')) {
      return JSON.stringify(memorySession);
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (!key.includes('auth-token')) return;
    try {
      memorySession = JSON.parse(value) as Session;
    } catch {
      memorySession = null;
    }
  },
  removeItem: (key: string) => {
    if (key.includes('auth-token')) {
      memorySession = null;
    }
  },
};

/** `exp` claim of a JWT, or null. The BFF's happy-path /session payload omits
 * expires_at entirely (apps/api-server/src/routes/auth.ts serializeClientSession
 * is called there without expires_in/expires_at), which left the proactive
 * refresh timer unarmed and the access token silently dying after ~1h. */
function accessTokenExpiry(accessToken: string): number | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join('')
      )
    ) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Accept what the server actually sends.
 *
 * The BFF returns `{ data: { session, user } }` — `user` is a SIBLING of
 * `session`, and several handlers serialize a session object that carries no
 * `user` of its own. Requiring `session.user` therefore rejected valid 200
 * payloads. A session is usable as soon as it has an `access_token`; the user
 * is taken from `session.user`, else the payload's sibling `user`, else left
 * null (the token still authenticates every API call).
 */
function normalizeMemorySession(
  session: Partial<Session> | null | undefined,
  fallbackUser?: unknown
): Session | null {
  if (!session?.access_token) return null;
  const user = (session.user ?? fallbackUser ?? null) as Session['user'];
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token || 'cookie-managed',
    expires_in: session.expires_in,
    expires_at: session.expires_at ?? accessTokenExpiry(session.access_token) ?? undefined,
    token_type: session.token_type || 'bearer',
    user,
  } as Session;
}

/** Normalize a BFF auth response body, pairing `data.session` with `data.user`. */
function normalizeSessionBody(body: unknown): Session | null {
  const data = (body as { data?: { session?: Partial<Session>; user?: unknown } })?.data;
  return normalizeMemorySession(data?.session ?? null, data?.user);
}

/**
 * Install a session into memory + the token cache.
 *
 * `null` means "explicitly signed out" and wipes the cache. A non-null payload
 * we cannot parse does NOT: wiping on a 200 the normalizer happened to reject
 * is what produced the boot redirect loop (cache emptied, restore still
 * reporting ok). Keep whatever token we already had and say so loudly.
 */
export function applyMemorySession(session: Partial<Session> | null, fallbackUser?: unknown): void {
  if (session === null) {
    memorySession = null;
    setCachedAuthToken(null, null);
    armCookieRefreshTimer(null);
    return;
  }
  const normalized = normalizeMemorySession(session, fallbackUser);
  if (!normalized) {
    console.error(
      '[auth] session payload rejected',
      typeof session === 'object' ? Object.keys(session as object) : typeof session
    );
    return; // keep the existing cached token
  }
  memorySession = normalized;
  setCachedAuthToken(normalized.access_token, normalized.user?.id ?? null);
  armCookieRefreshTimer(normalized.expires_at ?? null);
}

// ─── Proactive refresh ──────────────────────────────────────
// autoRefreshToken is off in cookie mode (the browser never holds the refresh
// token, so supabase-js cannot refresh). Without this timer the access token
// silently expired after ~1h and every API call started to 401 while the UI
// still looked signed in.

const REFRESH_BUFFER_MS = 5 * 60_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHooked = false;

function armCookieRefreshTimer(expiresAt: number | null | undefined): void {
  if (typeof window === 'undefined') return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!expiresAt) return;
  const fireIn = Math.max(30_000, expiresAt * 1000 - Date.now() - REFRESH_BUFFER_MS);
  refreshTimer = setTimeout(() => {
    void refreshAndPropagate();
  }, fireIn);

  if (!visibilityHooked) {
    visibilityHooked = true;
    // Timers do not fire in background tabs; catch up when the tab returns.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const exp = memorySession?.expires_at;
      if (exp && exp * 1000 - Date.now() < REFRESH_BUFFER_MS) {
        void refreshAndPropagate();
      }
    });
  }
}


/**
 * A timeout signal that also works where `AbortSignal.timeout` is missing
 * (Safari before 16, and the DOM test environment): fall back to an
 * AbortController armed by a timer, or to no signal at all.
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    return (AbortSignal as any).timeout(ms);
  }
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function refreshAndPropagate(): Promise<void> {
  const session = await refreshCookieSession(); // re-arms the timer via applyMemorySession
  if (!session?.access_token) return;
  try {
    // Push the fresh token into supabase-js so PostgREST and realtime pick it
    // up. Dynamic import: this module and ./supabase are already circular, and
    // a static call here at module-init time would hit an uninitialized client.
    const { supabase } = await import('./supabase');
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token || 'cookie-managed',
    });
  } catch {
    // Memory storage already carries the new token; API calls keep working.
  }
}

// ─── BFF calls ──────────────────────────────────────────────
// Every auth request goes through cookieAuthFetch: credentials:'include' is what
// carries the HttpOnly cookies, X-Requested-With is the CSRF signal the API
// checks, and the 8s default timeout stops a Render cold start from hanging boot.

export async function cookieAuthFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const base = cookieAuthApiBase();
  return fetch(`${base}/api/v1/auth${path}`, {
    ...init,
    credentials: 'include',
    signal: init.signal ?? timeoutSignal(8000),
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'LanternStudy',
      ...(init.headers || {}),
    },
  });
}

// Password login. /login only SETS the cookies; the session itself is then read
// back (refresh first, /session as fallback) so the caller gets a normalized
// session and the memory cache is populated before the app proceeds.
export async function loginViaCookieBff(
  email: string,
  password: string
): Promise<{ session: Session | null; error?: string }> {
  const response = await cookieAuthFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { session: null, error: body.error || body.message || 'Login failed' };
  }
  const session = (await refreshCookieSession()) ?? (await fetchCookieSession());
  return { session };
}

/** Returns the NORMALIZED session (or null) — never a raw payload the cache
 * would have rejected, so callers can't report success on an empty cache. */
export async function refreshCookieSession(): Promise<Session | null> {
  const response = await cookieAuthFetch('/refresh', { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  const session = normalizeSessionBody(body);
  if (session) applyMemorySession(session);
  else console.error('[auth] refresh payload rejected', Object.keys(body?.data ?? body ?? {}));
  return session;
}

export async function fetchCookieSession(): Promise<Session | null> {
  const response = await cookieAuthFetch('/session', { method: 'GET' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  const session = normalizeSessionBody(body);
  if (session) applyMemorySession(session);
  else console.error('[auth] session payload rejected', Object.keys(body?.data ?? body ?? {}));
  return session;
}

export type CookieSessionResolveResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'revoked' | 'missing' | 'network' };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Restore cookie session with retries; distinguishes auth failure from transient errors.
 *
 * Called at boot. The `reason` is load-bearing — callers must sign the user out
 * ONLY on 'revoked':
 *   401/403 on /session then 401/403 on /refresh → 'revoked'  (genuine sign-out)
 *   /session or /refresh !ok, or a thrown fetch  → 'network'  (retried, then keep the user)
 *   2xx whose body will not normalize            → 'missing'
 * Returning ok:true always means the memory cache was populated in the same
 * step (applyMemorySession), so a caller can never report success against an
 * empty cache — the shape that caused the boot redirect + request storm.
 */
export async function restoreCookieSession(
  maxAttempts = 3
): Promise<CookieSessionResolveResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const sessionResponse = await cookieAuthFetch('/session', { method: 'GET' });

      if (sessionResponse.status === 401 || sessionResponse.status === 403) {
        const refreshResponse = await cookieAuthFetch('/refresh', { method: 'POST' });
        if (refreshResponse.status === 401 || refreshResponse.status === 403) {
          return { ok: false, reason: 'revoked' };
        }
        if (!refreshResponse.ok) {
          if (attempt < maxAttempts - 1) {
            await delay(250 * (attempt + 1));
            continue;
          }
          return { ok: false, reason: 'network' };
        }
        const refreshBody = await refreshResponse.json().catch(() => ({}));
        const refreshed = normalizeSessionBody(refreshBody);
        if (refreshed) {
          applyMemorySession(refreshed);
          return { ok: true, session: refreshed };
        }
        return { ok: false, reason: 'missing' };
      }

      if (!sessionResponse.ok) {
        if (attempt < maxAttempts - 1) {
          await delay(250 * (attempt + 1));
          continue;
        }
        return { ok: false, reason: 'network' };
      }

      const body = await sessionResponse.json().catch(() => ({}));
      const session = normalizeSessionBody(body);
      if (!session) {
        console.error('[auth] session payload rejected', Object.keys(body?.data ?? body ?? {}));
      }
      if (session) {
        applyMemorySession(session);
        return { ok: true, session };
      }

      const refreshed = await refreshCookieSession();
      if (refreshed) {
        return { ok: true, session: refreshed };
      }
      return { ok: false, reason: 'missing' };
    } catch {
      if (attempt < maxAttempts - 1) {
        await delay(250 * (attempt + 1));
        continue;
      }
      return { ok: false, reason: 'network' };
    }
  }
  return { ok: false, reason: 'network' };
}

export async function exchangeCookieSession(session: Session): Promise<Session | null> {
  // A session restored FROM cookies carries the 'cookie-managed' placeholder,
  // not a real refresh token — the server never returns one to the browser.
  // Exchanging it back would overwrite the real refresh cookie with the
  // placeholder string and the session could never refresh again. This is the
  // client half of the guard; /exchange also refuses it server-side.
  if (!session.refresh_token || session.refresh_token === 'cookie-managed') {
    return session;
  }
  const response = await cookieAuthFetch('/exchange', {
    method: 'POST',
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: session.user,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return session;
  const hydrated = (await refreshCookieSession()) ?? (await fetchCookieSession());
  return hydrated ?? session;
}

// ─── Legacy localStorage migration ──────────────────────────
// Before cookie mode, supabase-js persisted the whole session (refresh token
// included) in localStorage. Flipping the default must not log those users
// out: their stored session is exchanged into HttpOnly cookies once, then the
// localStorage copy is deleted — which is the entire point of the migration.

function findLegacyLocalSession(): { key: string; session: Session } | null {
  if (typeof window === 'undefined') return null;
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      // FIXED (SW) [Sentry WEB-18, 55 events / 4 users]: a session written by a
      // build that ran in cookie mode carries the literal 'cookie-managed'
      // placeholder, not a refresh token. It is not a legacy session at all,
      // and treating it as one is the path that bypassed the fetch interceptor
      // (the throwaway client below has no `global.fetch`) and posted the
      // placeholder straight to /auth/v1/token for a guaranteed 400.
      if (parsed?.refresh_token === 'cookie-managed') continue;
      if (parsed?.access_token && parsed?.refresh_token && parsed?.user) {
        return { key, session: parsed as Session };
      }
    } catch {
      // fall through — an unparseable entry is not a session worth keeping
    }
  }
  return null;
}

export function purgeLegacyLocalSession(): void {
  if (typeof window === 'undefined') return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      localStorage.removeItem(key);
    }
  }
}

/**
 * Exchange a pre-cookie-mode localStorage session into HttpOnly cookies.
 * Returns the live session on success. Purges localStorage on success and on
 * definitive rejection; keeps it on network failure so a Render cold start
 * cannot log a user out — the migration simply retries on the next boot.
 */
export async function migrateLegacyLocalSession(): Promise<Session | null> {
  const legacy = findLegacyLocalSession();
  if (!legacy) return null;

  let candidate = legacy.session;
  const expired =
    typeof candidate.expires_at === 'number' &&
    candidate.expires_at * 1000 - Date.now() < 60_000;

  if (expired) {
    // Belt and braces with findLegacyLocalSession's filter (SW / WEB-18): this
    // client deliberately has NO `global.fetch` interceptor, so the placeholder
    // must never reach it.
    if (!candidate.refresh_token || candidate.refresh_token === 'cookie-managed') {
      purgeLegacyLocalSession();
      return null;
    }
    // /exchange verifies the access token, so an expired one must be refreshed
    // first. Throwaway client: no persistence, no timers — one refresh call.
    try {
      const throwaway = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await throwaway.auth.refreshSession({
        refresh_token: candidate.refresh_token,
      });
      if (error || !data.session) {
        // Refresh token no longer valid: the stored session is dead weight.
        purgeLegacyLocalSession();
        return null;
      }
      candidate = data.session;
    } catch {
      return null; // network — keep localStorage, retry next boot
    }
  }

  try {
    const response = await cookieAuthFetch('/exchange', {
      method: 'POST',
      body: JSON.stringify({
        access_token: candidate.access_token,
        refresh_token: candidate.refresh_token,
        expires_in: candidate.expires_in,
        expires_at: candidate.expires_at,
        token_type: candidate.token_type,
        user: candidate.user,
      }),
    });
    if (response.status === 400 || response.status === 401) {
      purgeLegacyLocalSession();
      return null;
    }
    if (!response.ok) {
      return null; // 5xx / rate limit — keep localStorage, retry next boot
    }
    purgeLegacyLocalSession();
    const hydrated = (await fetchCookieSession()) ?? normalizeMemorySession(candidate);
    if (hydrated) applyMemorySession(hydrated);
    return hydrated;
  } catch {
    return null; // network — keep localStorage, retry next boot
  }
}

export async function logoutCookieSession(): Promise<void> {
  try {
    await cookieAuthFetch('/logout', { method: 'POST' });
  } catch {
    // ignore network errors during logout
  }
  applyMemorySession(null);
}
