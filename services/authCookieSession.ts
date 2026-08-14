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

function normalizeMemorySession(session: Partial<Session> | null): Session | null {
  if (!session?.access_token || !session.user) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token || 'cookie-managed',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type || 'bearer',
    user: session.user,
  } as Session;
}

export function applyMemorySession(session: Session | null): void {
  memorySession = normalizeMemorySession(session);
  setCachedAuthToken(memorySession?.access_token ?? null, memorySession?.user?.id ?? null);
  armCookieRefreshTimer(memorySession?.expires_at ?? null);
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

export async function cookieAuthFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const base = cookieAuthApiBase();
  return fetch(`${base}/api/v1/auth${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'LanternStudy',
      ...(init.headers || {}),
    },
  });
}

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

export async function refreshCookieSession(): Promise<Session | null> {
  const response = await cookieAuthFetch('/refresh', { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  const session = body.data?.session as Session | undefined;
  if (session) applyMemorySession(session);
  return session ?? null;
}

export async function fetchCookieSession(): Promise<Session | null> {
  const response = await cookieAuthFetch('/session', { method: 'GET' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  const session = body.data?.session as Session | undefined;
  if (session) applyMemorySession(session);
  return session ?? null;
}

export type CookieSessionResolveResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'revoked' | 'missing' | 'network' };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Restore cookie session with retries; distinguishes auth failure from transient errors. */
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
        const refreshed = normalizeMemorySession(refreshBody.data?.session);
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
      const session = normalizeMemorySession(body.data?.session);
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
