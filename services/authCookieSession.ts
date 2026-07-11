import type { Session, SupportedStorage } from '@supabase/supabase-js';
import { getApiBaseUrl } from '@lantern/shared';
import { setCachedAuthToken } from './supabase';

const API_BASE_URL = getApiBaseUrl();

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

export function applyMemorySession(session: Session | null): void {
  memorySession = session;
  setCachedAuthToken(session?.access_token ?? null, session?.user?.id ?? null);
}

export async function cookieAuthFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  const session = body.data?.session as Session | undefined;
  if (session) applyMemorySession(session);
  return { session: session ?? null };
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
  const next = body.data?.session as Session | undefined;
  if (next) applyMemorySession(next);
  return next ?? session;
}

export async function logoutCookieSession(): Promise<void> {
  try {
    await cookieAuthFetch('/logout', { method: 'POST' });
  } catch {
    // ignore network errors during logout
  }
  applyMemorySession(null);
}
