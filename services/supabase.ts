import { createClient } from '@supabase/supabase-js'
import { markIntentionalSignOut } from './sentry';
import { Deck, Group, UserQuestionStats } from '../types'
import {
  getSupabaseUrl,
  getSupabaseAnonKey,
  getApiBaseUrl,
  shouldClearClientStorageKeyOnLogout,
  isMismatchedCloudSupabaseAnonKey,
  SUPABASE_INVALID_API_KEY_USER_MESSAGE,
} from '@lantern/shared'
import { mapUserFromApi, mapFlashcardsFromApi } from '@lantern/shared/utils/apiMappers'
import {
  listingsCacheKey,
  marketplaceCategoryAnalyticsCache,
  marketplaceListingsCache,
  parseRetryAfterMs,
  RateLimitError,
} from '@lantern/shared'
import { normalizeTestResultSession, retryUncertainDelivery } from '@lantern/shared/utils'
import {
  type UserSettings,
  normalizeUserSettings,
} from '@lantern/shared/settings'
import {
  normalizeListingRecord,
  normalizeInquiryRecord,
  normalizeFavoriteRecord,
  normalizeOfferRecord,
  normalizeStorageUrl,
} from '../utils/storageUrl'
import {
  isCookieAuthEnabled,
  memoryAuthStorage,
  refreshCookieSession,
  fetchCookieSession,
  logoutCookieSession,
  restoreCookieSession,
  migrateLegacyLocalSession,
  purgeLegacyLocalSession,
} from './authCookieSession'

// Use shared config for URLs (getConfig reconciles cloud URL + demo anon mismatches)
const supabaseUrl = getSupabaseUrl()
const supabaseAnonKey = getSupabaseAnonKey()
export const getApiRoot = () => (getApiBaseUrl() || "").replace(/\/$/, "")
const cookieAuthEnabled = typeof window !== 'undefined' && isCookieAuthEnabled()

if (
  typeof window !== 'undefined' &&
  isMismatchedCloudSupabaseAnonKey(supabaseUrl, supabaseAnonKey)
) {
  console.warn(`[Lantern] ${SUPABASE_INVALID_API_KEY_USER_MESSAGE}`)
}

async function createDeliveryResponseError(
  response: Response,
  fallbackMessage: string
): Promise<Error> {
  const body = await response.json().catch(() => ({})) as {
    error?: string;
    message?: string;
  };
  const error = new Error(body.error || body.message || fallbackMessage) as Error & {
    status?: number;
    deliveryUncertain?: boolean;
  };
  error.status = response.status;
  error.deliveryUncertain = response.status === 408 || response.status >= 500;
  return error;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: !cookieAuthEnabled,
    persistSession: !cookieAuthEnabled,
    detectSessionInUrl: true,
    storage: cookieAuthEnabled
      ? memoryAuthStorage
      : typeof window !== 'undefined'
        ? window.localStorage
        : undefined,
  },
  global: {
    headers: {
      // PostgREST will respond with JSON; include wildcard and object media type
      'Accept': 'application/json, text/plain, */*, application/vnd.pgrst.object+json',
    },
  },
})

// Helper function to fetch with timeout and optional 401 retry
const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number = 8000,
  allowRetry = true
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...withApiCredentials(options),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.status === 401 && allowRetry) {
      let authCode: string | undefined;
      try {
        const clone = response.clone();
        const body = (await clone.json().catch(() => ({}))) as { code?: string };
        authCode = body.code;
      } catch {
        authCode = undefined;
      }
      if (authCode === 'SESSION_REVOKED' || authCode === 'ACCOUNT_BANNED' || authCode === 'ACCOUNT_DEACTIVATED') {
        const { notifySessionExpired } = await import('./sessionHandler');
        notifySessionExpired();
        return response;
      }
      // A guest never had a session, so a 401 here is just an endpoint that
      // needs auth — "session expired" (and its redirect off public pages)
      // must only fire for viewers who actually held a token. Signed-in users
      // always have _cachedAccessToken warmed by getAuthHeaders in both auth
      // modes before any call can 401.
      const hadSession = _cachedAccessToken !== null;
      if (!hadSession) {
        return response;
      }
      let refreshed = false;
      if (cookieAuthEnabled) {
        const session = await refreshCookieSession();
        if (session?.access_token) {
          _cachedAccessToken = session.access_token;
          refreshed = true;
        }
      } else {
        try {
          const { data } = await supabase.auth.refreshSession();
          if (data.session?.access_token) {
            _cachedAccessToken = data.session.access_token;
            refreshed = true;
          }
        } catch {
          // ignore refresh failure
        }
      }
      if (refreshed) {
        const headers = await getAuthHeaders();
        const retryOptions: RequestInit = {
          ...options,
          headers: {
            ...(options.headers as Record<string, string> | undefined),
            ...headers,
          },
        };
        return fetchWithTimeout(url, retryOptions, timeoutMs, false);
      }
      const { notifySessionExpired } = await import('./sessionHandler');
      notifySessionExpired();
    }

    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
};

// ─── Cached Auth Token Layer ───────────────────────────────────────────────────
// Instead of calling supabase.auth.getSession() on every API request (which can
// take seconds on cold start), we cache the token in memory. The auth flow in
// useAppEffects.ts updates this cache whenever the session changes.
let _cachedAccessToken: string | null = null;
let _cachedUserId: string | null = null;

/** Call this from the auth initialization flow to populate the in-memory cache. */
export const setCachedAuthToken = (token: string | null, userId?: string | null) => {
  _cachedAccessToken = token;
  if (userId !== undefined) {
    _cachedUserId = userId;
  }
};

/** Remove all client-side auth/session footprints (localStorage, sessionStorage, cookies). */
export function clearAllClientAuthStorage(): void {
  setCachedAuthToken(null, null);
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
  // Preserve cookie consent (`lantern_cookie_*`) — it is not session data.
  Object.keys(localStorage).forEach((key) => {
    if (shouldClearClientStorageKeyOnLogout(key)) {
      localStorage.removeItem(key);
    }
  });
  try {
    document.cookie.split(';').forEach((cookie) => {
      const name = cookie.split('=')[0]?.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
  } catch {
    // ignore
  }
}

/** Merge cookie credentials + CSRF header for BFF auth when enabled. */
export function withApiCredentials(init: RequestInit = {}): RequestInit {
  const headers = {
    'X-Requested-With': 'LanternStudy',
    ...(init.headers as Record<string, string> | undefined),
  };
  const next = { ...init, headers };
  if (!isCookieAuthEnabled()) return next;
  return { ...next, credentials: 'include' };
}

/** Module-scoped CAS version for settings PUTs — reset on logout to avoid cross-user leaks. */
let lastKnownSettingsVersion: number | undefined;
/** Serialize settings PUTs so checklist / tips / theme syncs don't race the same CAS version. */
let settingsSaveQueue: Promise<unknown> = Promise.resolve();

/** Reset module-scoped CAS version cache (call on logout to avoid cross-user PC leaks). */
export function clearLastKnownSettingsVersion(): void {
  lastKnownSettingsVersion = undefined;
  settingsSaveQueue = Promise.resolve();
}

/** Server-side session invalidation + Supabase global sign-out + local cleanup. */
/**
 * Sign out every other device after a credential change. Best-effort: a
 * failure here must not make a successful password change look failed, but it
 * is logged loudly because it leaves stale sessions alive.
 */
export async function revokeOtherSessions(): Promise<boolean> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${getApiRoot()}/api/v1/auth/revoke-other-sessions`,
      withApiCredentials({ method: 'POST', headers })
    );
    return response.ok;
  } catch (e) {
    console.error('Failed to revoke other sessions after password change:', e);
    return false;
  }
}

export async function apiLogoutSession(): Promise<void> {
  // Every user-initiated logout funnels through here; marking it lets the
  // SIGNED_OUT handler tell a clicked logout from a session dying underneath.
  markIntentionalSignOut();
  try {
    if (isCookieAuthEnabled()) {
      await logoutCookieSession();
    } else {
      const headers = await getAuthHeaders();
      if (headers.Authorization) {
        await fetch(
          `${getApiRoot()}/api/v1/auth/logout`,
          withApiCredentials({ method: 'POST', headers })
        );
      }
    }
  } catch (e) {
    console.warn('Server logout failed:', e);
  }
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch (e) {
    console.warn('Supabase signOut failed:', e);
  }
  clearLastKnownSettingsVersion();
  clearAllClientAuthStorage();
}

/** Read the token from localStorage (Supabase SDK keys). */
export const getTokenFromLocalStorage = (): string | null => {
  if (typeof window === 'undefined') return null;
  
  // Read from Supabase SDK storage keys
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.access_token) return parsed.access_token;
        }
      } catch (e) {
        // skip invalid entries
      }
    }
  }
  return null;
};

/** Read the user ID from localStorage (Supabase SDK storage). */
export const getUserIdFromLocalStorage = (): string | null => {
  if (typeof window === 'undefined') return null;
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.user?.id) return parsed.user.id;
        }
      } catch (e) {}
    }
  }
  return null;
};

/** Unix expiry (seconds) from persisted Supabase session, if present. */
export const getStoredSessionExpiresAt = (): number | null => {
  if (typeof window === 'undefined') return null;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;
        const parsed = JSON.parse(stored);
        if (typeof parsed?.expires_at === 'number') return parsed.expires_at;
      } catch {
        // skip invalid entries
      }
    }
  }
  return null;
};

/** True when the stored access token expires within `bufferSeconds` (default 5 min). */
export const shouldRefreshStoredSession = (bufferSeconds = 300): boolean => {
  const expiresAt = getStoredSessionExpiresAt();
  if (!expiresAt) return false;
  return expiresAt - Date.now() / 1000 < bufferSeconds;
};

/** Read cached user from zustand persist (sync, no store rehydration wait). */
export const readPersistedAuthUser = (): Record<string, unknown> | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('auth-storage-v2');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.currentUser ?? null;
  } catch {
    return null;
  }
};

/**
 * Synchronous cold-start auth bootstrap from localStorage.
 * Warms the in-memory token cache so API calls work immediately.
 */
export const bootstrapAuthFromStorage = (): { token: string; userId: string } | null => {
  const token = getTokenFromLocalStorage();
  const userId = getUserIdFromLocalStorage();
  if (!token || !userId) return null;
  setCachedAuthToken(token, userId);
  return { token, userId };
};

/** Keep explicit — inferring from CookieSessionResolveResult collapses to `never` under the authCookieSession ↔ supabase cycle. */
export type SessionResolveFailure = 'revoked' | 'missing' | 'network';

export type SessionResolveResult =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']> }
  | { ok: false; reason: SessionResolveFailure };

/** Restore the client session from cookies or local tokens without signing out on transient errors. */
export async function resolveClientSession(): Promise<SessionResolveResult> {
  if (isCookieAuthEnabled()) {
    // Users from before the cookie-mode default still hold a full session in
    // localStorage. Exchange it into cookies once — logging every existing
    // web user out on deploy is not an acceptable migration.
    const migrated = await migrateLegacyLocalSession();
    if (migrated) {
      return { ok: true, session: migrated };
    }
    const restored = await restoreCookieSession();
    if (restored.ok) {
      // Cookies are authoritative now; a stale localStorage copy left behind
      // (e.g. migration raced a parallel tab) is just token exposure.
      purgeLegacyLocalSession();
    }
    return restored;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    if (session.access_token) {
      setCachedAuthToken(session.access_token, session.user.id);
    }
    return { ok: true, session };
  }

  if (!getTokenFromLocalStorage()) {
    return { ok: false, reason: 'missing' };
  }

  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session?.user) {
      setCachedAuthToken(data.session.access_token, data.session.user.id);
      return { ok: true, session: data.session };
    }
    if (error && (error.status === 401 || /invalid|expired|refresh/i.test(error.message))) {
      return { ok: false, reason: 'revoked' };
    }
    return { ok: false, reason: 'network' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function clearClientAuthSession(): Promise<void> {
  if (isCookieAuthEnabled()) {
    await logoutCookieSession();
  } else {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }
  setCachedAuthToken(null, null);
}

const getSessionWithTimeout = async (timeoutMs: number = 2000) => {
  try {
    const getSessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<{ timeout: boolean }>((resolve) => {
      setTimeout(() => resolve({ timeout: true }), timeoutMs);
    });
    
    const result = await Promise.race([
      getSessionPromise.then(res => ({ ...res, timeout: false })),
      timeoutPromise
    ]);
    
    if ('timeout' in result && result.timeout) {
      console.warn('[Supabase API] getSession timed out');
      return null;
    }
    
    const session = (result as any).data?.session ?? null;
    // Update the cache when we successfully get a session
    if (session?.access_token) {
      _cachedAccessToken = session.access_token;
      if (session.user?.id) {
        _cachedUserId = session.user.id;
      }
    }
    return session;
  } catch (err) {
    console.warn('[Supabase API] getSession error:', err);
    return null;
  }
};

// Helper function to get authenticated headers
// Uses cached token for instant resolution (~0ms) on the hot path.
// Only calls getSession() on the very first cold call when no cache/localStorage token exists.
export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const cookieMode = isCookieAuthEnabled();
  // 1. FAST PATH: Check in-memory cache (instant, no async)
  let token: string | null = _cachedAccessToken;
  
  // 2. Check localStorage (still fast, synchronous) — legacy token mode only
  if (!token && !cookieMode) {
    token = getTokenFromLocalStorage();
    if (token) {
      _cachedAccessToken = token; // warm the cache for next call
    }
  }
  
  // 3. Cookie BFF: restore session from HttpOnly cookies
  if (!token && cookieMode) {
    const session = await getSessionWithTimeout(1000);
    if (session?.access_token) {
      token = session.access_token;
      _cachedAccessToken = token;
    }
  }

  if (!token && cookieMode) {
    const refreshed = (await refreshCookieSession()) ?? (await fetchCookieSession());
    if (refreshed?.access_token) {
      token = refreshed.access_token;
      _cachedAccessToken = token;
      if (refreshed?.access_token) {
        token = refreshed.access_token;
        _cachedAccessToken = token;
        try {
          await supabase.auth.setSession({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || 'cookie-managed',
          });
        } catch {
          // ignore — memory cache is enough for API calls
        }
      }
    }
  }
  
  // 4. SLOW PATH (cold start only): Fall back to getSession with short timeout
  if (!token && !cookieMode) {
    const session = await getSessionWithTimeout(2000);
    if (session?.access_token) {
      token = session.access_token;
    }
  }
  
  // 5. Last resort: try refreshing the session (legacy mode)
  if (!token && !cookieMode) {
    try {
      const refreshPromise = supabase.auth.refreshSession();
      const timeoutPromise = new Promise<{ timeout: boolean }>((resolve) => {
        setTimeout(() => resolve({ timeout: true }), 2000);
      });
      
      const refreshResult = await Promise.race([
        refreshPromise.then(res => ({ ...res, timeout: false })),
        timeoutPromise
      ]);
      
      if (!('timeout' in refreshResult && refreshResult.timeout)) {
        const { data: refreshData } = refreshResult as any;
        if (refreshData?.session?.access_token) {
          token = refreshData.session.access_token;
          setCachedAuthToken(token, refreshData.session.user?.id);
        }
      }
    } catch (e) {
      // refresh failed
    }
  }
  
  if (token) {
    return {
      'Content-Type': 'application/json',
      'X-Requested-With': 'LanternStudy',
      'Authorization': `Bearer ${token}`,
    };
  }
  
  console.warn('No session token found for authenticated request');
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'LanternStudy',
  };
};

/** Returns true when a bearer token is available for API calls. */
export async function ensureAuthTokenReady(): Promise<boolean> {
  const headers = await getAuthHeaders();
  return Boolean(headers.Authorization);
};

export async function fetchSignedStorageUrl(
  bucket: string,
  path: string,
  expiresInSeconds?: number,
  variant: 'thumb' | 'original' = 'original',
): Promise<string> {
  const {
    getCachedSignedUrl,
    setCachedSignedUrl,
    signedUrlCacheKey,
  } = await import('../utils/signedUrlCache');
  const ttl = typeof expiresInSeconds === 'number' ? expiresInSeconds : 60 * 60 * 6;
  const cacheKey = signedUrlCacheKey(bucket, path, variant);
  const cached = getCachedSignedUrl(cacheKey);
  if (cached) return cached;

  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/storage/signed-url`,
    withApiCredentials({
      method: 'POST',
      headers,
      body: JSON.stringify({ bucket, path, expiresInSeconds: ttl, variant }),
    }),
    10000
  );
  const body = await response.json().catch(() => ({} as { error?: string; message?: string; data?: { signedUrl?: string } }));
  if (!response.ok) {
    throw new Error(body.error || body.message || 'Failed to sign storage URL');
  }
  if (!body.data?.signedUrl) {
    throw new Error('Signed URL missing from response');
  }
  setCachedSignedUrl(cacheKey, body.data.signedUrl, ttl);
  return body.data.signedUrl;
}

export const uploadProfileAvatar = async (
  userId: string,
  fileName: string,
  base64Data: string,
  contentType: string
): Promise<{ url: string; path: string; avatarUrl: string }> => {
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/users/${userId}/avatar`,
    withApiCredentials({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, base64Data, contentType }),
    }),
    15000
  );
  const body = await response.json().catch(() => ({} as { error?: string; message?: string; data?: { url: string; path: string; avatarUrl: string } }));
  if (!response.ok) {
    throw new Error(body.error || body.message || 'Failed to upload avatar');
  }
  if (!body.data?.avatarUrl) {
    throw new Error('Avatar upload response missing avatarUrl');
  }
  return body.data;
};

const getRequiredAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers = await getAuthHeaders();
  if (!headers.Authorization || !(await hasValidSession())) {
    throw new Error('Authentication required');
  }
  return headers;
};

// Helper to check if user has a valid session before making auth-required calls
export const hasValidSession = async (): Promise<boolean> => {
  // Fast path: check cache and localStorage first
  if (_cachedAccessToken) return true;
  if (getTokenFromLocalStorage()) return true;
  
  // Slow path: try getSession (only on cold start)
  const session = await getSessionWithTimeout(2000);
  if (session?.access_token) return true;
  return false;
};

// Helper to get the current authenticated user id (or null if not authenticated)
export const getAuthenticatedUserId = async (): Promise<string | null> => {
  // Fast path: check cache
  if (_cachedUserId) return _cachedUserId;
  
  // Check localStorage
  const lsUserId = getUserIdFromLocalStorage();
  if (lsUserId) {
    _cachedUserId = lsUserId;
    return lsUserId;
  }
  
  // Slow path: try getSession
  const session = await getSessionWithTimeout(2000);
  if (session?.user?.id) return session.user.id;
  return null;
};

/** Resolve user id for note file uploads using cached auth (avoids getUser() network call). */
export async function ensureNotesUploadSession(): Promise<{ userId: string }> {
  bootstrapAuthFromStorage();
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    throw new Error('Must be signed in to upload files.');
  }
  return { userId };
}

// For local development, the keys are default, but in production, set env vars.

export const createGroup = async (groupData: { name: string; description: string; avatar_url?: string; permissions: any; invite_id: string; parent_id?: string }, userId: string, memberIds: string[]) => {
  console.log('Creating group with data:', groupData, 'userId:', userId, 'memberIds:', memberIds);
  
  const response = await fetch(`${getApiRoot()}/api/v1/groups`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ ...groupData, userId, memberIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create group');
  }

  const result = await response.json();
  console.log('Group created:', result.data);
  return result.data;
};

export function mapGroupListFromApi(
  items: any[],
  unreadCounts: Record<string, number> = {},
): Group[] {
  return (items || []).map((g: any) => ({
    id: g.id,
    name: g.name,
    avatarUrl: g.avatar_url || g.avatarUrl,
    description: g.description,
    lastMessage: g.last_message || g.lastMessage,
    lastMessageTime: g.last_message_time || g.lastMessageTime,
    adminIds: g.admin_ids || g.adminIds || [],
    permissions: g.permissions || {},
    parentId: g.parent_id || g.parentId,
    isArchived: g.is_archived ?? g.isArchived ?? false,
    inviteId: g.invite_id || g.inviteId,
    unreadCount: unreadCounts[g.id] ?? g.unread_count ?? g.unreadCount ?? 0,
    pendingMembers: [],
    invitedPhoneNumbers: [],
    members: Array.isArray(g.members) ? g.members : [],
  }));
}

export const fetchGroups = async (userId: string): Promise<Group[]> => {
  console.log('Fetching groups for user:', userId);

  if (!(await hasValidSession())) {
    return [];
  }
  
  const response = await fetch(`${getApiRoot()}/api/v1/groups`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (response.status === 401 || response.status === 403) {
    const { handleApiAuthFailure } = await import('./sessionHandler');
    if (await handleApiAuthFailure(response.status)) {
      return fetchGroups(userId);
    }
    return [];
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch groups');
  }

  const result = await response.json();
  console.log('Fetched groups count:', result.data.length);
  return mapGroupListFromApi(result.data);
};

export const fetchGroupMembers = async (groupId: string, options?: { bustCache?: boolean }) => {
  console.log('Fetching members for group:', groupId);
  
  const params = new URLSearchParams();
  if (options?.bustCache) {
    params.set('_', String(Date.now()));
  }

  const query = params.toString();
  const response = await fetch(
    `${getApiRoot()}/api/v1/groups/${groupId}/members${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: await getAuthHeaders(),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch group members');
  }

  const result = await response.json();
  console.log('Fetched members count:', result.data.length);
  return result.data;
};

export const addGroupMember = async (groupId: string, userId: string) => {
  console.log('Adding member to group:', groupId, 'userId:', userId);
  
  if (!(await hasValidSession())) {
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (!refreshData?.session) {
      console.warn('No valid session for addGroupMember, skipping API call');
      throw new Error('No valid session. Please log in again.');
    }
  }

  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/members`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to add member to group');
  }

  const result = await response.json();
  console.log('Member added successfully');
  return result.data;
};

export const addGroupMembersBatch = async (groupId: string, userIds: string[]) => {
  console.log('Batch inviting members to group:', groupId, 'count:', userIds.length);
  
  // Ensure we have a valid session before making the call
  if (!(await hasValidSession())) {
    // Try to refresh the session
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (!refreshData?.session) {
      console.warn('No valid session for addGroupMembersBatch, skipping API call');
      throw new Error('No valid session. Please log in again.');
    }
  }

  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/members/batch`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ userIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to invite members to group');
  }

  const result = await response.json();
  console.log('Batch invite result:', result.data);
  return result.data as {
    invited: string[];
    added: string[];
    alreadyMembers: string[];
    alreadyPending: string[];
    failed: string[];
  };
};

export const fetchPendingGroupInvites = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/invites/pending`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to load pending invites');
  }
  const result = await response.json();
  return (result.data || []) as Array<{
    groupId: string;
    groupName: string;
    avatarUrl?: string;
    invitedAt?: string;
  }>;
};

export const acceptGroupInvite = async (groupId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/invites/accept`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to accept invite');
  }
  const result = await response.json();
  return result.data;
};

export const declineGroupInvite = async (groupId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/invites/decline`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to decline invite');
  }
  return true;
};

export const uploadGroupAvatar = async (
  groupId: string,
  fileName: string,
  base64Data: string,
  contentType: string
): Promise<{ url: string; path: string; avatarUrl: string }> => {
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/groups/${groupId}/avatar`,
    withApiCredentials({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, base64Data, contentType }),
    }),
    15000
  );
  const body = await response.json().catch(() => ({} as { error?: string; message?: string; data?: { url: string; path: string; avatarUrl: string } }));
  if (!response.ok) {
    throw new Error(body.error || body.message || 'Failed to upload group avatar');
  }
  if (!body.data?.avatarUrl) {
    throw new Error('Group avatar upload response missing avatarUrl');
  }
  return body.data;
};

export const fetchGroupInvitePreview = async (inviteId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/invite/${encodeURIComponent(inviteId)}`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to load invite');
  }
  const result = await response.json();
  return result.data as {
    id: string;
    name: string;
    description: string;
    avatarUrl?: string;
    memberCount: number;
    alreadyMember: boolean;
    pending: boolean;
  };
};

export const joinGroupByInvite = async (inviteId: string) => {
  console.log('Joining group via invite:', inviteId);
  
  const response = await fetch(`${getApiRoot()}/api/v1/groups/join`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ inviteId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || 'Failed to join group');
  }

  const result = await response.json();
  console.log('Joined group successfully:', result.data?.name);
  return result.data;
};

export const sendMessage = async (
  groupId: string,
  userId: string,
  content: string,
  clientMessageId?: string,
  options?: { replyToMessageId?: string; mentionedUserIds?: string[] }
) => {
  const body = JSON.stringify({
    content,
    userId,
    clientMessageId,
    replyToMessageId: options?.replyToMessageId,
    mentionedUserIds: options?.mentionedUserIds,
  });
  const request = async () => {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/group/${groupId}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication required. Please sign in again.');
      }
      throw await createDeliveryResponseError(response, 'Failed to send message');
    }

    const result = await response.json();
    return result.data;
  };

  return retryUncertainDelivery(request);
};

export const voteQuestion = async (messageId: string, userId: string, voteType: 'up' | 'down') => {
  console.log('Voting on message:', messageId, 'type:', voteType);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/${messageId}/vote`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        userId,
        voteType,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to vote on question');
    }

    const result = await response.json();
    console.log('Vote recorded:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error voting:', error);
    throw error;
  }
};

export const removeVote = async (messageId: string, userId: string) => {
  console.log('Removing vote on message:', messageId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/${messageId}/vote`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove vote');
    }

    const result = await response.json();
    console.log('Vote removed');
    return result.data;
  } catch (error) {
    console.error('Error removing vote:', error);
    throw error;
  }
};

export const fetchMessages = async (groupId: string, page?: number, limit?: number, before?: string) => {
  console.log('Fetching messages for group:', groupId, { page, limit, before });
  
  let url = `${getApiRoot()}/api/v1/messages/group/${groupId}?`;
  const params: string[] = [];
  if (page !== undefined) params.push(`page=${page}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  if (before !== undefined) params.push(`before=${encodeURIComponent(before)}`);
  url += params.join('&');

  const response = await fetch(url, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch messages');
  }

  const result = await response.json();
  const data = result?.data;
  const list = Array.isArray(data) ? data : [];
  console.log('Fetched messages count:', list.length);
  return list;
};

export const fetchGroupThread = async (groupId: string, rootId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/group/${encodeURIComponent(groupId)}/thread/${encodeURIComponent(rootId)}`,
    {
      method: 'GET',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as any).message || (error as any).error || 'Failed to fetch thread');
  }
  const result = await response.json();
  return Array.isArray(result?.data) ? result.data : [];
};

export const fetchDmThread = async (threadId: string, rootId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/thread/${encodeURIComponent(rootId)}`,
    {
      method: 'GET',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as any).message || (error as any).error || 'Failed to fetch thread');
  }
  const result = await response.json();
  return Array.isArray(result?.data) ? result.data : [];
};

export type ChatMessageMutationPayload = {
  id: string;
  groupId?: string;
  threadId?: string;
  senderId: string;
  timestamp: string;
  type: 'TEXT';
  text?: string;
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
};

const mutateChatMessage = async (
  path: string,
  method: 'PUT' | 'DELETE',
  content?: string
): Promise<ChatMessageMutationPayload> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/messages/${path}`,
    withApiCredentials({
      method,
      headers: await getAuthHeaders(),
      ...(method === 'PUT' ? { body: JSON.stringify({ content }) } : {}),
    })
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.message || 'Failed to update message');
  }
  return result.data as ChatMessageMutationPayload;
};

export const editGroupMessage = (messageId: string, content: string) =>
  mutateChatMessage(encodeURIComponent(messageId), 'PUT', content);

export const removeGroupMessage = (messageId: string) =>
  mutateChatMessage(encodeURIComponent(messageId), 'DELETE');

export const editDirectMessage = (messageId: string, content: string) =>
  mutateChatMessage(`dm-message/${encodeURIComponent(messageId)}`, 'PUT', content);

export const removeDirectMessage = (messageId: string) =>
  mutateChatMessage(`dm-message/${encodeURIComponent(messageId)}`, 'DELETE');

export const fetchUserVotesForGroup = async (groupId: string, userId: string): Promise<Record<string, 'up' | 'down'>> => {
  console.log('Fetching user votes for group:', groupId, 'userId:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/group/${groupId}/user-votes`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user votes');
    }

    const result = await response.json();
    console.log('Fetched user votes:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching user votes:', error);
    return {}; // Return empty object on error
  }
};

export const updateMessage = async (messageId: string, updates: { flagged_as_similar_user_ids?: string[] }) => {
  console.log('Updating message:', messageId, 'updates:', updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/${messageId}/update`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        flaggedUserIds: updates.flagged_as_similar_user_ids,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update message');
    }

    const result = await response.json();
    console.log('Message updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
};

export const updateQuestionStatus = async (messageId: string, questionStatus: string) => {
  console.log('Updating question status:', messageId, 'to:', questionStatus);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/${messageId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ questionStatus }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update question status');
    }

    const result = await response.json();
    console.log('Question status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating question status:', error);
    throw error;
  }
};

// --- Flashcard Functions ---

export const createDeck = async (deckData: { name: string; description?: string; isShared?: boolean }, userId: string) => {
  console.log('Creating deck:', deckData.name, 'isShared:', deckData.isShared);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: deckData.name,
        description: deckData.description,
        isShared: deckData.isShared,
        userId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create deck');
    }

    const result = await response.json();
    console.log('Deck created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating deck:', error);
    throw error;
  }
};

/** API caps deck page size at 50 — paginate until all decks are loaded. */
export const DECK_API_PAGE_SIZE = 50;

/** Normalize one API deck row (snake_case) to the client Deck shape. */
export const mapDeckFromApi = (d: any): Deck => ({
  id: d.id,
  name: d.name,
  description: d.description,
  createdAt: d.created_at || d.createdAt,
  userId: d.user_id || d.userId,
  isShared: d.is_shared ?? d.isShared ?? false,
});

/** Map raw API deck rows to client Deck objects, dropping malformed rows. */
export const mapDecksFromApi = (rows: any[]): Deck[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d && d.id)
    .map(mapDeckFromApi);

export const fetchDecks = async (userId: string, options?: { includeShared?: boolean }) => {
  const includeShared = options?.includeShared ?? false;
  console.log('Fetching decks for user:', userId, 'includeShared:', includeShared);
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    // Page through the full deck list — a single request only returns the
    // API's default page (20 decks), silently hiding the rest.
    const collected: any[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams();
      params.set('userId', userId);
      if (includeShared) params.set('includeShared', 'true');
      params.set('page', String(page));
      params.set('limit', String(DECK_API_PAGE_SIZE));

      const response = await fetch(`${getApiRoot()}/api/v1/decks?${params.toString()}`, {
        method: 'GET',
        headers: await getAuthHeaders(),
      });

      if (response.status === 401 || response.status === 403) {
        return [];
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch decks');
      }

      const result = await response.json();
      const rows = Array.isArray(result.data) ? result.data : [];
      collected.push(...rows);
      if (rows.length < DECK_API_PAGE_SIZE) break;
      page += 1;
    }

    console.log('Fetched decks count:', collected.length);
    return collected.filter((d: any) => d && d.id);
  } catch (error) {
    console.error('Error fetching decks:', error);
    throw error;
  }
};

export const updateDeck = async (deckId: string, updates: { name?: string; description?: string; isShared?: boolean }) => {
  console.log('Updating deck:', deckId, 'updates:', updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update deck');
    }

    const result = await response.json();
    console.log('Deck updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating deck:', error);
    throw error;
  }
};

export const fetchUsers = async (search?: string, options?: { page?: number; limit?: number }) => {
  console.log('Fetching users', 'search:', search);
  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(options?.page ?? 1));
    params.set('limit', String(options?.limit ?? 20));

    const response = await fetch(`${getApiRoot()}/api/v1/users?${params.toString()}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch users');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

export const searchUsers = async (query: string, limit: number = 20) => {
  try {
    // Preserve leading @ so the API can prefer username matches for @queries.
    const searchQuery = query.trim();
    if (searchQuery.replace(/^@+/, '').length < 2) {
      return [];
    }
    const response = await fetchWithTimeout(
      `${getApiRoot()}/api/v1/users/search?q=${encodeURIComponent(searchQuery)}&limit=${limit}`,
      {
        method: 'GET',
        headers: await getAuthHeaders(),
      },
      8000,
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'Failed to search users');
    }
    const result = await response.json();
    return (result.data || []).map((user: Record<string, unknown>) => ({
      id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? user.firstName ?? null,
      last_name: user.last_name ?? user.lastName ?? null,
      name: user.name ?? '',
      avatar_url: user.avatar_url ?? user.avatarUrl ?? null,
    }));
  } catch (error) {
    console.error('Error searching users:', error);
    throw error;
  }
};

export const fetchDeckCollaborators = async (deckId: string) => {
  console.log('Fetching collaborators for deck:', deckId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/collaborators`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch deck collaborators');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching deck collaborators:', error);
    throw error;
  }
};

export const addDeckCollaborator = async (deckId: string, userId: string, role: string = 'editor') => {
  console.log('Adding collaborator to deck:', deckId, userId, role);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/collaborators`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, role }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add collaborator');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error adding deck collaborator:', error);
    throw error;
  }
};

export const removeDeckCollaborator = async (deckId: string, userId: string) => {
  console.log('Removing collaborator from deck:', deckId, userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/collaborators/${userId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove collaborator');
    }

    return true;
  } catch (error) {
    console.error('Error removing deck collaborator:', error);
    throw error;
  }
};

export const deleteDeck = async (deckId: string) => {
  console.log('Deleting deck:', deckId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete deck');
    }

    console.log('Deck deleted');
  } catch (error) {
    console.error('Error deleting deck:', error);
    throw error;
  }
};

export const createFlashcard = async (flashcardData: {
  deckId: string;
  type: string;
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: any;
  srsData?: any;
  tags?: string[];
  userId?: string;
}) => {
  console.log('Creating flashcard for deck:', flashcardData.deckId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        deckId: flashcardData.deckId,
        type: flashcardData.type || 'BASIC',
        front: flashcardData.front,
        back: flashcardData.back,
        clozeText: flashcardData.clozeText,
        imageUrl: flashcardData.imageUrl,
        occlusionData: flashcardData.occlusionData,
        tags: flashcardData.tags,
        userId: flashcardData.userId || await getAuthenticatedUserId() || undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create flashcard');
    }

    const result = await response.json();
    console.log('Flashcard created:', result.data);
    return result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error('Error creating flashcard:', message);
    throw error;
  }
};

export const fetchFlashcardComments = async (flashcardId: string) => {
  console.log('Fetching comments for flashcard:', flashcardId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}/comments`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch flashcard comments');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching flashcard comments:', error);
    throw error;
  }
};

export const addFlashcardComment = async (flashcardId: string, userId: string, comment: string) => {
  console.log('Adding comment to flashcard:', flashcardId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}/comments`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, comment }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add comment');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error adding flashcard comment:', error);
    throw error;
  }
};

export const fetchFlashcards = async (
  deckId?: string,
  userId?: string,
  options?: { page?: number; limit?: number }
) => {
  console.log('Fetching flashcards', deckId ? `for deck: ${deckId}` : 'for all decks', userId ? `for user: ${userId}` : '');
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    const params = new URLSearchParams();

    if (deckId) {
      params.append('deckId', deckId);
    }

    if (userId) params.append('userId', userId);

    // default to a large page size so UI can show all cards in deck without requiring paging
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 1000;
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const url = `${getApiRoot()}/api/v1/flashcards?${params.toString()}`;
    console.log('Fetching flashcards URL:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch flashcards');
    }

    const result = await response.json();
    console.log('Fetched flashcards count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching flashcards:', error);
    throw error;
  }
};

/** API caps page size at 100 — paginate until all cards are loaded, then normalize SRS. */
export const FLASHCARD_API_PAGE_SIZE = 100;

export const fetchAllFlashcards = async (deckId?: string, userId?: string) => {
  const collected: any[] = [];
  let page = 1;

  while (true) {
    const batch = await fetchFlashcards(deckId, userId, {
      page,
      limit: FLASHCARD_API_PAGE_SIZE,
    });
    const rows = Array.isArray(batch) ? batch : [];
    collected.push(...rows);
    if (rows.length < FLASHCARD_API_PAGE_SIZE) break;
    page += 1;
  }

  return mapFlashcardsFromApi(collected);
};

// Note: a card's type and deck are set at creation and cannot be changed via
// update — the server ignores (soon: rejects) them, so they are not accepted here.
export const updateFlashcard = async (flashcardId: string, updates: {
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: any;
  tags?: string[];
}) => {
  console.log('Updating flashcard:', flashcardId, 'updates:', updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        front: updates.front,
        back: updates.back,
        clozeText: updates.clozeText,
        imageUrl: updates.imageUrl,
        occlusionData: updates.occlusionData,
        tags: updates.tags,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update flashcard');
    }

    const result = await response.json();
    console.log('Flashcard updated:', result.data);
    return result.data;
  } catch (error: any) {
    console.error('Error updating flashcard:', error.message || JSON.stringify(error));
    throw error;
  }
};

export const reviewFlashcard = async (
  flashcardId: string,
  rating: 'again' | 'hard' | 'good' | 'easy',
  expectedVersion?: number
) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}/review`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        rating,
        ...(expectedVersion != null ? { expectedVersion } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 409 || error.code === 'version_conflict') {
        const err = new Error(
          error.error || error.message || 'Flashcard was updated elsewhere'
        ) as Error & { code?: string; status?: number; current?: unknown };
        err.code = 'version_conflict';
        err.status = 409;
        err.current = error.data ?? null;
        throw err;
      }
      // Carry the HTTP status so the offline sync queue can classify the
      // failure (e.g. drop reviews for cards that no longer exist).
      const err = new Error(
        error.error || error.message || 'Failed to review flashcard'
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const result = await response.json();
    return result.data;
  } catch (error: any) {
    console.error('Error reviewing flashcard:', error.message || JSON.stringify(error));
    throw error;
  }
};

export const deleteFlashcard = async (flashcardId: string) => {
  console.log('Deleting flashcard:', flashcardId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete flashcard');
    }

    console.log('Flashcard deleted');
  } catch (error) {
    console.error('Error deleting flashcard:', error);
    throw error;
  }
};

// Reset SRS statistics for all flashcards in a deck
export const resetDeckStatistics = async (deckId: string, userId?: string) => {
  console.log('Resetting SRS statistics for deck:', deckId, userId ? `(user ${userId})` : '');
  try {
    const body: any = {};
    if (userId) body.userId = userId;

    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/reset`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to reset deck statistics');
    }

    const result = await response.json();
    console.log('Deck statistics reset');
    return result.data;
  } catch (error) {
    console.error('Error resetting deck statistics:', error);
    throw error;
  }
};

// Export deck with all flashcards
export const exportDeck = async (deckId: string) => {
  console.log('Exporting deck:', deckId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/export`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to export deck');
    }

    const result = await response.json();
    console.log('Deck exported successfully');
    return result.data;
  } catch (error) {
    console.error('Error exporting deck:', error);
    throw error;
  }
};

// Import deck from export data
export const importDeck = async (importData: any, userId: string): Promise<{deck: any; flashcards: any[]}> => {
  console.log('Importing deck for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks/import`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        importData,
        userId,
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to import deck';
      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch {
        errorMessage = `Server error (${response.status})`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('Deck imported successfully', result.data);
    return result.data; // { deck: ..., flashcards: [...] }
  } catch (error) {
    console.error('Error importing deck:', error);
    throw error;
  }
};

export const exportDeckCsv = async (deckId: string): Promise<string> => {
  const response = await fetch(`${getApiRoot()}/api/v1/decks/${deckId}/export/csv`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to export deck as CSV');
  return response.text();
};

export const importDeckCsv = async (csv: string, userId: string, deckName?: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/decks/import/csv`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ csv, userId, deckName }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'Failed to import CSV');
  }
  const result = await response.json();
  return result.data;
};

export const importDeckApkg = async (apkgBase64: string, userId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/decks/import/apkg`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ apkgBase64, userId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'Failed to import APKG');
  }
  const result = await response.json();
  return result.data;
};

// --- Test Sessions and Results ---

export const createTestSession = async (sessionData: {
  config: any;
  questions: any[];
  user_answers: Record<string, any>;
  start_time: string;
  end_time?: string;
  is_offline: boolean;
}, userId: string) => {
  console.log('Creating test session for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/tests`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        ...sessionData,
        userId
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message =
        (typeof errorBody.message === 'string' && errorBody.message) ||
        (typeof errorBody.error === 'string' && errorBody.error) ||
        `HTTP error! status: ${response.status}`;
      throw new Error(message);
    }

    const result = await response.json();
    console.log('Test session created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating test session:', error);
    throw error;
  }
};

export const updateTestSession = async (sessionId: string, updates: {
  user_answers?: Record<string, any>;
  end_time?: string;
}, userId: string) => {
  console.log('Updating test session:', sessionId, 'updates:', updates, 'user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/tests/${sessionId}/submit`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        answers: updates.user_answers ? Object.values(updates.user_answers) : [],
        userId
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Test session updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating test session:', error);
    throw error;
  }
};

export const createTestResult = async (resultData: {
  session_id: string;
  score: number;
  correct_answers_count: number;
  total_questions: number;
  activityDate?: string;
}) => {
  console.log('Creating test result for session:', resultData.session_id);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/tests/${resultData.session_id}/results`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        score: resultData.score,
        correctAnswersCount: resultData.correct_answers_count,
        totalQuestions: resultData.total_questions,
        activityDate: resultData.activityDate,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Test result created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating test result:', error);
    throw error;
  }
};

export type TestResultsSort = 'newest' | 'oldest' | 'highestScore';

export type FetchTestResultsOptions = {
  limit?: number;
  page?: number;
  lean?: boolean;
  sort?: TestResultsSort;
  from?: string;
  to?: string;
};

function mapTestResultItem(item: any) {
  if (!item?.session) return item;
  const normalized = normalizeTestResultSession(item.session);
  return {
    ...item,
    id: item.id ?? item.session?.id,
    session: {
      ...item.session,
      questions: normalized.questions,
      userAnswers: normalized.userAnswers,
    },
  };
}

export const fetchTestResultsPage = async (
  userId: string,
  options?: FetchTestResultsOptions
): Promise<{
  data: any[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
}> => {
  if (!(await hasValidSession())) {
    return { data: [], pagination: { page: 1, limit: options?.limit ?? 10, total: 0, hasMore: false } };
  }

  const page = options?.page ?? 1;
  const limit = options?.limit ?? 10;
  const params = new URLSearchParams({
    status: 'completed',
    page: String(page),
    limit: String(limit),
    sort: options?.sort ?? 'newest',
  });
  if (options?.lean !== false) params.set('lean', '1');
  if (options?.from) params.set('from', options.from);
  if (options?.to) params.set('to', options.to);

  const response = await fetch(`${getApiRoot()}/api/v1/tests?${params.toString()}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (response.status === 401 || response.status === 403) {
    return { data: [], pagination: { page, limit, total: 0, hasMore: false } };
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  const data = (result.data || []).map(mapTestResultItem);
  const pagination = result.pagination || {
    page,
    limit,
    total: data.length,
    hasMore: false,
  };
  return { data, pagination };
};

export const fetchTestResults = async (userId: string, options?: FetchTestResultsOptions) => {
  console.log('Fetching test results for user:', userId);
  try {
    const pageSize = options?.limit ?? 500;
    const lean = options?.lean !== false;
    const sort = options?.sort ?? 'newest';

    // Explicit page => single page (callers that need paging use fetchTestResultsPage).
    if (options?.page != null) {
      const { data } = await fetchTestResultsPage(userId, {
        ...options,
        page: options.page,
        limit: pageSize,
        lean,
        sort,
      });
      console.log('Fetched test results count:', data.length);
      return data;
    }

    // Default: walk all lean pages so all-time charts include full history.
    const all: any[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 100;
    while (hasMore && page <= maxPages) {
      const { data, pagination } = await fetchTestResultsPage(userId, {
        ...options,
        page,
        limit: pageSize,
        lean,
        sort,
      });
      all.push(...data);
      hasMore = Boolean(pagination?.hasMore) && data.length > 0;
      page += 1;
    }
    console.log('Fetched test results count:', all.length);
    return all;
  } catch (error) {
    console.error('Error fetching test results:', error);
    throw error;
  }
};

/** Full session payload for Analyze/Review when list rows are lean. */
export const fetchTestSessionById = async (sessionId: string): Promise<any | null> => {
  try {
    if (!(await hasValidSession()) || !sessionId) return null;
    const response = await fetch(`${getApiRoot()}/api/v1/tests/${sessionId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const row = result?.data;
    if (!row) return null;

    // Nested TestResult shape from some list/detail responses.
    if (row.session) return mapTestResultItem(row);

    // GET /tests/:id returns mapTestSessionRowToClient (camelCase) fields.
    const startRaw = row.startTime ?? row.start_time;
    const endRaw = row.endTime ?? row.end_time;
    const normalized = normalizeTestResultSession({
      id: row.id,
      config: row.config,
      questions: row.questions,
      userAnswers: row.userAnswers ?? row.user_answers,
      startTime: startRaw,
      endTime: endRaw,
    });
    const recomputedCorrect = Object.values(normalized.userAnswers).filter(
      (answer) => answer?.isCorrect
    ).length;
    const totalQuestions =
      typeof row.totalQuestions === 'number' && row.totalQuestions > 0
        ? row.totalQuestions
        : normalized.questions.length;
    const correctAnswersCount =
      typeof row.correctAnswersCount === 'number'
        ? row.correctAnswersCount
        : typeof row.correct_answers_count === 'number'
          ? row.correct_answers_count
          : recomputedCorrect;
    const score =
      typeof row.score === 'number'
        ? row.score
        : totalQuestions > 0
          ? (correctAnswersCount / totalQuestions) * 100
          : 0;

    return {
      id: row.id,
      session: {
        id: row.id,
        config: row.config || {},
        questions: normalized.questions,
        userAnswers: normalized.userAnswers,
        currentQuestionIndex: row.currentQuestionIndex ?? row.current_question_index ?? 0,
        startTime: startRaw ? new Date(startRaw) : new Date(),
        endTime: endRaw ? new Date(endRaw) : undefined,
        isOffline: row.isOffline ?? row.is_offline ?? false,
        sessionKind: row.sessionKind ?? row.session_kind,
        status: row.status,
      },
      score,
      totalQuestions,
      correctAnswersCount,
    };
  } catch (error) {
    console.error('Error fetching test session:', error);
    return null;
  }
};

// --- User Question Stats ---

export const upsertUserQuestionStat = async (userId: string, questionId: string, stat: {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
}) => {
  if (!(await hasValidSession())) {
    return null;
  }

  const body = JSON.stringify({
    userId,
    questionId,
    correctAttempts: stat.correctAttempts,
    incorrectAttempts: stat.incorrectAttempts,
    lastAttempted: stat.lastAttempted,
  });

  const doFetch = async () =>
    fetch(`${getApiRoot()}/api/v1/user-stats`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body,
    });

  try {
    let response = await doFetch();

    if (response.status === 401 || response.status === 403) {
      const { handleApiAuthFailure } = await import('./sessionHandler');
      if (await handleApiAuthFailure(response.status)) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({} as Record<string, string>));
      throw new Error(error.message || error.error || 'Failed to upsert user question stat');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error upserting user question stat:', error);
    throw error;
  }
};

export const fetchUserQuestionStats = async (userId: string) => {
  try {
    if (!(await hasValidSession())) {
      return {} as UserQuestionStats;
    }

    const response = await fetch(`${getApiRoot()}/api/v1/user-stats/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      const { handleApiAuthFailure } = await import('./sessionHandler');
      if (await handleApiAuthFailure(response.status)) {
        const retry = await fetch(`${getApiRoot()}/api/v1/user-stats/${encodeURIComponent(userId)}`, {
          method: 'GET',
          headers: await getAuthHeaders(),
        });
        if (retry.status === 401 || retry.status === 403) {
          console.debug('Auth not ready for user-stats, returning empty');
          return {} as UserQuestionStats;
        }
        if (!retry.ok) {
          throw new Error(`HTTP error! status: ${retry.status}`);
        }
        const retryResult = await retry.json();
        const retryStats: UserQuestionStats = {};
        if (retryResult.data && Array.isArray(retryResult.data)) {
          retryResult.data.forEach((stat: any) => {
            if (!stat?.question_id) return;
            retryStats[stat.question_id] = {
              correctAttempts: stat.correct_attempts || 0,
              incorrectAttempts: stat.incorrect_attempts || 0,
              lastAttempted: stat.last_attempted || null,
              stem: stat.question_stem || stat.questionStem || stat.stem || null,
              groupName: stat.group_name || stat.groupName || null,
            };
          });
        }
        return retryStats;
      }
      console.debug('Auth not ready for user-stats, returning empty');
      return {} as UserQuestionStats;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const stats: UserQuestionStats = {};
    if (result.data && Array.isArray(result.data)) {
      result.data.forEach((stat: any) => {
        if (!stat?.question_id) return;
        stats[stat.question_id] = {
          correctAttempts: stat.correct_attempts || 0,
          incorrectAttempts: stat.incorrect_attempts || 0,
          lastAttempted: stat.last_attempted || null,
          stem: stat.question_stem || stat.questionStem || stat.stem || null,
          groupName: stat.group_name || stat.groupName || null,
        };
      });
    }
    return stats;
  } catch (error: any) {
    // Network errors (server not running) - return empty silently
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for user-stats, returning empty');
      return {} as UserQuestionStats;
    }
    console.error('Error fetching user question stats:', error);
    throw error;
  }
};

// --- Dashboard Aggregate ---

/**
 * One round trip replacing fetchTestResults + fetchUserQuestionStats during
 * bootstrap (GET /api/v1/dashboard/summary). Returns null on any failure so
 * callers can fall back to the individual requests.
 *
 * When the API marks question stats as failed (`userQuestionStats: null`),
 * this falls back to GET /user-stats/:id rather than treating it as empty.
 */
export const fetchDashboardSummary = async (): Promise<{
  testResults: any[];
  userQuestionStats: UserQuestionStats;
} | null> => {
  try {
    if (!(await hasValidSession())) {
      return null;
    }

    const response = await fetch(`${getApiRoot()}/api/v1/dashboard/summary`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    const data = result?.data;
    if (!data) return null;

    const testResults = (Array.isArray(data.testResults) ? data.testResults : []).map((item: any) => {
      if (!item?.session) return item;
      const normalized = normalizeTestResultSession(item.session);
      return {
        ...item,
        session: {
          ...item.session,
          questions: normalized.questions,
          userAnswers: normalized.userAnswers,
        },
      };
    });

    // null => server failed to load stats; do not coerce to {}.
    if (data.userQuestionStats === null) {
      return null;
    }

    const userQuestionStats: UserQuestionStats = {};
    if (Array.isArray(data.userQuestionStats)) {
      data.userQuestionStats.forEach((stat: any) => {
        const id = stat?.question_id || stat?.questionId;
        if (!id) return;
        const stem = stat.question_stem || stat.questionStem || stat.stem || null;
        const groupName = stat.group_name || stat.groupName || null;
        userQuestionStats[id] = {
          correctAttempts: stat.correct_attempts ?? stat.correctAttempts ?? stat.correct_count ?? 0,
          incorrectAttempts: stat.incorrect_attempts ?? stat.incorrectAttempts ?? stat.incorrect_count ?? 0,
          lastAttempted: stat.last_attempted ?? stat.lastAttempted ?? stat.last_reviewed_at ?? null,
          ...(typeof stem === 'string' && stem.trim() ? { stem: stem.trim() } : {}),
          ...(typeof groupName === 'string' && groupName.trim()
            ? { groupName: groupName.trim() }
            : {}),
        };
      });
    }

    return { testResults, userQuestionStats };
  } catch (error) {
    console.debug('Dashboard summary unavailable, falling back to individual calls:', error);
    return null;
  }
};

// --- Profile/User Functions ---

export const fetchUserProfile = async (userId: string) => {
  console.log('Fetching user profile for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const err = new Error(`HTTP error! status: ${response.status}`);
      if (response.status !== 404) {
        console.error('Error fetching user profile:', err);
      }
      throw err;
    }

    const result = await response.json();
    console.log('Fetched user profile:', result.data);
    return mapUserFromApi(result.data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('404') && !msg.includes('status: 404')) {
      console.error('Error fetching user profile:', error);
    }
    throw error;
  }
};

export const updateUserProfile = async (userId: string, updates: {
  name?: string;
  avatar_url?: string | null;
  phone?: string;
  points?: number;
  stats?: any;
  badges?: any[];
  settings?: any;
  test_presets?: any[];
}) => {
  console.log('Updating user profile for user:', userId, 'updates:', updates);
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('User profile updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
};

export const createUserProfile = async (profileData: {
  id: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  points?: number;
  stats?: any;
  badges?: any[];
  settings?: any;
  test_presets?: any[];
  username?: string;
  first_name?: string;
  last_name?: string;
}) => {
  console.log('Creating user profile:', profileData);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/users`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(profileData),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('User profile created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating user profile:', error);
    throw error;
  }
};

export const deleteUserAccount = async (userId: string): Promise<boolean> => {
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      console.error('Error deleting user account:', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting user account:', error);
    return false;
  }
};

export const deleteUserAccountImmediate = async (
  userId: string,
  password: string
): Promise<void> => {
  const headers = await getRequiredAuthHeaders();
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/delete-immediate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Delete failed (${response.status})`);
  }
};

export const deactivateUserAccount = async (userId: string): Promise<{
  deletionScheduledAt: string;
  deactivatedAt: string;
  gracePeriodDays: number;
  message?: string;
}> => {
  const headers = await getRequiredAuthHeaders();
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/deactivate`, {
    method: 'POST',
    headers,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      json.error ||
        json.message ||
        (typeof json.data?.message === 'string' ? json.data.message : null) ||
        `Pause failed (${response.status})`
    );
  }
  return json.data;
};

export const reactivateUserAccount = async (userId: string): Promise<void> => {
  const headers = await getRequiredAuthHeaders();
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/reactivate`, {
    method: 'POST',
    headers,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Reactivate failed (${response.status})`);
  }
};

export const fetchAccountLifecycle = async (userId: string): Promise<{
  status: 'active' | 'deactivated';
  deactivatedAt?: string | null;
  deletionScheduledAt?: string | null;
  graceDaysRemaining?: number | null;
  gracePeriodDays: number;
} | null> => {
  try {
    const doFetch = async () => {
      const headers = await getAuthHeaders();
      return fetch(`${getApiRoot()}/api/v1/users/${userId}/lifecycle`, { headers });
    };
    let response = await doFetch();
    if (response.status === 401 || response.status === 403) {
      const { handleApiAuthFailure } = await import('./sessionHandler');
      if (await handleApiAuthFailure(response.status)) {
        response = await doFetch();
      } else {
        return null;
      }
    }
    if (!response.ok) return null;
    const json = await response.json();
    return json.data ?? null;
  } catch {
    return null;
  }
};

export const importUserAccountBackup = async (
  userId: string,
  payload: {
    exportDoc: Record<string, unknown>;
    password: string;
    confirmEmailMismatch?: boolean;
  }
): Promise<{ noteFolders: number; notes: number; decks: number; flashcards: number }> => {
  const headers = await getRequiredAuthHeaders();
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/import`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      export: payload.exportDoc,
      password: payload.password,
      confirmEmailMismatch: !!payload.confirmEmailMismatch,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Import failed (${response.status})`);
  }
  return json.data;
};

export const exportUserAccountData = async (userId: string): Promise<Record<string, unknown> | null> => {
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/export`, { headers });
    if (!response.ok) {
      console.error('Error exporting user data:', response.status);
      return null;
    }
    const json = await response.json();
    return json?.data ?? json;
  } catch (error) {
    console.error('Error exporting user data:', error);
    return null;
  }
};

export const checkUsernameAvailability = async (username: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/users/check-username/${encodeURIComponent(username)}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Failed to check username availability: ${response.statusText}`);
    }
    const data = await response.json();
    return data.available === true;
  } catch (error) {
    console.error('Error checking username availability:', error);
    throw error;
  }
};

export const updateUsername = async (userId: string, username: string, firstName: string, lastName: string): Promise<any> => {
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/username`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ username, firstName, lastName }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to update username: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating username:', error);
    throw error;
  }
};

// --- Notification Functions ---

export const createNotification = async (notificationData: {
  user_id: string;
  message: string;
  link?: string;
}) => {
  console.log('Creating notification for user:', notificationData.user_id);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/notifications`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        userId: notificationData.user_id,
        message: notificationData.message,
        link: notificationData.link,
        type: 'info'
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Notification created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

export const fetchNotifications = async (userId: string) => {
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    const response = await fetch(`${getApiRoot()}/api/v1/notifications?limit=100`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      console.debug('Auth not ready for notifications, returning empty');
      return [];
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.data.map((notification: any) => ({
      id: notification.id,
      message: notification.message,
      date: notification.date,
      read: notification.read,
      link: notification.link,
      type: notification.type,
      data: notification.data ?? {},
    }));
  } catch (error: any) {
    // Network errors (server not running) - return empty silently
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for notifications, returning empty');
      return [];
    }
    console.error('Error fetching notifications:', error);
    throw error;
  }
};

export const markNotificationAsRead = async (notificationId: string, userId: string) => {
  console.log('Marking notification as read:', notificationId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Notification marked as read:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

export const markAllNotificationsAsRead = async (userId: string) => {
  console.log('Marking all notifications as read for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/notifications/read-all`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Marked notifications as read count:', result.data.updatedCount);
    return result.data.updatedCount;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

export const deleteNotification = async (notificationId: string, userId?: string) => {
  console.log('Deleting notification:', notificationId);
  try {
    const resolvedUserId = userId || await getAuthenticatedUserId();
    const userParam = '';
    const response = await fetch(`${getApiRoot()}/api/v1/notifications/${notificationId}${userParam}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log('Notification deleted');
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
};

export const deleteAllNotifications = async (userId: string) => {
  console.log('Deleting all notifications for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/notifications`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete all notifications');
    }

    const result = await response.json();
    console.log('All notifications deleted:', result.data);
    return result.data.deletedCount;
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    throw error;
  }
};

export const deleteGroup = async (groupId: string) => {
  console.log('Deleting group:', groupId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete group');
    }

    console.log('Group deleted successfully');
  } catch (error) {
    console.error('Error deleting group:', error);
    throw error;
  }
};

export const updateGroup = async (groupId: string, updates: { name?: string; description?: string; isArchived?: boolean; avatarUrl?: string }) => {
  console.log('Updating group:', groupId, 'updates:', updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        isArchived: updates.isArchived,
        avatarUrl: updates.avatarUrl
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update group');
    }

    const result = await response.json();
    console.log('Group updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating group:', error);
    throw error;
  }
};

export const promoteGroupAdmin = async (groupId: string, memberId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/admins/${memberId}`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || 'Failed to promote admin');
  }
  const result = await response.json();
  return result.data;
};

export const demoteGroupAdmin = async (groupId: string, memberId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/admins/${memberId}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || 'Failed to demote admin');
  }
  const result = await response.json();
  return result.data;
};

export const removeGroupMember = async (groupId: string, memberId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/groups/${groupId}/members/${memberId}`,
    {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to remove member');
  }
  const result = await response.json();
  return result.data;
};

export const leaveGroup = async (groupId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/leave`, {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Failed to leave group');
  }
  return true;
};

// --- Marketplace Functions ---

export const createMarketplaceListing = async (listingData: {
  category: string;
  title: string;
  description?: string;
  price?: number;
  sale_price?: number;
  sale_ends_at?: string;
  promo_label?: string;
  quantity?: number | null;
  location?: string;
  images?: string[];
  categorySpecificFields?: any;
}) => {
  console.log('Creating marketplace listing:', listingData.title);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(listingData),
    });

    // Try to parse response as JSON
    const contentType = response.headers.get('content-type');
    let result;
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const text = await response.text();
      console.error('Non-JSON response:', text);
      throw new Error('Server returned non-JSON response');
    }

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to create listing');
    }

    console.log('Listing created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating listing:', error);
    throw error;
  }
};

export const fetchMarketplaceListings = async (filters: {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
} = {}) => {
  const result = await fetchMarketplaceListingsPage(filters);
  return result.data;
};

export const fetchMarketplaceCampuses = async (country = 'NG'): Promise<any[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/campuses?country=${encodeURIComponent(country)}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) {
    throw new Error('Failed to fetch campuses');
  }
  const result = await response.json();
  return result.data || [];
};

export const fetchMarketplaceListingsPage = async (filters: {
  page?: number;
  limit?: number;
  category?: string;
  /** Server-side tab filter: only these categories (comma-serialized). */
  categories?: string[];
  /** Include seller-defined `custom:` categories alongside `categories`. */
  includeCustom?: boolean;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  campus_id?: string;
  country_code?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** `compact` returns card-shaped rows (first image only) for the browse grid. */
  responseProfile?: 'compact' | 'full';
} = {}): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number } }> => {
  const cacheKey = listingsCacheKey(filters as Record<string, unknown>);

  type ListingsPage = { data: any[]; pagination: { page: number; limit: number; total: number } };

  try {
    return await marketplaceListingsCache.get(cacheKey, async (): Promise<ListingsPage> => {
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString());
        }
      });

      const response = await fetchWithTimeout(
        `${getApiRoot()}/api/v1/marketplace/listings?${queryParams}`,
        { method: 'GET', headers: await getAuthHeaders() },
        5000
      );

      if (response.status === 429) {
        const error = await response.json().catch(() => ({ message: 'Rate limit exceeded' }));
        throw new RateLimitError(
          error.message || 'Public read rate limit exceeded. Please try again later.',
          parseRetryAfterMs(response)
        );
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch listings');
      }

      const result = await response.json();
      return {
        data: (result.data || []).map(normalizeListingRecord),
        pagination: result.pagination || {
          page: Number(filters.page || 1),
          limit: Number(filters.limit || 20),
          total: (result.data || []).length,
        },
      };
    });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    // Previously this swallowed non-429 failures and returned an empty page,
    // which rendered as a genuine "no listings" empty state and hid real
    // network/server errors. Propagate so the browse grid can show a distinct
    // "Couldn't load — Retry" state instead of a false empty.
    console.error('Error fetching listings:', error);
    throw error;
  }
};

/** Batch fetch of active listings by id — one request for the recently-viewed rail. */
export const fetchMarketplaceListingsByIds = async (ids: string[]): Promise<any[]> => {
  if (ids.length === 0) return [];
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/batch?ids=${ids.map(encodeURIComponent).join(',')}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) {
    throw new Error('Failed to fetch listings batch');
  }
  const result = await response.json();
  return (result.data || []).map(normalizeListingRecord);
};

export const fetchMarketplaceListing = async (listingId: string) => {
  console.log('Fetching marketplace listing:', listingId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      // 404 is expected for deleted/missing listings, especially in "recently viewed".
      if (response.status === 404) {
        return null;
      }

      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch listing');
    }

    const result = await response.json();
    console.log('Fetched listing:', result.data);
    return normalizeListingRecord(result.data);
  } catch (error) {
    console.error('Error fetching listing:', error);
    throw error;
  }
};

export const updateMarketplaceListing = async (listingId: string, updates: any) => {
  console.log('Updating marketplace listing:', listingId, updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update listing');
    }

    const result = await response.json();
    console.log('Listing updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating listing:', error);
    throw error;
  }
};

export const deleteMarketplaceListing = async (listingId: string) => {
  console.log('Deleting marketplace listing:', listingId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete listing');
    }

    console.log('Listing deleted');
  } catch (error) {
    console.error('Error deleting listing:', error);
    throw error;
  }
};

export const addMarketplaceReview = async (listingId: string, review: { rating: number; comment?: string }) => {
  console.log('Adding review to listing:', listingId, review);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/reviews`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(review),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add review');
    }

    const result = await response.json();
    console.log('Review added:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error adding review:', error);
    throw error;
  }
};

export const reportMarketplaceListing = async (listingId: string, report: { reason: string; details?: string }) => {
  console.log('Reporting listing:', listingId, report);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/reports`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(report),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to report listing');
    }

    const result = await response.json();
    console.log('Report submitted:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error reporting listing:', error);
    throw error;
  }
};

export const initiateMarketplaceTransaction = async (listingId: string, amount: number) => {
  console.log('Initiating transaction for listing:', listingId, amount);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/transactions`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, amount }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to initiate transaction');
    }

    const result = await response.json();
    console.log('Transaction initiated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error initiating transaction:', error);
    throw error;
  }
};

// ============ SELLER DASHBOARD FUNCTIONS ============

export const fetchMyListings = async (status?: string) => {
  console.log('Fetching my listings', { status });
  try {
    const queryParams = new URLSearchParams();
    if (status) queryParams.append('status', status);
    
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/my-listings?${queryParams}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch listings');
    }

    const result = await response.json();
    console.log('Fetched my listings:', result.data.length);
    return (result.data || []).map(normalizeListingRecord);
  } catch (error) {
    console.error('Error fetching my listings:', error);
    return []; // Return empty array on error
  }
};

export const fetchSellerStats = async () => {
  console.log('Fetching seller stats');
  try {
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/stats`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch stats');
    }

    const result = await response.json();
    console.log('Fetched seller stats:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching seller stats:', error);
    return null; // Return null on error
  }
};

export const updateListingStatus = async (listingId: string, status: 'active' | 'inactive' | 'sold') => {
  console.log('Updating listing status:', listingId, status);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update status');
    }

    const result = await response.json();
    console.log('Status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating listing status:', error);
    throw error;
  }
};

// ============ FAVORITES FUNCTIONS ============

export const fetchMyFavorites = async () => {
  try {
    if (!(await hasValidSession())) return [];
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/favorites`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch favorites');
    }

    const result = await response.json();
    return (result.data || []).map(normalizeFavoriteRecord);
  } catch (error) {
    // Propagate so the Favorites screen can distinguish a real load failure
    // (show "Couldn't load — Retry") from a genuinely empty favorites list.
    // MarketplaceScreen's heart-state prefetch still guards this in its own
    // try/catch, so a failure there degrades gracefully without hearts.
    console.error('Error fetching favorites:', error);
    throw error;
  }
};

export const addToFavorites = async (listingId: string) => {
  console.log('Adding to favorites:', listingId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/favorites`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add to favorites');
    }

    const result = await response.json();
    console.log('Added to favorites:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error adding to favorites:', error);
    throw error;
  }
};

export const removeFromFavorites = async (listingId: string) => {
  console.log('Removing from favorites:', listingId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/favorites/${listingId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove from favorites');
    }

    console.log('Removed from favorites');
  } catch (error) {
    console.error('Error removing from favorites:', error);
    throw error;
  }
};

export const checkIfFavorited = async (listingId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/favorites/${listingId}/check`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) return false;

    const result = await response.json();
    return result.data.isFavorited;
  } catch (error) {
    console.error('Error checking favorite:', error);
    return false;
  }
};

// ============ INQUIRY FUNCTIONS ============

export const fetchMyInquiries = async (role: 'seller' | 'buyer' = 'seller', status?: string) => {
  console.log('Fetching my inquiries', { role, status });
  try {
    const queryParams = new URLSearchParams({ role });
    if (status) queryParams.append('status', status);
    
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/inquiries?${queryParams}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch inquiries');
    }

    const result = await response.json();
    console.log('Fetched inquiries:', result.data.length);
    return (result.data || []).map(normalizeInquiryRecord);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    throw error;
  }
};

export const createInquiry = async (listingId: string, message: string) => {
  console.log('Creating inquiry for listing:', listingId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/inquiries`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, message }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create inquiry');
    }

    const result = await response.json();
    console.log('Inquiry created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating inquiry:', error);
    throw error;
  }
};

export const updateInquiryStatus = async (inquiryId: string, status: 'open' | 'negotiating' | 'closed' | 'purchased') => {
  console.log('Updating inquiry status:', inquiryId, status);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/inquiries/${inquiryId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update inquiry status');
    }

    const result = await response.json();
    console.log('Inquiry status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating inquiry status:', error);
    throw error;
  }
};

const MARKETPLACE_INQUIRY_MESSAGE_MARKERS = ['📦 Inquiry about', '[Offer]'] as const;

/** Heuristic: skip optional inquiry lookup for plain DMs without marketplace context. */
export const threadMayHaveMarketplaceInquiry = (
  texts: Array<string | undefined | null>
): boolean =>
  texts.some(
    (text) =>
      typeof text === 'string' &&
      MARKETPLACE_INQUIRY_MESSAGE_MARKERS.some((marker) => text.includes(marker))
  );

export const getInquiryByThread = async (threadId: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/inquiries/thread/${threadId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.data ? normalizeInquiryRecord(result.data) : null;
  } catch (error) {
    console.error('Error fetching inquiry by thread:', error);
    return null;
  }
};

// --- Marketplace Offers ---

export const createOffer = async (listingId: string, amount: number, message?: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/offers`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, amount, message }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to create offer');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating offer:', error);
    throw error;
  }
};

export const respondToOffer = async (offerId: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/offers/${offerId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ action, counterAmount }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to respond to offer');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error responding to offer:', error);
    throw error;
  }
};

export const fetchOffers = async (role: 'buyer' | 'seller') => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/offers?role=${role}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return (result.data || []).map(normalizeOfferRecord);
  } catch (error) {
    console.error('Error fetching offers:', error);
    return [];
  }
};

export const fetchOffersForListing = async (listingId: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/offers`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching offers for listing:', error);
    return [];
  }
};

export const fetchNegotiationHistory = async (listingId: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/offers-history`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching negotiation history:', error);
    return [];
  }
};

export const fetchMarketplaceOrders = async (role: 'buyer' | 'seller' = 'buyer') => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/orders?role=${role}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch orders');
  }
  const result = await response.json();
  return result.data || [];
};

export const fetchMarketplaceOrder = async (orderId: string) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/orders/${orderId}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch order');
  }
  const result = await response.json();
  return result.data;
};

export const fetchOrderForInquiry = async (inquiryId: string) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/orders/inquiry/${inquiryId}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
};

export const updateMarketplaceOrder = async (
  orderId: string,
  payload: { action: string; meetingLocation?: string; sellerNote?: string; fulfillmentMode?: string }
) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/orders/${orderId}`, {
    method: 'PATCH',
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update order');
  }
  const result = await response.json();
  return result.data;
};

export const requestOrderPayment = async (orderId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/orders/${orderId}/payment-link`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to request payment');
  }
  const result = await response.json();
  return result.data;
};

export const fetchSellerAnalytics = async () => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/analytics/seller`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
};

export const fetchSellerBuyers = async (segment?: string) => {
  const qs = segment ? `?segment=${encodeURIComponent(segment)}` : '';
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/seller/buyers${qs}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return [];
  const result = await response.json();
  return result.data || [];
};

export const fetchSellerCoupons = async () => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/coupons`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return [];
  const result = await response.json();
  return result.data || [];
};

export const createSellerCoupon = async (data: {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  maxUses?: number;
  endsAt?: string;
}) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/coupons`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create coupon');
  }
  const result = await response.json();
  return result.data;
};

export const validateMarketplaceCoupon = async (code: string, listingId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/coupons/validate`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ code, listingId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Invalid coupon');
  }
  const result = await response.json();
  return result.data;
};

export const fetchSellerPreferences = async () => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/seller/preferences`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
};

export const updateSellerPreferences = async (data: {
  hallDropoffEnabled?: boolean;
  hallDropoffMinAmount?: number | null;
  requirePaymentConfirmation?: boolean;
  favoriteAlertThreshold?: number;
}) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/preferences`, {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update preferences');
  }
  const result = await response.json();
  return result.data;
};

export const fetchPickupNudge = async (sellerId: string) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/sellers/${sellerId}/pickup-nudge`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
};

export const sendSellerCampaign = async (data: {
  message: string;
  segment?: string;
  buyerIds?: string[];
}) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/campaigns`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Campaign failed');
  }
  const result = await response.json();
  return result.data;
};

export const createMarketplaceBundle = async (data: {
  title: string;
  description?: string;
  price: number;
  listingIds: string[];
  location?: string;
  campus_id: string;
  country_code?: string;
}) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/bundles`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create bundle');
  }
  const result = await response.json();
  return result.data;
};

export const fetchSellerOnboarding = async () => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/seller/onboarding`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
};

export const completeSellerOnboarding = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/onboarding/complete`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to complete onboarding');
  }
  const result = await response.json();
  return result.data;
};

export const submitOrderPaymentProof = async (orderId: string, proofUrl: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/marketplace/orders/${orderId}/payment-proof`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ proofUrl }),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to submit payment proof');
  }
  const result = await response.json();
  return result.data;
};

export const checkSavedSearchMatches = async (searchId: string, peek = false) => {
  // `peek=1` returns the same match count WITHOUT bumping last_checked_at
  // server-side. The badge poll must peek — otherwise every Explore mount
  // consumes the alerts job's "since" cursor and silently kills notifications.
  const query = peek ? '?peek=1' : '';
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/saved-searches/${searchId}/matches${query}`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000
  );
  if (!response.ok) return { count: 0, listings: [] };
  const result = await response.json();
  return result.data || { count: 0, listings: [] };
};

export const boostMarketplaceListing = async (listingId: string, durationHours: number = 72) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/boost`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ durationHours }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to boost listing');
  }

  const result = await response.json();
  return result.data;
};

export const buyMarketplaceListingNow = async (
  listingId: string,
  couponCode?: string,
  quantity?: number
) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/buy-now`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      ...(couponCode ? { couponCode } : {}),
      ...(quantity != null && quantity > 0 ? { quantity } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to complete purchase');
  }

  const result = await response.json();
  return result.data as {
    order?: { id: string; seller_id?: string; amount?: number };
    authorizationUrl?: string;
    accessCode?: string;
    publicKey?: string;
    payment?: {
      reference: string;
      itemAmountKobo: number;
      serviceFeeKobo: number;
      totalChargeKobo: number;
    };
  };
};

export const fetchMarketplacePaymentsConfig = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/payments/config`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load payment config');
  }
  const result = await response.json();
  return result.data as {
    paystackEnabled: boolean;
    publicKey: string | null;
    serviceFeeBps: number;
  };
};

export const verifyMarketplacePayment = async (reference: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/marketplace/payments/${encodeURIComponent(reference)}/verify`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to verify payment');
  }
  const result = await response.json();
  return result.data;
};

export const resumeMarketplaceOrderCheckout = async (orderId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/marketplace/orders/${encodeURIComponent(orderId)}/checkout`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start checkout');
  }
  const result = await response.json();
  return result.data as {
    authorizationUrl?: string;
    payment?: {
      itemAmountKobo: number;
      serviceFeeKobo: number;
      totalChargeKobo: number;
      reference?: string;
    };
  };
};

export const fetchSellerPayoutProfile = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/payout-profile`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load payout profile');
  }
  const result = await response.json();
  return result.data;
};

export const upsertSellerPayoutProfile = async (data: {
  accountNumber: string;
  bankCode: string;
}) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/payout-profile`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save payout profile');
  }
  const result = await response.json();
  return result.data;
};

export const fetchPaystackBanks = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/seller/banks`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load banks');
  }
  const result = await response.json();
  return result.data as Array<{ name: string; code: string }>;
};

export const fetchMarketplaceCart = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load cart');
  }
  const result = await response.json();
  return result.data;
};

export const addToMarketplaceCart = async (listingId: string, quantity?: number) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      listingId,
      ...(quantity != null && quantity > 0 ? { quantity } : {}),
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add to cart');
  }
  const result = await response.json();
  return result.data;
};

export const updateMarketplaceCartItem = async (listingId: string, quantity: number) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart/${listingId}`, {
    method: 'PATCH',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ quantity }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update cart');
  }
  const result = await response.json();
  return result.data;
};

export const removeMarketplaceCartItem = async (listingId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart/${listingId}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to remove cart item');
  }
  const result = await response.json();
  return result.data;
};

export const clearMarketplaceCart = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to clear cart');
  }
  const result = await response.json();
  return result.data;
};

export const checkoutMarketplaceCart = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart/checkout`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Checkout failed');
  }
  const result = await response.json();
  return result.data;
};

export const fetchMarketplaceCategoryAnalytics = async () => {
  try {
    return await marketplaceCategoryAnalyticsCache.get('categories', async () => {
      const response = await fetchWithTimeout(
        `${getApiRoot()}/api/v1/marketplace/analytics/categories`,
        { method: 'GET', headers: await getAuthHeaders() },
        5000
      );

      if (response.status === 429) {
        const error = await response.json().catch(() => ({ message: 'Rate limit exceeded' }));
        throw new RateLimitError(
          error.message || 'Public read rate limit exceeded. Please try again later.',
          parseRetryAfterMs(response)
        );
      }

      if (!response.ok) return [];
      const result = await response.json();
      return result.data || [];
    });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    console.error('Error fetching category analytics:', error);
    return [];
  }
};

// --- Saved Searches ---

export const saveSearch = async (filters: Record<string, any>, name?: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/saved-searches`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ filters, name }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to save search');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error saving search:', error);
    throw error;
  }
};

export const fetchSavedSearches = async () => {
  try {
    if (!(await hasValidSession())) return [];
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/saved-searches`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching saved searches:', error);
    return [];
  }
};

export const deleteSavedSearch = async (id: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/saved-searches/${id}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete saved search');
  } catch (error) {
    console.error('Error deleting saved search:', error);
    throw error;
  }
};

// --- Custom Categories ---

export const fetchCustomCategories = async () => {
  try {
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/categories/custom`, {
      method: 'GET',
    }, 5000);
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching custom categories:', error);
    return [];
  }
};

export const createCustomCategory = async (name: string) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/categories/custom`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create category');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating custom category:', error);
    throw error;
  }
};

// --- Similar Listings ---

export const fetchSimilarListings = async (listingId: string) => {
  try {
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/similar`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching similar listings:', error);
    return [];
  }
};

// --- Batched listing detail (listing + isFavorited + similar in one request) ---

export interface MarketplaceQuestionBankMeta {
  questionCount: number;
  version: number;
  owned: boolean;
}

/** Publish an offline bundle as a digital question-bank listing. */
export const publishQuestionBank = async (input: {
  title: string;
  description?: string;
  price?: number | null;
  campusId: string;
  location?: string;
  groupId?: string | null;
  content: { config?: Record<string, unknown>; questions: unknown[] };
}): Promise<{ listing: any; bank: { listing_id: string; question_count: number } }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/publish`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(input),
    },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to publish question bank');
  }
  return (await response.json()).data;
};

/** Free banks and owner re-downloads: grants the entitlement and delivers the offline bundle. */
export const downloadQuestionBank = async (
  listingId: string
): Promise<{ bundleId: string; questionCount: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/question-bank/download`,
    { method: 'POST', headers: await getAuthHeaders() },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to download question bank');
  }
  return (await response.json()).data;
};

export interface QuestionBankPreview {
  questionCount: number;
  version: number;
  owned?: boolean;
  isSeller?: boolean;
  previewCount: number;
  questions: Array<{
    id?: string;
    questionStem?: string;
    text?: string;
    questionType?: string;
    options?: Array<{ id: string; text: string }>;
    imageUrl?: string;
    tags?: string[];
  }>;
}

/** Public sample of a question bank — answers are stripped server-side. */
export const fetchQuestionBankPreview = async (
  listingId: string
): Promise<QuestionBankPreview> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/question-bank/preview`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load preview');
  }
  return (await response.json()).data;
};

export interface QuestionBankLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  scorePct: number;
  correct: number;
  total: number;
  attempts: number;
  isViewer: boolean;
}

/** Record an attempt on an owned bank; the server keeps the best score. */
export const recordQuestionBankScore = async (
  listingId: string,
  correct: number,
  total: number
): Promise<{ bestScorePct: number; improved: boolean; attempts: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/question-bank/scores`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ correct, total }),
    },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to record score');
  }
  return (await response.json()).data;
};

/** Top scores for a bank, plus the caller's standing. */
export const fetchQuestionBankLeaderboard = async (
  listingId: string,
  limit?: number
): Promise<{
  entries: QuestionBankLeaderboardEntry[];
  viewerEntry: QuestionBankLeaderboardEntry | null;
}> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/question-bank/leaderboard${limit ? `?limit=${limit}` : ''}`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load leaderboard');
  }
  return (await response.json()).data;
};

/** Seller republish: replace the published snapshot, bumping the version. */
export const updateQuestionBankContent = async (
  listingId: string,
  content: { config?: Record<string, unknown>; questions: unknown[] }
): Promise<{ version: number; questionCount: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/${encodeURIComponent(listingId)}/update-content`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ content }),
    },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to update question bank');
  }
  return (await response.json()).data;
};

export interface MyQuestionBank {
  listingId: string;
  sourceGroupId: string | null;
  version: number;
  questionCount: number;
  title: string;
  price: number | null;
  status: string;
}

/** Question banks the current user has published. */
export const fetchMyQuestionBanks = async (): Promise<MyQuestionBank[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/mine`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load your question banks');
  }
  return (await response.json()).data;
};

export interface QuestionBankUpdate {
  listingId: string;
  bundleId: string;
  version: number;
  questionCount: number;
}

/** Owned banks whose published version is newer than the local copy. */
export const fetchQuestionBankUpdates = async (): Promise<QuestionBankUpdate[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/updates`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to check for updates');
  }
  return (await response.json()).data;
};

/** Re-materialize purchased banks into offline bundles (new device / reinstall). */
export const restoreQuestionBanks = async (): Promise<{ restored: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/restore`,
    { method: 'POST', headers: await getAuthHeaders() },
    20000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to restore question banks');
  }
  return (await response.json()).data;
};

export const fetchMarketplaceListingFull = async (
  listingId: string,
  userId?: string
): Promise<{
  listing: any;
  isFavorited: boolean;
  similarListings: any[];
  canReview?: boolean;
  questionBank?: MarketplaceQuestionBankMeta | null;
}> => {
  const params = userId ? `` : '';
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${listingId}/full${params}`,
    { method: 'GET', headers: await getAuthHeaders() },
    8000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load listing');
  }
  const result = await response.json();
  return result.data;
};

// --- Seller Profile ---

export const fetchSellerProfile = async (userId: string) => {
  try {
    const response = await fetchWithTimeout(`${getApiRoot()}/api/v1/marketplace/sellers/${userId}/profile`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to load seller profile');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching seller profile:', error);
    throw error;
  }
};

export const updateMyShop = async (data: {
  shopName?: string;
  bio?: string | null;
  coverImageUrl?: string | null;
}) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/sellers/me/shop`,
    {
      method: 'PATCH',
      headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    10000,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update shop');
  }
  const result = await response.json();
  return result.data;
};

export const fetchMarketplaceShops = async (params?: {
  campus?: string;
  q?: string;
  page?: number;
  limit?: number;
}) => {
  const search = new URLSearchParams();
  if (params?.campus) search.set('campus', params.campus);
  if (params?.q) search.set('q', params.q);
  if (params?.page) search.set('page', String(params.page));
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/shops${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers: await getAuthHeaders() },
    8000,
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load shops');
  }
  const result = await response.json();
  return {
    shops: (result.data || []) as import('../types').MarketplaceShopCard[],
    meta: result.meta as { total: number; page: number; limit: number } | undefined,
  };
};

// --- Recently Viewed (localStorage) ---

const RECENTLY_VIEWED_KEY = 'lantern_recently_viewed';
const MAX_RECENTLY_VIEWED = 20;

export const addRecentlyViewed = (listingId: string) => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    let ids: string[] = stored ? JSON.parse(stored) : [];
    ids = ids.filter(id => id !== listingId);
    ids.unshift(listingId);
    ids = ids.slice(0, MAX_RECENTLY_VIEWED);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error('Error saving recently viewed:', error);
  }
};

export const getRecentlyViewed = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const clearRecentlyViewed = () => {
  localStorage.removeItem(RECENTLY_VIEWED_KEY);
};

export const removeRecentlyViewed = (listingIds: string[]) => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!stored) return;
    const ids: string[] = JSON.parse(stored);
    const filtered = ids.filter((id) => !listingIds.includes(id));
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing recently viewed listings:', error);
  }
};

async function fileToBase64Payload(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number },
): Promise<{
  fileName: string;
  base64Data: string;
  contentType: string;
}> {
  let prepared = file;
  if (file.type.startsWith('image/')) {
    try {
      const { compressImage } = await import('../utils/imageCompression');
      const compressed = await compressImage(file, {
        maxWidth: options?.maxWidth ?? 1600,
        maxHeight: options?.maxHeight ?? 1600,
        quality: options?.quality ?? 0.8,
        outputType: 'file',
      });
      if (compressed instanceof File) prepared = compressed;
    } catch {
      // Fall back to the original file if canvas compression fails.
    }
  }
  // Take the content type from the bytes rather than the File's declared type.
  // The server validates magic bytes, so a declared type that disagrees with
  // what is actually sent is rejected — and they disagree more often than you
  // would expect: some files arrive with an empty `type`, a HEIC photo keeps
  // its original type after being re-encoded, and the compressor above may
  // output a different format than it was given. The mismatch surfaced as a
  // bare "Failed to upload image" with no hint that the type was the problem.
  const { base64Data, detectedType } = await new Promise<{
    base64Data: string;
    detectedType: string;
  }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      const semi = result.indexOf(';');
      const detected =
        result.startsWith('data:') && semi > 5 ? result.slice(5, semi) : '';
      resolve({
        base64Data: comma >= 0 ? result.slice(comma + 1) : result,
        detectedType: detected,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(prepared);
  });

  const declared = detectedType || prepared.type || file.type || 'image/jpeg';
  const contentType = declared === 'image/jpg' ? 'image/jpeg' : declared;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!ALLOWED.includes(contentType)) {
    throw new Error(
      `${contentType || 'That file type'} is not supported. Use a JPEG, PNG, GIF or WebP image.`
    );
  }

  return {
    fileName: prepared.name || file.name || `upload-${Date.now()}.jpg`,
    base64Data,
    contentType,
  };
}

/** Upload a flashcard image via API (SEC-07 magic-byte validation). */
export const uploadFlashcardImage = async (file: File) => {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error('Must be signed in to upload images');
  const payload = await fileToBase64Payload(file);
  const response = await fetch(`${getApiRoot()}/api/v1/flashcards/upload-image`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to upload flashcard image');
  }
  return json.data as { url: string; path: string };
};

/** Upload a question attachment via API (SEC-07 magic-byte validation). */
export const uploadQuestionImage = async (file: File) => {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error('Must be signed in to upload images');
  const payload = await fileToBase64Payload(file);
  const response = await fetch(`${getApiRoot()}/api/v1/messages/upload-question-image`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to upload question image');
  }
  return json.data as { url: string; path: string };
};

/** Upload a marketplace listing image via API (SEC-07 magic-byte validation). */
export const uploadMarketplaceImage = async (file: File, listingId?: string) => {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) throw new Error('Must be signed in to upload images');
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (
    type.includes('heic') ||
    type.includes('heif') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  ) {
    throw new Error(
      'HEIC photos are not supported. Please convert or export the image as JPEG or PNG, then try again.'
    );
  }
  const payload = await fileToBase64Payload(file);
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/upload-image`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, listingId }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to upload marketplace image');
  }
  return json.data as { url: string; path: string; storageUrl?: string };
};

export const deleteMarketplaceImage = async (filePath: string) => {
  console.log('Deleting marketplace image:', filePath);
  try {
    const { error } = await supabase.storage
      .from('marketplace-images')
      .remove([filePath]);

    if (error) {
      throw new Error(error.message);
    }

    console.log('Image deleted successfully');
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};

// --- Direct Message Functions ---

export const fetchDirectMessages = async (userId: string, otherUserId: string, options: { page?: number; limit?: number } = {}) => {
  console.log('Fetching direct messages between:', userId, 'and:', otherUserId);
  const run = async () => {
    const { page = 1, limit = 50 } = options;
    const queryParams = new URLSearchParams({
      otherUserId,
      page: page.toString(),
      limit: limit.toString(),
    });

    const response = await fetch(`${getApiRoot()}/api/v1/messages/user/${userId}?${queryParams}`, {
      method: 'GET',
      headers: await getRequiredAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || 'Failed to fetch direct messages');
    }

    const result = await response.json();
    const data = Array.isArray(result.data) ? result.data : [];
    console.log('Fetched direct messages count:', data.length);
    return data;
  };

  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // One retry for auth bootstrap / transient network failures.
    if (/Authentication required|Failed to fetch|NetworkError|timeout|503|502|504/i.test(message)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        return await run();
      } catch (retryError) {
        console.error('Error fetching direct messages:', retryError);
        throw retryError;
      }
    }
    console.error('Error fetching direct messages:', error);
    throw error;
  }
};

export const fetchDmThreads = async (_userId: string) => {
  // Never return [] for auth/bootstrap failure — callers treat [] as "no threads"
  // and would wipe a previously loaded (or optimistic) inbox.
  const isAuthenticated = await hasValidSession();
  if (!isAuthenticated) {
    throw new Error('AUTH_NOT_READY');
  }

  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error('AUTH_NOT_READY');
  }

  try {
    const response = await fetchWithTimeout(
      `${getApiRoot()}/api/v1/messages/dm/threads`,
      {
        method: 'GET',
        headers: authHeaders,
      },
      12000,
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_UNAUTHORIZED');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || 'Failed to fetch DM threads');
    }

    const result = await response.json();
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.error('Error fetching DM threads:', error);
    throw error;
  }
};

export const sendDirectMessage = async (
  senderId: string,
  recipientId: string,
  content: string,
  clientMessageId?: string,
  options?: { replyToMessageId?: string }
) => {
  console.log('Sending direct message from:', senderId, 'to:', recipientId);
  const body = JSON.stringify({
    content,
    recipientId,
    clientMessageId,
    replyToMessageId: options?.replyToMessageId,
  });
  const request = async () => {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/user/${senderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body,
    });

    if (!response.ok) {
      throw await createDeliveryResponseError(response, 'Failed to send direct message');
    }

    const result = await response.json();
    console.log('Direct message sent:', result.data);
    return result.data;
  };

  try {
    return await retryUncertainDelivery(request);
  } catch (error) {
    console.error('Error sending direct message:', error);
    throw error;
  }
};

export const getDmBlockStatus = async (userId: string, otherUserId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/users/${userId}/blocks/status/${encodeURIComponent(otherUserId)}`,
    { method: 'GET', headers: await getAuthHeaders() }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to check block status');
  }
  const result = await response.json();
  return result.data as { blocked: boolean; iBlockedThem: boolean };
};

export const blockUser = async (userId: string, blockedUserId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify({ blockedUserId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to block user');
  }
  return (await response.json()).data;
};

export const unblockUser = async (userId: string, blockedUserId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/users/${userId}/blocks/${encodeURIComponent(blockedUserId)}`,
    { method: 'DELETE', headers: await getAuthHeaders() }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to unblock user');
  }
  return (await response.json()).data;
};

export const acceptDmMessageRequest = async (threadId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/accept`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to accept message request');
  }
  const result = await response.json();
  return result.data;
};

export const declineDmMessageRequest = async (threadId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/decline`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to decline message request');
  }
  const result = await response.json();
  return result.data;
};

// Fetch unread counts for all groups
export const fetchGroupUnreadCounts = async (userId: string): Promise<Record<string, number>> => {
  try {
    if (!(await hasValidSession())) {
      return {};
    }

    const response = await fetch(`${getApiRoot()}/api/v1/groups/unread/all`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      return {};
    }

    if (!response.ok) {
      console.error('Failed to fetch group unread counts');
      return {};
    }

    const result = await response.json();
    return result.data || {};
  } catch (error) {
    console.error('Error fetching group unread counts:', error);
    return {};
  }
};

// Mark a group as read
export const markGroupAsRead = async (
  groupId: string,
  userId: string
): Promise<{ success: boolean; previousLastReadAt: string | null }> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    const body = await response.json().catch(() => ({})) as {
      success?: boolean;
      previousLastReadAt?: string | null;
      data?: { previousLastReadAt?: string | null };
    };

    if (!response.ok) {
      console.error('Failed to mark group as read');
      return { success: false, previousLastReadAt: null };
    }

    return {
      success: body.success !== false,
      previousLastReadAt: body.previousLastReadAt ?? body.data?.previousLastReadAt ?? null,
    };
  } catch (error) {
    console.error('Error marking group as read:', error);
    return { success: false, previousLastReadAt: null };
  }
};

// Fetch unread counts for all DM threads
export const fetchDMUnreadCounts = async (userId: string): Promise<Record<string, number>> => {
  try {
    if (!(await hasValidSession())) {
      return {};
    }

    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/unread/all`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      return {};
    }

    if (!response.ok) {
      console.error('Failed to fetch DM unread counts');
      return {};
    }

    const result = await response.json();
    return result.data || {};
  } catch (error) {
    console.error('Error fetching DM unread counts:', error);
    return {};
  }
};

// Mark a DM thread as read
export const markDMAsRead = async (
  threadId: string,
  userId: string
): Promise<{ success: boolean; previousLastReadAt: string | null }> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/${threadId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      previousLastReadAt?: string | null;
      data?: { previousLastReadAt?: string | null };
    };

    if (!response.ok) {
      console.error('Failed to mark DM as read');
      return { success: false, previousLastReadAt: null };
    }

    return {
      success: body.success !== false,
      previousLastReadAt: body.previousLastReadAt ?? body.data?.previousLastReadAt ?? null,
    };
  } catch (error) {
    console.error('Error marking DM as read:', error);
    return { success: false, previousLastReadAt: null };
  }
};

export const uploadChatAudio = async (payload: {
  fileName: string;
  base64Data: string;
  contentType: string;
  groupId?: string;
  threadId?: string;
}): Promise<{ url: string; path: string }> => {
  const response = await fetch(`${getApiRoot()}/api/v1/messages/upload-audio`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.message || 'Failed to upload audio');
  }
  return result.data;
};

// Delete a DM thread (pair ids are two UUIDs joined by "-", so encode the path segment)
export const deleteDmThread = async (threadId: string, _userId: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}`,
      withApiCredentials({
        method: 'DELETE',
        headers: await getAuthHeaders(),
      })
    );

    if (!response.ok) {
      console.error('Failed to delete DM thread', response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting DM thread:', error);
    return false;
  }
};

// Archive a DM thread
export const archiveDmThread = async (threadId: string, _userId: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/archive`,
      withApiCredentials({
        method: 'PUT',
        headers: await getAuthHeaders(),
      })
    );
    if (!response.ok) {
      console.error('Failed to archive DM thread', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error archiving DM thread:', error);
    return false;
  }
};

// Unarchive a DM thread
export const unarchiveDmThread = async (threadId: string, _userId: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/unarchive`,
      withApiCredentials({
        method: 'PUT',
        headers: await getAuthHeaders(),
      })
    );
    if (!response.ok) {
      console.error('Failed to unarchive DM thread', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error unarchiving DM thread:', error);
    return false;
  }
};

export type ChatMuteStatus = { muted: boolean; mutedUntil: string | null };

async function parseMuteResponse(response: Response): Promise<ChatMuteStatus | null> {
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  const data = json?.data;
  if (!data || typeof data.muted !== 'boolean') return null;
  return {
    muted: data.muted,
    mutedUntil: typeof data.mutedUntil === 'string' ? data.mutedUntil : null,
  };
}

export const getDmMuteStatus = async (threadId: string): Promise<ChatMuteStatus | null> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/mute`,
      withApiCredentials({ method: 'GET', headers: await getAuthHeaders() })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error fetching DM mute status:', error);
    return null;
  }
};

export const muteDmThread = async (
  threadId: string,
  duration: '1h' | '8h' | '24h' | '7d'
): Promise<ChatMuteStatus | null> => {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/mute`,
      withApiCredentials({
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error muting DM thread:', error);
    return null;
  }
};

export const unmuteDmThread = async (threadId: string): Promise<ChatMuteStatus | null> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/mute`,
      withApiCredentials({ method: 'DELETE', headers: await getAuthHeaders() })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error unmuting DM thread:', error);
    return null;
  }
};

export const getGroupMuteStatus = async (groupId: string): Promise<ChatMuteStatus | null> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/groups/${encodeURIComponent(groupId)}/mute`,
      withApiCredentials({ method: 'GET', headers: await getAuthHeaders() })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error fetching group mute status:', error);
    return null;
  }
};

export const muteGroupChat = async (
  groupId: string,
  duration: '1h' | '8h' | '24h' | '7d'
): Promise<ChatMuteStatus | null> => {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${getApiRoot()}/api/v1/groups/${encodeURIComponent(groupId)}/mute`,
      withApiCredentials({
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error muting group chat:', error);
    return null;
  }
};

export const unmuteGroupChat = async (groupId: string): Promise<ChatMuteStatus | null> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/groups/${encodeURIComponent(groupId)}/mute`,
      withApiCredentials({ method: 'DELETE', headers: await getAuthHeaders() })
    );
    return parseMuteResponse(response);
  } catch (error) {
    console.error('Error unmuting group chat:', error);
    return null;
  }
};

// ============ OFFLINE BUNDLES SYNC FUNCTIONS ============

export interface OfflineBundleData {
  bundleId: string;
  config: any;
  questions: any[];
  groupName: string;
  displayName?: string;
  downloadedAt: Date;
}

// Fetch offline bundles from server

export const fetchOfflineBundles = async (userId: string): Promise<OfflineBundleData[]> => {
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    const response = await fetch(`${getApiRoot()}/api/v1/offline-bundles`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (response.status === 401 || response.status === 403) return [];
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return (result.data || []).map((item: any) => ({
      bundleId: item.bundle_id,
      config: item.config,
      questions: item.questions,
      groupName: item.group_name,
      displayName: item.display_name ?? undefined,
      downloadedAt: new Date(item.downloaded_at),
    }));
  } catch (error) {
    console.error('Error fetching offline bundles:', error);
    return [];
  }
};

// Save offline bundle to server

export const saveOfflineBundle = async (userId: string, bundle: OfflineBundleData): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/offline-bundles`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, bundle: {
        ...bundle,
        downloadedAt: bundle.downloadedAt instanceof Date ? bundle.downloadedAt.toISOString() : bundle.downloadedAt,
      } }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({} as Record<string, string>));
      throw new Error(result.error || result.message || `HTTP error! status: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('Error saving offline bundle:', error);
    return false;
  }
};

// Delete offline bundle from server

export const deleteOfflineBundle = async (userId: string, bundleId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/offline-bundles?bundleId=${encodeURIComponent(bundleId)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return true;
  } catch (error) {
    console.error('Error deleting offline bundle:', error);
    return false;
  }
};

// Sync local offline bundles with server (merge strategy)
export const syncOfflineBundles = async (
  userId: string, 
  localBundles: OfflineBundleData[]
): Promise<OfflineBundleData[]> => {
  try {
    // Fetch server bundles
    const serverBundles = await fetchOfflineBundles(userId);
    
    // Create a map for easy lookup
    const serverBundleMap = new Map(serverBundles.map(b => [b.bundleId, b]));
    const localBundleMap = new Map(localBundles.map(b => [b.bundleId, b]));
    
    // Merge: keep all unique bundles from both sources
    const mergedBundles: OfflineBundleData[] = [];
    const processedIds = new Set<string>();
    
    // Add all local bundles and sync to server if not there
    for (const localBundle of localBundles) {
      mergedBundles.push(localBundle);
      processedIds.add(localBundle.bundleId);
      
      if (!serverBundleMap.has(localBundle.bundleId)) {
        // Upload to server
        await saveOfflineBundle(userId, localBundle);
      }
    }
    
    // Add server bundles that aren't local
    for (const serverBundle of serverBundles) {
      if (!processedIds.has(serverBundle.bundleId)) {
        mergedBundles.push(serverBundle);
        processedIds.add(serverBundle.bundleId);
      }
    }
    
    return mergedBundles;
  } catch (error) {
    console.error('Error syncing offline bundles:', error);
    return localBundles; // Return local bundles on error
  }
};

// ============================================
// USER SETTINGS (nested schema — web + mobile)
// ============================================

export type SaveUserSettingsResult = {
  ok: boolean;
  settings?: UserSettings;
  settingsVersion?: number;
  /** True when the failure was a CAS conflict after retries (another device wrote). */
  conflict?: boolean;
};

function noteSettingsVersion(version: unknown): void {
  if (typeof version === 'number' && Number.isFinite(version)) {
    lastKnownSettingsVersion = version;
  }
}

export const fetchUserSettings = async (userId: string): Promise<UserSettings | null> => {
  try {
    if (!(await hasValidSession())) return null;

    const doFetch = async () =>
      fetch(`${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/settings`, {
        method: 'GET',
        headers: await getAuthHeaders(),
      });

    let response = await doFetch();

    if (response.status === 401 || response.status === 403) {
      const { handleApiAuthFailure } = await import('./sessionHandler');
      if (await handleApiAuthFailure(response.status)) {
        response = await doFetch();
      } else {
        return null;
      }
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }

    const result = await response.json();
    noteSettingsVersion(result.data?.settingsVersion);
    return normalizeUserSettings(result.data?.settings);
  } catch (error) {
    console.error('Error fetching user settings:', error);
    return null;
  }
};

/**
 * Persist a category patch (preferred) or full settings blob.
 * On 409, reloads server state and retries the same patch so concurrent
 * category changes from other writers are not overwritten.
 */
export const saveUserSettings = async (
  userId: string,
  settingsOrPatch: UserSettings | Record<string, unknown>,
  expectedSettingsVersion?: number
): Promise<boolean> => {
  const result = await saveUserSettingsDetailed(userId, settingsOrPatch, expectedSettingsVersion);
  return result.ok;
};

export const saveUserSettingsDetailed = async (
  userId: string,
  settingsOrPatch: UserSettings | Record<string, unknown>,
  expectedSettingsVersion?: number
): Promise<SaveUserSettingsResult> => {
  const run = async (): Promise<SaveUserSettingsResult> => {
    const maxAttempts = 3;
    try {
      const headers = await getRequiredAuthHeaders();
      let version = expectedSettingsVersion ?? lastKnownSettingsVersion;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await fetch(`${getApiRoot()}/api/v1/users/settings`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            settings: settingsOrPatch,
            ...(version != null ? { expectedSettingsVersion: version } : {}),
          }),
        });

        if (response.status === 409) {
          const conflictBody = await response.json().catch(() => ({}));
          const conflictData = conflictBody?.data;
          if (typeof conflictData?.settingsVersion === 'number') {
            noteSettingsVersion(conflictData.settingsVersion);
            version = conflictData.settingsVersion;
          } else {
            // Fallback: refresh from GET
            const refresh = await fetch(
              `${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/settings`,
              { headers }
            );
            if (refresh.ok) {
              const body = await refresh.json().catch(() => ({}));
              noteSettingsVersion(body?.data?.settingsVersion);
              version = lastKnownSettingsVersion;
            }
          }
          // Retry the same patch — server deep-merges categories onto latest.
          if (attempt + 1 < maxAttempts) continue;
          console.warn(
            'Settings version conflict after retries; latest version reloaded.'
          );
          return {
            ok: false,
            conflict: true,
            settings: conflictData?.settings
              ? normalizeUserSettings(conflictData.settings)
              : undefined,
            settingsVersion:
              typeof conflictData?.settingsVersion === 'number'
                ? conflictData.settingsVersion
                : lastKnownSettingsVersion,
          };
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || error.error || 'Failed to save user settings');
        }

        const body = await response.json().catch(() => ({}));
        const nextVersion =
          typeof body?.data?.settingsVersion === 'number'
            ? body.data.settingsVersion
            : version != null
              ? version + 1
              : undefined;
        noteSettingsVersion(nextVersion);
        const authoritative = body?.data?.settings
          ? normalizeUserSettings(body.data.settings)
          : undefined;

        return {
          ok: true,
          settings: authoritative,
          settingsVersion: nextVersion,
        };
      }

      return { ok: false };
    } catch (error) {
      console.error('Error saving user settings:', error);
      return { ok: false };
    }
  };

  const queued = settingsSaveQueue.then(run, run);
  settingsSaveQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
};

// ============================================
// USER PREFERENCES SYNC (Theme, Settings)
// ============================================

export interface UserPreferences {
  theme: 'light' | 'dark';
  lowDataMode?: boolean;
  /** Canonical appearance preference including `system` (stored in preferences JSONB). */
  themePreference?: 'light' | 'dark' | 'system';
  preferences?: Record<string, any>;
}

export const fetchUserPreferences = async (userId: string): Promise<UserPreferences | null> => {
  console.log('Fetching user preferences for user:', userId);
  try {
    if (!(await hasValidSession())) {
      return null;
    }

    const response = await fetch(`${getApiRoot()}/api/v1/preferences/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No preferences found
      }
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user preferences');
    }

    const result = await response.json();
    const data = result.data;

    return data ? {
      theme: data.theme || 'light',
      lowDataMode: data.preferences?.lowDataMode === true,
      themePreference:
        data.preferences?.themePreference === 'system' ||
        data.preferences?.themePreference === 'light' ||
        data.preferences?.themePreference === 'dark'
          ? data.preferences.themePreference
          : undefined,
      preferences: data.preferences || {}
    } : null;
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
};

export const saveUserPreferences = async (userId: string, prefs: UserPreferences): Promise<boolean> => {
  console.log('Saving user preferences for user:', userId, 'prefs:', prefs);
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/preferences`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId,
        theme: prefs.theme,
        preferences: {
          ...(prefs.preferences || {}),
          ...(prefs.lowDataMode !== undefined ? { lowDataMode: prefs.lowDataMode } : {}),
          ...(prefs.themePreference ? { themePreference: prefs.themePreference } : {}),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Error saving user preferences:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }
};

// ============================================
// BUDGET SYNC (Monthly Budget & Transactions)
// ============================================

export interface BudgetData {
  monthlyLimit: number;
  monthYear: string; // Format: "YYYY-MM"
}

export interface TransactionData {
  id: string;
  type: 'INCOME' | 'EXPENSE' | 'INVESTMENT' | string; // Accepts uppercase from app, converts to lowercase for DB
  amount: number;
  category?: string;
  description?: string;
  date: string;
}

// Budget reads go through the API, not PostgREST. The direct supabase-js
// queries raced auth-session setup in cookie mode and ran as anon (42501)
// while every API-backed fetch on the same screen worked — Bearer custody via
// getAuthHeaders is the path that is reliable at boot. Writes already moved
// (budgetApi.ts); these were the stragglers.
export const fetchUserBudget = async (userId: string, monthYear?: string): Promise<BudgetData | null> => {
  try {
    const targetMonth = monthYear || new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const headers = await getAuthHeaders();
    if (!headers.Authorization) return null;

    const response = await fetch(
      `${getApiRoot()}/api/v1/users/${userId}/budget?monthYear=${encodeURIComponent(targetMonth)}`,
      withApiCredentials({ headers })
    );
    if (!response.ok) {
      console.error('Error fetching user budget: HTTP', response.status);
      return null;
    }
    const body = await response.json().catch(() => ({}));
    const data = body?.data;
    return data
      ? {
          monthlyLimit: Number(data.monthly_limit) || 0,
          monthYear: data.month_year,
        }
      : null;
  } catch (error) {
    console.error('Error fetching user budget:', error);
    return null;
  }
};

export const saveUserBudget = async (userId: string, budget: BudgetData): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('user_budgets')
      .upsert({
        user_id: userId,
        monthly_limit: budget.monthlyLimit,
        month_year: budget.monthYear,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,month_year'
      });

    if (error) {
      console.error('Error saving user budget:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving user budget:', error);
    return false;
  }
};

export const fetchBudgetTransactions = async (userId: string): Promise<TransactionData[]> => {
  try {
    if (!userId) return [];
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      console.warn('No valid session available for fetching budget transactions.');
      return [];
    }

    // The route is self-scoped server-side; no client-side user matching needed.
    const response = await fetch(
      `${getApiRoot()}/api/v1/budget/transactions`,
      withApiCredentials({ headers })
    );
    if (!response.ok) {
      console.error('Error fetching budget transactions: HTTP', response.status);
      return [];
    }
    const body = await response.json().catch(() => ({}));
    const rows: Array<Record<string, unknown>> = Array.isArray(body?.data) ? body.data : [];

    return rows.map(t => ({
      id: String(t.id),
      type: String(t.type).toUpperCase() as 'INCOME' | 'EXPENSE' | 'INVESTMENT',
      amount: parseFloat(String(t.amount)),
      category: t.category as string | undefined,
      description: t.description as string | undefined,
      date: t.date as string,
    }));
  } catch (error) {
    console.error('Error fetching budget transactions:', error);
    return [];
  }
};

export const saveBudgetTransaction = async (userId: string, transaction: TransactionData): Promise<boolean> => {
  try {
    if (!userId || !(await hasValidSession())) {
      console.warn('No valid session available for saving budget transaction.');
      return false;
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('Unable to determine authenticated user ID for saving budget transaction.');
      return false;
    }

    // Prefer API (service role) — direct PostgREST upsert hits RLS on conflict path.
    const { saveBudgetTransactionApi } = await import('./budgetApi');
    await saveBudgetTransactionApi({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      category: transaction.category,
      description: transaction.description,
      date: transaction.date,
    });
    return true;
  } catch (error) {
    console.error('Error saving budget transaction:', error);
    return false;
  }
};

export const deleteBudgetTransaction = async (transactionId: string): Promise<boolean> => {
  try {
    const { deleteBudgetTransactionApi } = await import('./budgetApi');
    await deleteBudgetTransactionApi(transactionId);
    return true;
  } catch (error) {
    console.error('Error deleting budget transaction:', error);
    return false;
  }
};

export const syncBudgetTransactionsToCloud = async (
  userId: string,
  localTransactions: TransactionData[]
): Promise<TransactionData[]> => {
  try {
    // Fetch server transactions
    const serverTransactions = await fetchBudgetTransactions(userId);
    const serverTransactionMap = new Map(serverTransactions.map(t => [t.id, t]));
    
    const mergedTransactions: TransactionData[] = [];
    const processedIds = new Set<string>();
    
    // Process local transactions
    for (const localTransaction of localTransactions) {
      mergedTransactions.push(localTransaction);
      processedIds.add(localTransaction.id);
      
      if (!serverTransactionMap.has(localTransaction.id)) {
        // Upload to server
        await saveBudgetTransaction(userId, localTransaction);
      }
    }
    
    // Add server transactions that aren't local
    for (const serverTransaction of serverTransactions) {
      if (!processedIds.has(serverTransaction.id)) {
        mergedTransactions.push(serverTransaction);
        processedIds.add(serverTransaction.id);
      }
    }
    
    // Sort by date descending
    mergedTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return mergedTransactions;
  } catch (error) {
    console.error('Error syncing budget transactions:', error);
    return localTransactions;
  }
};

// ============================================
// PENDING SYNC RESULTS (Offline Test Results)
// ============================================

export interface PendingSyncResult {
  id: string;
  resultData: any;
  createdAt: string;
  synced: boolean;
}

export const fetchPendingSyncResults = async (userId: string): Promise<PendingSyncResult[]> => {
  try {
    const { data, error } = await supabase
      .from('pending_sync_results')
      .select('*')
      .eq('user_id', userId)
      .eq('synced', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending sync results:', error);
      return [];
    }

    return (data || []).map(r => ({
      id: r.id,
      resultData: r.result_data,
      createdAt: r.created_at,
      synced: r.synced
    }));
  } catch (error) {
    console.error('Error fetching pending sync results:', error);
    return [];
  }
};

export const savePendingSyncResult = async (userId: string, result: PendingSyncResult): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .upsert({
        id: result.id,
        user_id: userId,
        result_data: result.resultData,
        created_at: result.createdAt,
        synced: result.synced
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error saving pending sync result:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving pending sync result:', error);
    return false;
  }
};

export const markPendingSyncResultAsSynced = async (resultId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .update({
        synced: true,
        synced_at: new Date().toISOString()
      })
      .eq('id', resultId);

    if (error) {
      console.error('Error marking pending sync result as synced:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking pending sync result as synced:', error);
    return false;
  }
};

export const deletePendingSyncResult = async (resultId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .delete()
      .eq('id', resultId);

    if (error) {
      console.error('Error deleting pending sync result:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting pending sync result:', error);
    return false;
  }
};

export const syncPendingResultsToCloud = async (
  userId: string,
  localResults: PendingSyncResult[]
): Promise<PendingSyncResult[]> => {
  try {
    // Fetch server results
    const serverResults = await fetchPendingSyncResults(userId);
    const serverResultMap = new Map(serverResults.map(r => [r.id, r]));
    
    const mergedResults: PendingSyncResult[] = [];
    const processedIds = new Set<string>();
    
    // Process local results
    for (const localResult of localResults) {
      mergedResults.push(localResult);
      processedIds.add(localResult.id);
      
      if (!serverResultMap.has(localResult.id)) {
        // Upload to server
        await savePendingSyncResult(userId, localResult);
      }
    }
    
    // Add server results that aren't local
    for (const serverResult of serverResults) {
      if (!processedIds.has(serverResult.id)) {
        mergedResults.push(serverResult);
        processedIds.add(serverResult.id);
      }
    }
    
    return mergedResults;
  } catch (error) {
    console.error('Error syncing pending results:', error);
    return localResults;
  }
};

// --- Email verification & password reset ---

export function getWebAuthRedirectOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:5173';
}

export const resendSignupConfirmation = async (email: string, redirectTo?: string) => {
  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirectTo ?? getWebAuthRedirectOrigin() },
  });
  if (error) throw error;
  return data;
};

export const sendPasswordResetEmail = async (email: string, redirectTo?: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo ?? `${getWebAuthRedirectOrigin()}/reset-password`,
  });
  if (error) throw error;
  return data;
};

export const verifySignupOtp = async (email: string, token: string) => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.replace(/\D/g, '').slice(0, 6),
    type: 'signup',
  });
  if (error) throw error;
  return data;
};

export const updateAuthPassword = async (newPassword: string) => {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
};
