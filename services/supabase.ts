import { createClient } from '@supabase/supabase-js'
import { Group, UserQuestionStats } from '../types'
import { getSupabaseUrl, getSupabaseAnonKey, getApiBaseUrl, shouldClearClientStorageKeyOnLogout } from '@lantern/shared'
import { mapUserFromApi, mapFlashcardsFromApi } from '@lantern/shared/utils/apiMappers'
import {
  listingsCacheKey,
  marketplaceCategoryAnalyticsCache,
  marketplaceListingsCache,
  parseRetryAfterMs,
  RateLimitError,
} from '@lantern/shared'
import { normalizeTestResultSession } from '@lantern/shared/utils'
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
  type CookieSessionResolveResult,
} from './authCookieSession'

// Use shared config for URLs
const supabaseUrl = getSupabaseUrl()
const supabaseAnonKey = getSupabaseAnonKey()
const getApiRoot = () => (getApiBaseUrl() || "").replace(/\/$/, "")
const cookieAuthEnabled = typeof window !== 'undefined' && isCookieAuthEnabled()

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
      if (authCode !== 'SESSION_REVOKED' && authCode !== 'ACCOUNT_BANNED' && authCode !== 'ACCOUNT_DEACTIVATED') {
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
      }
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

/** Server-side session invalidation + Supabase global sign-out + local cleanup. */
export async function apiLogoutSession(): Promise<void> {
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

export type SessionResolveFailure = CookieSessionResolveResult extends { ok: false; reason: infer R }
  ? R
  : never;

export type SessionResolveResult =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']> }
  | { ok: false; reason: SessionResolveFailure };

/** Restore the client session from cookies or local tokens without signing out on transient errors. */
export async function resolveClientSession(): Promise<SessionResolveResult> {
  if (isCookieAuthEnabled()) {
    return restoreCookieSession();
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
  expiresInSeconds?: number
): Promise<string> {
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/storage/signed-url`,
    withApiCredentials({
      method: 'POST',
      headers,
      body: JSON.stringify({ bucket, path, expiresInSeconds }),
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

export const fetchGroups = async (userId: string) => {
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
  console.log('Batch adding members to group:', groupId, 'count:', userIds.length);
  
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
    throw new Error(error.message || 'Failed to add members to group');
  }

  const result = await response.json();
  console.log('Batch add result:', result.data);
  return result.data as { added: string[]; alreadyMembers: string[]; failed: string[] };
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
  clientMessageId?: string
) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/group/${groupId}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ content, userId, clientMessageId }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication required. Please sign in again.');
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to send message');
    }

    const result = await response.json();
    return result.data;
  } catch (error: any) {
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for sendMessage');
      return null;
    }
    throw error;
  }
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

export const fetchDecks = async (userId: string, options?: { includeShared?: boolean }) => {
  const includeShared = options?.includeShared ?? false;
  console.log('Fetching decks for user:', userId, 'includeShared:', includeShared);
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    const params = new URLSearchParams();
    params.set('userId', userId);
    if (includeShared) params.set('includeShared', 'true');

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
    const data = Array.isArray(result.data) ? result.data : [];
    console.log('Fetched decks count:', data.length);
    return data.filter((d: any) => d && d.id);
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
    const normalizedQuery = query.trim().toLowerCase().replace(/^@+/, '');
    if (normalizedQuery.length < 2) {
      return [];
    }
    const response = await fetch(`${getApiRoot()}/api/v1/users/search?q=${encodeURIComponent(normalizedQuery)}&limit=${limit}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
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
    console.error('Error creating flashcard:', error.message || JSON.stringify(error));
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

export const updateFlashcard = async (flashcardId: string, updates: {
  deckId?: string;
  type?: string;
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
  rating: 'again' | 'hard' | 'good' | 'easy'
) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}/review`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ rating }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'Failed to review flashcard');
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

export const fetchTestResults = async (userId: string, options?: { limit?: number }) => {
  console.log('Fetching test results for user:', userId);
  try {
    if (!(await hasValidSession())) {
      return [];
    }

    const limit = options?.limit ?? 50;
    const response = await fetch(`${getApiRoot()}/api/v1/tests?status=completed&limit=${limit}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Fetched test results count:', result.data.length);
    return (result.data || []).map((item: any) => {
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
  } catch (error) {
    console.error('Error fetching test results:', error);
    throw error;
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
            retryStats[stat.question_id] = {
              correctAttempts: stat.correct_attempts || 0,
              incorrectAttempts: stat.incorrect_attempts || 0,
              lastAttempted: stat.last_attempted || null
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
        stats[stat.question_id] = {
          correctAttempts: stat.correct_attempts || 0,
          incorrectAttempts: stat.incorrect_attempts || 0,
          lastAttempted: stat.last_attempted || null
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
    throw new Error(json.error || json.message || `Pause failed (${response.status})`);
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
    const headers = await getAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/lifecycle`, { headers });
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
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  campus_id?: string;
  country_code?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
} = {}): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number } }> => {
  const cacheKey = listingsCacheKey(filters as Record<string, unknown>);
  const emptyPagination = {
    page: Number(filters.page || 1),
    limit: Number(filters.limit || 20),
    total: 0,
  };

  try {
    return await marketplaceListingsCache.get(cacheKey, async () => {
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
    console.error('Error fetching listings:', error);
    return { data: [], pagination: emptyPagination };
  }
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
    console.error('Error fetching favorites:', error);
    return []; // Return empty array on error
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

export const checkSavedSearchMatches = async (searchId: string) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/saved-searches/${searchId}/matches`,
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

export const buyMarketplaceListingNow = async (listingId: string, couponCode?: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/buy-now`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(couponCode ? { couponCode } : {}),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to complete purchase');
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

export const fetchMarketplaceListingFull = async (
  listingId: string,
  userId?: string
): Promise<{ listing: any; isFavorited: boolean; similarListings: any[] }> => {
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

export const uploadFlashcardImage = async (file: File) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Must be signed in to upload images');
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const filePath = `${user.id}/cards/${fileName}`;

  const { error } = await supabase.storage
    .from('flashcard-images')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    console.error('Error uploading flashcard image:', error);
    throw new Error(error.message);
  }

  const url = await fetchSignedStorageUrl('flashcard-images', filePath);
  return { url, path: filePath };
};

/** Upload a question attachment; path must be scoped under auth uid for storage RLS. */
export const uploadQuestionImage = async (file: File) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Must be signed in to upload images');

  const fileExt = file.name.split('.').pop() || 'jpg';
  const fileName = `question-${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const filePath = `${user.id}/questions/${fileName}`;

  const { error } = await supabase.storage
    .from('question-images')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    console.error('Error uploading question image:', error);
    throw new Error(error.message);
  }

  const url = await fetchSignedStorageUrl('question-images', filePath);
  return { url, path: filePath };
};

export const uploadMarketplaceImage = async (file: File, listingId?: string) => {
  console.log('Uploading marketplace image:', file.name);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) throw new Error('Must be signed in to upload images');
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = listingId
      ? `${user.id}/listings/${listingId}/${fileName}`
      : `${user.id}/temp/${fileName}`;

    const { data, error } = await supabase.storage
      .from('marketplace-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(error.message);
    }

    const url = await fetchSignedStorageUrl('marketplace-images', filePath);
    console.log('Image uploaded successfully:', url);
    return { url, path: filePath };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
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
  try {
    const { page = 1, limit = 50 } = options;
    const queryParams = new URLSearchParams({
      otherUserId,
      page: page.toString(),
      limit: limit.toString(),
    });
    
    const response = await fetch(`${getApiRoot()}/api/v1/messages/user/${userId}?${queryParams}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch direct messages');
    }

    const result = await response.json();
    console.log('Fetched direct messages count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching direct messages:', error);
    throw error;
  }
};

export const fetchDmThreads = async (userId: string) => {
  try {
    const isAuthenticated = await hasValidSession();
    if (!isAuthenticated) {
      // Auth can still be initializing during startup; treat as empty until token is ready.
      return [];
    }

    const authHeaders = await getAuthHeaders();
    if (!authHeaders.Authorization) {
      // Avoid unauthenticated requests during auth bootstrap races.
      return [];
    }

    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/threads`, {
      method: 'GET',
      headers: authHeaders,
    });

    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch DM threads');
    }

    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching DM threads:', error);
    return [];
  }
};

export const sendDirectMessage = async (
  senderId: string,
  recipientId: string,
  content: string,
  clientMessageId?: string
) => {
  console.log('Sending direct message from:', senderId, 'to:', recipientId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/user/${senderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({
        content,
        recipientId,
        clientMessageId,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Failed to send direct message');
    }

    const result = await response.json();
    console.log('Direct message sent:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error sending direct message:', error);
    throw error;
  }
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
export const markGroupAsRead = async (groupId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error('Failed to mark group as read');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking group as read:', error);
    return false;
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
export const markDMAsRead = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/${threadId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error('Failed to mark DM as read');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking DM as read:', error);
    return false;
  }
};

// Delete a DM thread
export const deleteDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/${threadId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('Failed to delete DM thread');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting DM thread:', error);
    return false;
  }
};

// Archive a DM thread
export const archiveDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/${threadId}/archive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('Failed to archive DM thread');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error archiving DM thread:', error);
    return false;
  }
};

// Unarchive a DM thread
export const unarchiveDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/messages/dm/${threadId}/unarchive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('Failed to unarchive DM thread');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error unarchiving DM thread:', error);
    return false;
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

export const fetchUserSettings = async (userId: string): Promise<UserSettings | null> => {
  try {
    if (!(await hasValidSession())) return null;

    const response = await fetch(`${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/settings`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }

    const result = await response.json();
    return normalizeUserSettings(result.data?.settings);
  } catch (error) {
    console.error('Error fetching user settings:', error);
    return null;
  }
};

export const saveUserSettings = async (userId: string, settings: UserSettings): Promise<boolean> => {
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ settings }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to save user settings');
    }

    return true;
  } catch (error) {
    console.error('Error saving user settings:', error);
    return false;
  }
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

export const fetchUserBudget = async (userId: string, monthYear?: string): Promise<BudgetData | null> => {
  try {
    const targetMonth = monthYear || new Date().toISOString().slice(0, 7); // "YYYY-MM"
    
    const { data, error } = await supabase
      .from('user_budgets')
      .select('*')
      .eq('user_id', userId)
      .eq('month_year', targetMonth)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user budget:', error);
      return null;
    }

    return data ? {
      monthlyLimit: parseFloat(data.monthly_limit) || 0,
      monthYear: data.month_year
    } : null;
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
    if (!userId || !(await hasValidSession())) {
      console.warn('No valid session available for fetching budget transactions.');
      return [];
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('Unable to determine authenticated user ID for budget transactions.');
      return [];
    }

    if (authUserId !== userId) {
      console.warn('Budget transaction fetch userId does not match authenticated user; using authenticated user id.', {
        requested: userId,
        authenticated: authUserId,
      });
    }

    const { data, error } = await supabase
      .from('budget_transactions')
      .select('*')
      .eq('user_id', authUserId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching budget transactions:', error);
      return [];
    }

    return (data || []).map(t => ({
      id: t.id,
      type: t.type.toUpperCase() as 'INCOME' | 'EXPENSE' | 'INVESTMENT',
      amount: parseFloat(t.amount),
      category: t.category,
      description: t.description,
      date: t.date
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

export const sendPresenceHeartbeat = async (): Promise<void> => {
  try {
    const headers = await getAuthHeaders();
    // Avoid noisy 401s when UI has a cached user but no API session yet.
    if (!headers.Authorization) return;
    await fetch(
      `${getApiRoot()}/api/v1/users/presence/heartbeat`,
      withApiCredentials({
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      })
    );
  } catch {
    // Non-fatal presence update
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
