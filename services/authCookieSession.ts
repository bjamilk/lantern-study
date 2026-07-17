import type { Session, SupportedStorage } from '@supabase/supabase-js';
import { getApiBaseUrl } from '@lantern/shared';
import { setCachedAuthToken } from './supabase';

/** Resolve per call so deployed web can use same-origin '' after config remap. */
function cookieAuthApiBase(): string {
  return (getApiBaseUrl() || '').replace(/\/$/, '');
}

export function isCookieAuthEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = import.meta.env.VITE_AUTH_COOKIE_MODE;
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return import.meta.env.PROD;
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

export async function logoutCookieSession(): Promise<void> {
  try {
    await cookieAuthFetch('/logout', { method: 'POST' });
  } catch {
    // ignore network errors during logout
  }
  applyMemorySession(null);
}
