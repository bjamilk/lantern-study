/**
 * The web app's entire data layer: one configured supabase-js client plus the
 * flat catalogue of `fetch` wrappers that every hook, store and screen calls.
 *
 * Shape of the file (top to bottom):
 *  1. Client construction — URL/anon key from `@lantern/shared` config, the
 *     cookie-mode `global.fetch` interceptor, and `fetchWithTimeout` (now a
 *     thin alias over `services/apiFetch.ts`).
 *  2. Auth plumbing — the in-memory token cache, `getAuthHeaders`, session
 *     resolve/clear, storage scrubbing, signed storage URLs.
 *  3. Domain API groups, each fronting `${getApiRoot()}/api/v1/...` on the
 *     Express BFF (apps/api-server): groups & chat, community boards, DMs,
 *     flashcards/decks, test sessions & results, question stats, dashboard,
 *     profiles & account lifecycle, notifications, marketplace (listings,
 *     orders, offers, payments, cart, shops, question banks, study packs,
 *     creators), Phase 3/4 network (communities, discovery, feed, presence,
 *     mastery, referrals, campus pages, study rooms), AI draft factory,
 *     offline bundles, settings/preferences/budget, the pending-results queue,
 *     and the Supabase-direct email/password endpoints at the very bottom.
 *
 * Two auth modes, chosen by `isCookieAuthEnabled()` (web prod is cookie mode):
 *  - Cookie mode: the real refresh token never reaches the browser. supabase-js
 *    keeps a MEMORY session (`memoryAuthStorage`) whose `refresh_token` is the
 *    literal string 'cookie-managed', `autoRefreshToken`/`persistSession` are
 *    off, and refreshes are proxied to the BFF by `supabaseFetch` (below).
 *    Requests carry `credentials: 'include'` (see `withApiCredentials`).
 *  - Legacy token mode: supabase-js persists to localStorage under
 *    `sb-*-auth-token` and refreshes itself; requests carry a Bearer header.
 * Both modes funnel through `getAuthHeaders()`, which prefers the module-level
 * `_cachedAccessToken` and only falls back to the network when it is empty.
 *
 * Touches: Supabase PostgREST + storage + realtime via `supabase`; localStorage
 *  (`sb-*-auth-token`, `auth-storage-v2`, `lantern_recently_viewed`, the
 *  marketplace caches); the module-level signed-URL cache in
 *  `utils/signedUrlCache`; `services/authCookieSession` (circular — imported
 *  dynamically inside the interceptor); `services/sessionHandler`,
 *  `services/accountSuspension`, `services/sentry`.
 * ONE transport (R1). Every BFF call that needs a timeout or an auth retry goes
 * through `services/apiFetch.ts`, directly or via the `fetchWithTimeout` alias.
 * Before R1 this file carried SIX policies: `fetchWithTimeout`'s own, plus five
 * hand-rolled "call → classify → call again" pairs (`fetchGroups`,
 * `upsertUserQuestionStat`, `fetchUserQuestionStats`, `fetchAccountLifecycle`,
 * `fetchUserSettings`) that disagreed about budgets and about whether a 403 may
 * be refreshed — one of them was the unbounded recursion of E3 C4. They are all
 * gone; `apiFetch` applies `services/sessionHandler`'s single policy (F1).
 * The bare `fetch(...)` calls that remain below are the ones that never had a
 * timeout or a retry: they are left bare deliberately, because giving them
 * either would be a behaviour change, not a refactor.
 *
 * Gotchas:
 *  - Almost everything here goes through the BFF, NOT PostgREST. Direct
 *    `supabase.from(...)` use is the exception and is called out where it
 *    happens; those calls are the ones RLS and embed ambiguity apply to.
 *  - Any SECOND supabase client created anywhere in the app must be given the
 *    same `global.fetch` (`supabaseFetch`), or cookie-mode refreshes on that
 *    client sign the user out.
 *  - `_cachedAccessToken !== null` is used as "this viewer ever had a session"
 *    in the 401 path; clearing it changes guest behaviour on public pages.
 *  - Comments marked `KNOWN ISSUE (tracked)` anywhere in the web app are real,
 *    reproduced defects left in place deliberately — do not "fix" them
 *    silently. A marker that has been dealt with is rewritten as
 *    `FIXED (<lane>)` and says what changed; one that is staying carries its
 *    reason inline (`KNOWN ISSUE (tracked, deferred <lane>: …)`). This file
 *    has none left of its own.
 */
import { createClient } from '@supabase/supabase-js'
import { markIntentionalSignOut } from './sentry';
import { apiFetch } from './apiFetch';
import { withStudySetId } from './testSessionPayload';
import { withPurchaseIntent } from './marketplacePurchaseIntent';
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
import { mapGroupRows } from '@lantern/shared/groups'
import { UNFILED_COURSE_ID } from '../utils/libraryArchive'
import {
  listingsCacheKey,
  marketplaceCategoryAnalyticsCache,
  marketplaceListingsCache,
  parseRetryAfterMs,
  RateLimitError,
} from '@lantern/shared'
import { normalizeTestResultSession, retryUncertainDelivery, toWireClientMessageId } from '@lantern/shared/utils'
import { isQuestionStatEligible } from '@lantern/shared/api'
import {
  createSignedUrlBatcher,
  type SignedUrlBatchResult,
  type SignedUrlRequest,
} from '@lantern/shared/utils/signedUrlBatch'
import type { StudyPackContentInput, StudyPackCounts, StudyPackDraft, StudyPackDraftSummary } from '@lantern/shared/marketplace'
import type {
  BoardBookmarkEntry,
  Community,
  CommunityChannels,
  CommunityDetail,
  CommunityMembersPage,
  CourseClassSignal,
  CourseReadiness,
  DiscoverGroup,
  DiscoverPerson,
  ExamReadiness,
  FeedPage,
  LearningConnectionSummary,
  MasteryGraph,
  MyCommunity,
  PresenceSnapshot,
  ReferralSummary,
  TopicMastery,
} from '@lantern/shared/network'
import { COMMUNITY_BOARD_COPY } from '@lantern/shared/network'
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

// Builds the Error that `retryUncertainDelivery` (shared) inspects: it retries
// only when `deliveryUncertain` is set, i.e. 408 or any 5xx — the cases where
// the write may actually have landed. 4xx is a definite rejection, never retried.
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

// ─── Cookie-mode auth-refresh interception ──────────────────────────────────
// In cookie mode the browser never holds the real refresh token — the memory
// session carries the literal placeholder 'cookie-managed'. But gotrue-js
// still refreshes INTERNALLY whenever any caller touches an expired session
// (getSession / setSession / refreshSession all do this), posting that
// placeholder to /auth/v1/token. Supabase answers 400 and supabase-js reacts
// by discarding the session and emitting SIGNED_OUT — a spurious sign-out
// while the HttpOnly cookie session is still valid (Sentry WEB-17/WEB-18,
// 90+ events). Route those refreshes through the cookie BFF instead,
// single-flight so concurrent triggers share one /refresh call.
//
// Three branches out of the BFF call, all load-bearing:
//   BFF 401/403  → synthesise a 400 invalid_grant, which is exactly what
//                  gotrue-js treats as "refresh token is dead" → SIGNED_OUT.
//                  This is the ONLY path that may sign a user out.
//   BFF !ok      → `throw new TypeError('Failed to fetch')`. Deliberate, not a
//                  bug: gotrue-js classifies a thrown TypeError as a network
//                  error and KEEPS the session for a later retry. Returning a
//                  5xx Response instead would be read as a failed refresh.
//   BFF ok       → a gotrue-shaped 200 carrying the new session, with
//                  refresh_token forced back to 'cookie-managed' so the next
//                  internal refresh is intercepted here again.
// A missing access_token on a 200 also takes the TypeError branch (keep the
// session rather than sign out over a malformed body).
let cookieBffRefreshInFlight: Promise<Response> | null = null;

// Every request from the supabase client passes through here; only POSTs to
// /auth/v1/token whose body contains the 'cookie-managed' placeholder are
// diverted. Everything else (PostgREST, storage, real refreshes in legacy
// token mode) is handed straight to the global fetch.
const supabaseFetch: typeof fetch = (input, init) => {
  if (!cookieAuthEnabled) return fetch(input as RequestInfo, init);
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const body = typeof init?.body === 'string' ? init.body : '';
  if (!url.includes('/auth/v1/token') || !body.includes('cookie-managed')) {
    return fetch(input as RequestInfo, init);
  }
  if (!cookieBffRefreshInFlight) {
    cookieBffRefreshInFlight = (async () => {
      // Dynamic import: this module and authCookieSession are circular.
      const { cookieAuthFetch, applyMemorySession } = await import('./authCookieSession');
      const bff = await cookieAuthFetch('/refresh', { method: 'POST' });
      if (bff.status === 401 || bff.status === 403) {
        // Genuinely revoked — hand gotrue-js the 400 it expects so it signs out.
        return new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'Session revoked' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!bff.ok) {
        // Transient (5xx / rate limit): a network-style failure makes
        // gotrue-js KEEP the session and retry later instead of signing out.
        throw new TypeError('Failed to fetch');
      }
      const payload = (await bff.json().catch(() => ({}))) as {
        data?: { session?: import('@supabase/supabase-js').Session };
      };
      const session = payload.data?.session;
      if (!session?.access_token) throw new TypeError('Failed to fetch');
      applyMemorySession(session);
      return new Response(JSON.stringify({ ...session, refresh_token: 'cookie-managed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })().finally(() => {
      cookieBffRefreshInFlight = null;
    });
  }
  // `.clone()` per caller: a Response body can only be read once, and every
  // concurrent refresh trigger shares this single in-flight Response.
  return cookieBffRefreshInFlight.then((r) => r.clone());
};

// The single client the whole web app shares. In cookie mode the session lives
// only in memory and only the BFF can refresh it, so auto-refresh and
// persistence are both disabled; `detectSessionInUrl` stays on in both modes
// for the OAuth / email-confirmation redirect hash.
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
    fetch: supabaseFetch,
    headers: {
      // PostgREST will respond with JSON; include wildcard and object media type
      'Accept': 'application/json, text/plain, */*, application/vnd.pgrst.object+json',
    },
  },
})

// REFACTORED (R1): the transport itself now lives in `services/apiFetch.ts` —
// this is a thin, signature-compatible alias so the ~60 call sites below (and
// F3's money calls, whose `Idempotency-Key` header passes through untouched)
// did not have to change. Everything it used to do by hand it still does, in
// the same order, in one place:
//  - AbortController timeout surfacing as `Error('Request timed out')`, NOT an
//    AbortError, so callers cannot distinguish it from a server-side timeout;
//  - the non-blocking ACCOUNT_SUSPENDED sniff on any 403;
//  - TERMINAL_AUTH_CODE (SESSION_REVOKED / ACCOUNT_BANNED / ACCOUNT_DEACTIVATED)
//    → sign out once with that reason, no refresh, no retry;
//  - 401 with no cached token → returned untouched (a guest hitting an authed
//    endpoint must not trigger the "session expired" redirect);
//  - otherwise ONE retry, gated by `handleApiAuthFailure` (F1), replaying with
//    fresh auth headers layered over the caller's.
// The one thing that moved: the refresh is no longer hand-rolled here, so it
// shares sessionHandler's single-flight and its once-per-session expiry latch.
// Pass `allowRetry = false` to opt out of the auth retry, as before.
const fetchWithTimeout = (
  url: string,
  options: RequestInit,
  timeoutMs: number = 8000,
  allowRetry = true
): Promise<Response> => apiFetch(url, options, { timeoutMs, allowAuthRetry: allowRetry });

// ─── Cached Auth Token Layer ───────────────────────────────────────────────────
// Instead of calling supabase.auth.getSession() on every API request (which can
// take seconds on cold start), we cache the token in memory. The auth flow in
// useAppEffects.ts updates this cache whenever the session changes.
let _cachedAccessToken: string | null = null;
let _cachedUserId: string | null = null;

/**
 * "Has this viewer EVER held a token in this page's life?" — the guard
 * `services/apiFetch.ts` uses to tell a guest's 401 ("this endpoint needs
 * auth") from a signed-in user's 401 ("your session died"). Only the second
 * may notify session-expiry and redirect off a public page. Signed-in users
 * always have this warmed by `getAuthHeaders` in both auth modes before any
 * call can 401.
 */
export const hasCachedAccessToken = (): boolean => _cachedAccessToken !== null;

/** Call this from the auth initialization flow to populate the in-memory cache. */
export const setCachedAuthToken =(token: string | null, userId?: string | null) => {
  _cachedAccessToken = token;
  if (userId !== undefined) {
    _cachedUserId = userId;
  }
  // FIXED (F1) [E3 H13]: a real token means the session is alive again, so the
  // cookie-restore budget re-opens — sign-in after a failed boot must not stay
  // stuck behind the give-up counter for the rest of the page's life.
  if (token) {
    reopenCookieRestoreBudget();
  }
};

/**
 * The offline-queue owner stamp (`OWNER_KEY` in services/offlineQueueOwner.ts,
 * duplicated here rather than imported so that module's ownership semantics stay
 * owned by it alone). Never cleared on logout — see the note in the wipe below.
 */
const OFFLINE_QUEUE_OWNER_KEY = 'lantern_offline_owner';

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
  // FIXED (F1) [E3 C5, the "offline queues" bug]: also preserve
  // `lantern_offline_owner`. It matches the `lantern_` prefix, so this wipe used
  // to DELETE the owner stamp while leaving `pendingSyncResults` (which does not
  // match) behind — and `ensureOfflineQueueOwner`'s "no stamp at all" branch
  // then adopted the previous student's queue for whoever signed in next and
  // replayed their test results into the new account. The stamp is the guard
  // that makes the purge possible; it is not session data and must survive a
  // sign-out. Queue-ownership semantics themselves live in
  // services/offlineQueueOwner.ts and are untouched here.
  Object.keys(localStorage).forEach((key) => {
    if (key === OFFLINE_QUEUE_OWNER_KEY) return;
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
    // Phase 1 C: the server reads this to stamp learning_events.surface. Without
    // it every row lands as 'api' — and the published privacy policy tells users
    // we record whether an action happened on web or mobile.
    'X-Lantern-Surface': 'web',
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
  // Signed storage URLs live in a module-level map keyed only by
  // (bucket, path, variant) — nothing in the key says WHOSE session minted
  // them. Board and chat photos are now re-signed on read against that cache,
  // so on a shared laptop the next account would be handed URLs minted under
  // the previous student's authorisation until they expired.
  try {
    const { clearSignedUrlCache } = await import('../utils/signedUrlCache');
    clearSignedUrlCache();
  } catch {
    // Never block a sign-out on a cache.
  }
  // FIXED (F1) [E3 H14, high]: every user-scoped store is torn down here, from
  // the ONE registry in stores/userScopedStoreReset.ts, because this function is
  // the single path both the explicit logout (useAuthHandlers.handleLogout) and
  // the session-expired handler (App.tsx) go through. Dynamic import: stores
  // import this module, so a static one would close the cycle.
  try {
    const { resetAllUserScopedStores } = await import('../stores/userScopedStoreReset');
    resetAllUserScopedStores();
  } catch (e) {
    console.warn('User-scoped store reset failed during logout:', e);
  }
  clearAllClientAuthStorage();
}

// ─── Legacy (token-mode) localStorage readers ───────────────────────────────
// These scan for the supabase-js key `sb-<project-ref>-auth-token` rather than
// computing it, so they keep working if the project ref changes. In COOKIE mode
// nothing writes those keys, so they all return null — callers must not read a
// null here as "signed out".
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
// The reason code is what the caller acts on: only 'revoked' may sign the user
// out. 'network' means "unknown, keep the user where they are" and 'missing'
// means there was never a session to restore. In token mode a refresh error is
// classified 'revoked' only on a 401 or an invalid/expired/refresh message —
// anything else (including a thrown fetch) falls through to 'network'.
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

  const session = await getSessionWithTimeout(4000);
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

// ─── Cookie-mode token restore (single-flight + bounded) ────────────────────
// Every fetch that boots the app calls getAuthHeaders(). With an empty cache
// in cookie mode each one used to run its OWN getSession + /auth/refresh +
// /auth/session + setSession (which itself costs two /auth/v1/user calls) —
// dozens of concurrent callers produced the observed 64-requests-in-6s storm
// against a session that never landed. Share one in-flight restore, and stop
// after a bounded number of failures instead of looping forever.
const MAX_COOKIE_RESTORE_ATTEMPTS = 3;
/**
 * FIXED (F1) [E3 H13, high]: the budget used to be per PAGE LOAD and was never
 * re-opened, so three failures during a Render cold start or a wifi drop meant
 * `getAuthHeaders` sent no Authorization for the rest of the session and the
 * user just saw empty screens until a manual reload. Three things re-open it
 * now: a cooldown (the budget expires COOLDOWN_MS after the last failure), the
 * `online` / `visibilitychange` events, and any successful token set
 * (`setCachedAuthToken` with a token — i.e. sign-in and every successful
 * restore). A successful restore still zeroes the counter directly below.
 */
const COOKIE_RESTORE_COOLDOWN_MS = 30_000;
let cookieRestoreInFlight: Promise<string | null> | null = null;
let cookieRestoreFailures = 0;
let cookieRestoreLastFailureAt = 0;

/** Test/boot hook: forget the restore budget. */
export function resetCookieRestoreState(): void {
  cookieRestoreInFlight = null;
  cookieRestoreFailures = 0;
  cookieRestoreLastFailureAt = 0;
}

/** Re-open the give-up budget (declaration, so `setCachedAuthToken` above can call it). */
function reopenCookieRestoreBudget(): void {
  cookieRestoreFailures = 0;
  cookieRestoreLastFailureAt = 0;
}

// Reconnect / tab-focus re-opens the budget: the reason the restores failed
// (offline, cold API) is exactly the thing these events say has changed.
if (typeof window !== 'undefined') {
  window.addEventListener('online', reopenCookieRestoreBudget);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reopenCookieRestoreBudget();
  });
}

async function restoreCookieTokenSingleFlight(): Promise<string | null> {
  if (_cachedAccessToken) return _cachedAccessToken;
  if (cookieRestoreInFlight) return cookieRestoreInFlight;
  if (cookieRestoreFailures >= MAX_COOKIE_RESTORE_ATTEMPTS) {
    // FIXED (F1) [E3 H13, high]: still give up rather than hammer the BFF, but
    // only until the cooldown passes — then the budget re-opens and the next
    // call tries again. `online` / `visibilitychange` / a successful
    // `setCachedAuthToken` re-open it immediately (see the constant above).
    if (Date.now() - cookieRestoreLastFailureAt < COOKIE_RESTORE_COOLDOWN_MS) {
      return null;
    }
    cookieRestoreFailures = 0;
  }

  cookieRestoreInFlight = (async () => {
    const session = await getSessionWithTimeout(1000);
    if (session?.access_token) return session.access_token as string;

    const refreshed = (await refreshCookieSession()) ?? (await fetchCookieSession());
    if (!refreshed?.access_token) return null;
    try {
      // Push into supabase-js so PostgREST/realtime use the same token.
      await supabase.auth.setSession({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || 'cookie-managed',
      });
    } catch {
      // ignore — the memory cache is enough for REST API calls
    }
    return refreshed.access_token;
  })()
    .catch(() => null)
    .then((resolved) => {
      if (resolved) {
        _cachedAccessToken = resolved;
        // A later SUCCESS re-opens the budget in full (E3 H13).
        cookieRestoreFailures = 0;
        cookieRestoreLastFailureAt = 0;
      } else {
        cookieRestoreFailures += 1;
        cookieRestoreLastFailureAt = Date.now();
      }
      return resolved;
    })
    .finally(() => {
      cookieRestoreInFlight = null;
    });

  return cookieRestoreInFlight;
}

// Helper function to get authenticated headers
// Uses cached token for instant resolution (~0ms) on the hot path.
// Only calls getSession() on the very first cold call when no cache/localStorage token exists.
// Five ordered steps; steps 2, 4 and 5 are legacy-token-mode only, step 3 is
// cookie-mode only. The cookie-mode branch is deliberately the ONLY async work
// in that mode and is single-flighted (see above) — every boot fetch calls this
// concurrently, and a per-caller restore is what produced the 2026-09-12
// request storm.
// NOTE: on failure this resolves with headers that have NO Authorization rather
// than throwing, so the call proceeds and 401s. Use `getRequiredAuthHeaders`
// (below) when a missing token should fail fast instead.
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
  
  // 3. Cookie BFF: restore session from HttpOnly cookies (single-flight)
  if (!token && cookieMode) {
    token = await restoreCookieTokenSingleFlight();
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

/**
 * Every signed-URL resolve that lands in the same tick becomes ONE POST
 * /api/v1/storage/signed-urls. A board page renders many photos at once and a
 * per-image call would make that one request per card.
 *
 * The mobile twin lives at apps/mobile/src/services/storageUrls.ts and sends
 * the identical payload — the batching itself is shared
 * (packages/shared/src/utils/signedUrlBatch.ts) so the two cannot drift.
 */
const signedUrlBatcher = createSignedUrlBatcher({
  sign: async (items: SignedUrlRequest[], expiresInSeconds: number) => {
    const headers = await getAuthHeaders();
    const response = await fetchWithTimeout(
      `${getApiRoot()}/api/v1/storage/signed-urls`,
      withApiCredentials({
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: items.map(({ bucket, path, variant }) => ({ bucket, path, variant })),
          expiresInSeconds,
        }),
      }),
      10000
    );
    const body = await response.json().catch(
      () => ({} as { error?: string; message?: string; data?: { items?: SignedUrlBatchResult[] } })
    );
    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to sign storage URLs');
    }
    // Positional: the route Promise.alls over `items`, so result[i] answers items[i].
    return body.data?.items ?? [];
  },
});

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
  // The cache expires a minute EARLY (signedUrlCache SKEW_MS), so a URL handed
  // to an <img> is never one that dies mid-load.
  if (cached) return cached;

  const signedUrl = await signedUrlBatcher.request({ bucket, path, variant }, ttl);
  setCachedSignedUrl(cacheKey, signedUrl, ttl);
  return signedUrl;
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

// ══════════════════════════════════════════════════════════════════════════
// GROUPS (study groups, community boards, and their membership/invites)
// All of this is BFF-backed (`/api/v1/groups/**`); nothing here touches
// PostgREST, so group visibility is enforced by the server, not by RLS.
// ══════════════════════════════════════════════════════════════════════════

export const createGroup = async (groupData: { name: string; description: string; avatar_url?: string; permissions: any; invite_id: string; parent_id?: string; courseId?: string | null; visibility?: 'private' | 'community' | 'public'; communityId?: string | null; communitySurface?: 'board' | 'study_group' }, userId: string, memberIds: string[]) => {
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

// Normalises the API's mixed snake_case/camelCase group rows into `Group`.
// REFACTORED (R2): the field-by-field resolution is no longer spelled out here
// — `mapGroupRow` in `@lantern/shared/groups` owns it, and it is the same
// mapping the API server and mobile now run. This function keeps only what is
// web-shaped: `pendingMembers` (a web-only field the list endpoint never
// returns) and dropping the shared mapper's extras the web `Group` has no room
// for.
export function mapGroupListFromApi(
  items: any[],
  unreadCounts: Record<string, number> = {},
): Group[] {
  return mapGroupRows(items, { unreadCounts }).map((g) => ({
    ...g,
    pendingMembers: [],
  })) as Group[];
}

// Returns [] (not an error) when there is no session, so the groups screen
// renders empty during a cold boot instead of flashing a failure.
// FIXED (F1) [E3 C4, critical]: this used to recurse into itself on any 401/403
// with no budget, so a suspended account (403 ACCOUNT_SUSPENDED on a VALID
// session) looped refresh → 403 → refresh forever, pinning the tab.
// REFACTORED (R1): the budget, the classifier and the replay are no longer
// spelled out here at all — `apiFetch` owns them, so this function keeps only
// its own degradation rule ("auth trouble ⇒ empty list, never an error toast").
// The `attempt` parameter is gone; nothing outside ever passed it.
export const fetchGroups = async (userId: string): Promise<Group[]> => {
  console.log('Fetching groups for user:', userId);

  if (!(await hasValidSession())) {
    return [];
  }

  // `timeoutMs: null` — this call was a bare `fetch` before R1 and had no
  // deadline; adding one here would turn a slow cold start into a thrown
  // `Request timed out` the groups screen has never had to handle.
  const response = await apiFetch(
    `${getApiRoot()}/api/v1/groups`,
    { method: 'GET', headers: await getAuthHeaders() },
    { timeoutMs: null }
  );

  if (response.status === 401 || response.status === 403) {
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

// `bustCache` appends a throwaway `_=<now>` param ON TOP of `cache: 'no-store'`
// — the param is what defeats an intermediate/CDN cache after a membership
// change, since no-store only governs the browser's own HTTP cache.
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

// Membership writes pre-flight the session and force a refresh first: the
// server silently drops an unauthenticated add, so failing loudly here is
// better than a member who never appears. NOTE the refresh is
// `supabase.auth.refreshSession()` directly — in cookie mode that is the
// intercepted placeholder path, which resolves from the BFF.
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

// Partial success is normal and is REPORTED, not thrown: the result buckets
// every id into invited / added / alreadyMembers / alreadyPending / failed, so
// the caller must inspect `failed` rather than assume a 2xx meant everyone.
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

// ─── Group invites (pending list, accept/decline, invite-link preview/join) ──
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

// ══════════════════════════════════════════════════════════════════════════
// CHAT MESSAGES (group chat + community board posts share the `messages` row)
// ══════════════════════════════════════════════════════════════════════════

// The body is built ONCE, outside `request`, so the retry replays byte-identical
// bytes — including `clientMessageId`, which is what makes the replay idempotent
// server-side. `retryUncertainDelivery` only retries the 408/5xx errors minted
// by `createDeliveryResponseError`; 401/403 throws a plain Error and so is
// never retried. Optional fields are spread conditionally so an absent option
// is omitted rather than sent as undefined/null (which the server would treat
// as "clear this").
export const sendMessage = async (
  groupId: string,
  userId: string,
  content: string,
  clientMessageId?: string,
  options?: {
    replyToMessageId?: string;
    mentionedUserIds?: string[];
    subject?: string | null;
    /**
     * The post's photo, written to `messages.image_url` — a title, a body and
     * one photo in ONE row. The server accepts it only on a BOARD group and
     * only for an object under `note-files/{userId}/chat/{groupId}/`
     * (`isBoardImageUrlAllowed`), so chat and DMs are unaffected.
     */
    imageUrl?: string | null;
    /**
     * What the post IS on a community board — discussion, question,
     * announcement, event (`BOARD_POST_KINDS`). Ignored off a board and
     * DROPPED, not rejected, before the 20260908120000 migration, so a board
     * posts identically either side of it. The server re-checks who may post
     * a restricted kind (403), so the composer hiding "Announcement" is a
     * courtesy and never the gate.
     */
    postKind?: string | null;
  }
) => {
  const body = JSON.stringify({
    content,
    userId,
    // The caller's id is the LOCAL optimistic id (`temp-<uuid>`), which the API
    // rejects with 400 INVALID_CLIENT_MESSAGE_ID because it validates a strict
    // UUID. Strip the prefix here — one chokepoint for every send path — so the
    // wire value is the bare UUID the server dedupes on while the optimistic row
    // keeps the `temp-` id that `isTempMessageId` recognises.
    clientMessageId: clientMessageId ? toWireClientMessageId(clientMessageId) : clientMessageId,
    replyToMessageId: options?.replyToMessageId,
    mentionedUserIds: options?.mentionedUserIds,
    ...(options?.postKind ? { postKind: options.postKind } : {}),
    // Board post title (spec §3.4). Dropped server-side — not rejected —
    // before the 20260903120000 migration; validate with `validateBoardSubject`.
    ...(options?.subject !== undefined ? { subject: options.subject } : {}),
    ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
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

/**
 * Emoji reactions. One endpoint pair serves group messages and DMs — the
 * server resolves which the id belongs to and authorizes accordingly.
 * Returns the authoritative counts; realtime delivers everyone else's.
 *
 * HISTORY (do not re-introduce): these used to write `message_reactions`
 * through PostgREST with `.upsert(..., { onConflict: 'message_id,user_id,emoji' })`.
 * That unique index is PARTIAL, which PostgREST cannot target, so every
 * reaction 500'd with 42P10 from 1.0.44 until the write moved behind
 * `/api/v1/messages/:id/reactions`. Both functions below are LIVE
 * (components/ChatWindow.tsx, components/community/CommunityBoard.tsx) and
 * carry no upsert — keep them on the BFF endpoint.
 */
export const addMessageReaction = async (messageId: string, emoji: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    withApiCredentials({
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ emoji }),
    })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.message || 'Could not add that reaction');
  }
  return (body?.data?.reactions || {}) as Record<string, number>;
};

export const removeMessageReaction = async (messageId: string, emoji: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    withApiCredentials({
      method: 'DELETE',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ emoji }),
    })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.message || 'Could not remove that reaction');
  }
  return (body?.data?.reactions || {}) as Record<string, number>;
};

/** The viewer's own reactions in a group: { messageId: ["👍"] }. */
export const fetchUserReactionsForGroup = async (groupId: string) => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/group/${encodeURIComponent(groupId)}/user-reactions`,
      withApiCredentials({ headers: await getAuthHeaders() })
    );
    if (!response.ok) return {} as Record<string, string[]>;
    const body = await response.json().catch(() => ({}));
    return (body?.data || {}) as Record<string, string[]>;
  } catch {
    // Best-effort: without it the viewer's own chips just render unselected.
    return {} as Record<string, string[]>;
  }
};

/** The viewer's own reactions in a DM thread. */
export const fetchUserReactionsForThread = async (threadId: string) => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/dm/${encodeURIComponent(threadId)}/user-reactions`,
      withApiCredentials({ headers: await getAuthHeaders() })
    );
    if (!response.ok) return {} as Record<string, string[]>;
    const body = await response.json().catch(() => ({}));
    return (body?.data || {}) as Record<string, string[]>;
  } catch {
    return {} as Record<string, string[]>;
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

// Two pagination modes on one endpoint: `page`/`limit` offsets for the initial
// load, `before` (a cursor timestamp) for scroll-back. Passing both lets the
// server decide; callers use one or the other. A non-array `data` is coerced to
// [] so a degraded response cannot crash the message list.
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

// ========== COMMUNITY BOARDS ==========
// A board is the same `messages` table read roots-only (spec §3.3). Every
// helper degrades rather than throws where the 20260903120000 migration has
// not been applied yet, so a board screen still loads pre-migration (§11.15).

/** One page of board posts: roots only, newest first. */
export const fetchBoardPosts = async (
  groupId: string,
  options: { page?: number; limit?: number } = {}
) => {
  const params = new URLSearchParams({ rootsOnly: '1' });
  if (options.page !== undefined) params.set('page', String(options.page));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/group/${encodeURIComponent(groupId)}?${params.toString()}`,
    {
      method: 'GET',
      headers: await getAuthHeaders(),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const failure = new Error(
      (error as any).message || (error as any).error || 'Failed to fetch posts'
    );
    // The status is carried so the board can tell "you are not a member of
    // this board" (404 — the same answer `getGroupById` gives without an
    // active `group_members` row) from a network failure, and say the honest
    // thing for each.
    (failure as Error & { status?: number }).status = response.status;
    throw failure;
  }
  const result = await response.json();
  return Array.isArray(result?.data) ? result.data : [];
};

/**
 * The board's one pinned post. Its own endpoint because a pin can be older
 * than the loaded page. Resolves to null — never throws — when the pin columns
 * are absent, so the strip simply does not render pre-migration.
 */
export const fetchPinnedMessage = async (groupId: string) => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/group/${encodeURIComponent(groupId)}/pinned`,
      {
        method: 'GET',
        headers: await getAuthHeaders(),
      }
    );
    if (!response.ok) return null;
    const result = await response.json().catch(() => ({}));
    return (result?.data?.message ?? null) as any;
  } catch {
    return null;
  }
};

/**
 * Pin or unpin a board post. One pin per board, cleared server-side. Throws
 * with the server's message on 400 (not a board), 403 (not a moderator) and
 * 503 (`Pinning is not available yet`, pre-migration).
 */
export const setMessagePin = async (messageId: string, pinned: boolean) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/pin`,
    {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ pinned }),
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as any)?.error || (body as any)?.message || 'Could not update the pin');
  }
  return (body as any)?.data ?? null;
};

// --- Twitter-shaped board actions (spec §6, §7, §8) ---------------------------
// Favorite needs nothing here: it is a REACTION with the emoji pinned, so it
// rides `addMessageReaction` / `removeMessageReaction` above. Share needs
// nothing either — the link is minted in shared (`boardPostShareUrl`) and the
// members-only guard is the board fetch's existing 404.

/**
 * Bump a post back to the top of its own board. `:messageId` is the ORIGINAL's
 * id; the server writes the repost row and enforces every rule (same board,
 * not a repost, not a comment, not removed, the 24h self-cooldown, the hourly
 * cap, one per person). Throws with the server's own copy, which is the same
 * `COMMUNITY_BOARD_COPY` string mobile shows.
 */
export const createBoardRepost = async (messageId: string, quote?: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/repost`,
    withApiCredentials({
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ quote: quote ?? '' }),
    })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as any)?.error || (body as any)?.message || COMMUNITY_BOARD_COPY.repostUnavailable
    );
  }
  return (body as any)?.data ?? null;
};

/**
 * Undo. `:messageId` is the ORIGINAL's id here too, so the client never has to
 * hold the repost row's id — and the server deliberately ignores the 30-minute
 * mutation window, because a repost is a pointer, not speech.
 */
export const undoBoardRepost = async (messageId: string) => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/repost`,
    withApiCredentials({
      method: 'DELETE',
      headers: await getAuthHeaders(),
    })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as any)?.error || (body as any)?.message || COMMUNITY_BOARD_COPY.repostUnavailable
    );
  }
  return true;
};

/** A bookmark write, or `serverBacked: false` when the migration is not applied. */
export type BoardBookmarkWriteResult =
  | { serverBacked: true; bookmarked: boolean }
  | { serverBacked: false };

/**
 * Save / unsave a post for this account. A 503 means `message_bookmarks` is
 * not there yet: the caller hides the control and keeps the device-local save,
 * rather than showing an error for something the student cannot fix.
 */
export const setMessageBookmark = async (
  messageId: string,
  bookmarked: boolean
): Promise<BoardBookmarkWriteResult> => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/${encodeURIComponent(messageId)}/bookmark`,
    withApiCredentials({
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ bookmarked }),
    })
  );
  if (response.status === 503) return { serverBacked: false };
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as any)?.error || (body as any)?.message || 'Could not update that bookmark'
    );
  }
  return { serverBacked: true, bookmarked: (body as any)?.data?.bookmarked === true };
};

/**
 * The viewer's saved ids on ONE board, so the icon renders filled on first
 * paint. Same shape and lifecycle as `fetchUserReactionsForGroup`, and
 * `serverBacked: false` is what hides Bookmark and "Saved posts" entirely.
 */
export const fetchGroupBookmarks = async (
  groupId: string
): Promise<{ messageIds: string[]; serverBacked: boolean }> => {
  try {
    const response = await fetch(
      `${getApiRoot()}/api/v1/messages/group/${encodeURIComponent(groupId)}/bookmarks`,
      withApiCredentials({ headers: await getAuthHeaders() })
    );
    if (!response.ok) return { messageIds: [], serverBacked: false };
    const body = await response.json().catch(() => ({}));
    const data = (body as any)?.data ?? {};
    return {
      messageIds: Array.isArray(data.messageIds) ? data.messageIds.map(String) : [],
      serverBacked: data.serverBacked !== false,
    };
  } catch {
    // Offline is not "no such table": hide the control rather than claim the
    // board has none saved.
    return { messageIds: [], serverBacked: false };
  }
};

/** "Saved posts" — newest-saved-first, across every board, keyset on savedAt. */
export const fetchBookmarkedPosts = async (
  options: { limit?: number; before?: string } = {}
): Promise<{ entries: BoardBookmarkEntry[]; nextCursor: string | null; serverBacked: boolean }> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.before) params.set('before', options.before);
  const query = params.toString();
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/bookmarks${query ? `?${query}` : ''}`,
    withApiCredentials({ headers: await getAuthHeaders() })
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as any)?.error || (body as any)?.message || 'Could not load your saved posts'
    );
  }
  const data = (body as any)?.data ?? {};
  return {
    entries: Array.isArray(data.entries) ? (data.entries as BoardBookmarkEntry[]) : [],
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
    serverBacked: data.serverBacked !== false,
  };
};

/**
 * The one-time migration of this device's local saves. Idempotent server-side,
 * so the caller may keep its local key until it has seen a 2xx.
 */
export const importMessageBookmarks = async (
  messageIds: string[]
): Promise<{ imported: number; serverBacked: boolean }> => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/messages/bookmarks/import`,
    withApiCredentials({
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ messageIds }),
    })
  );
  if (response.status === 503) return { imported: 0, serverBacked: false };
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as any)?.error || (body as any)?.message || COMMUNITY_BOARD_COPY.bookmarksUnavailable
    );
  }
  return { imported: Number((body as any)?.data?.imported ?? 0), serverBacked: true };
};

// ─── Message read/edit/remove (shared by group chat and DMs) ────────────────
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

// One transport for the four edit/remove wrappers below; the only difference
// between group and DM is the path prefix (`dm-message/`). A DELETE sends no
// body at all — the server treats a removal as a tombstone (`isRemoved`), so
// the returned payload still carries the row, not null.
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

// ─── Q&A voting / moderation flags on messages ──────────────────────────────
// Swallows every failure into {}: the viewer's own vote highlight is cosmetic,
// and the counts on each message row are authoritative anyway.
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
      const error = await response.json().catch(() => ({}));
      // This endpoint answers `{ success: false, error }` like the rest of the
      // API. Reading only `message` swallowed every reason it gives — including
      // the 409 that refuses VERIFIED below the peer-vote threshold, which is
      // the one sentence the person needs to see.
      const failure = new Error(
        error.error || error.message || 'Failed to update question status'
      ) as Error & { status?: number; peerUpvotes?: number };
      failure.status = response.status;
      if (typeof error?.data?.peerUpvotes === 'number') {
        failure.peerUpvotes = error.data.peerUpvotes;
      }
      throw failure;
    }

    const result = await response.json();
    console.log('Question status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating question status:', error);
    throw error;
  }
};

// ══════════════════════════════════════════════════════════════════════════
// FLASHCARDS — decks, cards, collaborators, FSRS reviews, import/export
// Both list endpoints are page-capped by the server and are paged to
// exhaustion here (DECK_API_PAGE_SIZE / FLASHCARD_API_PAGE_SIZE); a single
// request silently returns only the first page.
// ══════════════════════════════════════════════════════════════════════════
// --- Flashcard Functions ---

export const createDeck = async (deckData: { name: string; description?: string; isShared?: boolean; courseId?: string | null; topicId?: string | null }, userId: string) => {
  console.log('Creating deck:', deckData.name, 'isShared:', deckData.isShared);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/decks`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: deckData.name,
        description: deckData.description,
        isShared: deckData.isShared,
        ...(deckData.courseId !== undefined ? { courseId: deckData.courseId } : {}),
        ...(deckData.topicId !== undefined ? { topicId: deckData.topicId } : {}),
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
  courseId: d.courseId !== undefined ? d.courseId : (d.course_id ?? null),
  studySetId: d.studySetId !== undefined ? d.studySetId : (d.study_set_id ?? null),
  // Absent until 20260826120000 is applied — null then, not undefined, so the
  // deck simply reads as "no topic" rather than breaking the picker.
  topicId: d.topicId !== undefined ? d.topicId : (d.topic_id ?? null),
  studyCount: d.studyCount ?? d.study_count ?? 0,
  // Without this the cover a user just set vanished on the next load: the API
  // projects `coverPath` (or omits it on a database where the cover migration
  // is not applied yet), but this mapper dropped it, so every deck row in the
  // store read as "no cover" and the menu always offered "Add cover".
  coverPath: d.coverPath !== undefined ? d.coverPath : (d.cover_path ?? null),
});

/** Map raw API deck rows to client Deck objects, dropping malformed rows. */
export const mapDecksFromApi = (rows: any[]): Deck[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d && d.id)
    .map(mapDeckFromApi);

export const fetchDecks = async (userId: string, options?: { includeShared?: boolean; courseId?: string | null; topicId?: string | null }) => {
  const includeShared = options?.includeShared ?? false;
  const courseId = options?.courseId || undefined;
  // Only alongside a real course: a topic without one is meaningless, and the
  // server rejects the pair (mirrors services/library.ts).
  const topicId = courseId && courseId !== UNFILED_COURSE_ID ? options?.topicId || undefined : undefined;
  console.log('Fetching decks for user:', userId, 'includeShared:', includeShared, 'courseId:', courseId, 'topicId:', topicId);
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
      if (courseId) params.set('courseId', courseId);
      if (topicId) params.set('topicId', topicId);
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
      // Short page = last page. A full page whose rows are all duplicates would
      // loop, but the server keyset guarantees strictly-increasing offsets.
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

export const updateDeck = async (deckId: string, updates: { name?: string; description?: string; isShared?: boolean; courseId?: string | null; topicId?: string | null }) => {
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

// ─── User directory (member pickers, @-mention autocomplete) ────────────────
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

// Short-circuits below 2 characters (measured AFTER stripping leading @), so
// typing "@" alone never fires a request. The result is re-shaped into
// snake_case because callers here predate the camelCase API rows.
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

// ─── Deck sharing (collaborators) ───────────────────────────────────────────
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

// Defaults to limit=1000 so most callers get a whole deck in one request, but
// the server still caps a page at FLASHCARD_API_PAGE_SIZE (100) — asking for
// 1000 does NOT guarantee 1000 rows. Use `fetchAllFlashcards` when
// completeness matters. 401/403 returns [] rather than throwing, matching
// `fetchDecks`, so a cold-boot race renders empty instead of erroring.
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

// The only path that also runs `mapFlashcardsFromApi` (shared), which is what
// normalises SRS/FSRS fields — rows straight out of `fetchFlashcards` are raw.
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

// Grades one card. `expectedVersion` is optimistic concurrency (CAS): omit it
// and the server applies the grade unconditionally. Queued OFFLINE replays
// omit it on purpose — every review of the same card queued offline carries the
// same pre-sync version, so sending it made the second and later replays
// self-409.
// Two error shapes come out of here, both load-bearing for the sync queue:
//  - 409 / code 'version_conflict' → `err.code = 'version_conflict'` with the
//    server's current row on `err.current`, so the caller can re-base.
//  - anything else → `err.status` carries the HTTP status so the queue can tell
//    a permanent rejection (404 card gone) from a transient one.
export const reviewFlashcard = async (
  flashcardId: string,
  rating: 'again' | 'hard' | 'good' | 'easy',
  expectedVersion?: number,
  /** Offline replay: when the grade was really given, so the server's learning
   *  event carries the original time rather than the sync time. */
  options?: { reviewedAt?: string }
) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/flashcards/${flashcardId}/review`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        rating,
        ...(expectedVersion != null ? { expectedVersion } : {}),
        ...(options?.reviewedAt ? { reviewedAt: options.reviewedAt } : {}),
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

// ══════════════════════════════════════════════════════════════════════════
// TESTS — sessions, submitted results, and the history/detail reads
// A "session" is the attempt (config + questions + answers); a "result" is the
// scored row created from it. The offline replay in services/offlineTestSync.ts
// calls createTestSession then createTestResult in that order, and classifies
// failures by the `status` (and `code`) PROPERTY on the thrown error, falling
// back to the `status: NNN` message format below (G4 · H14).
// ══════════════════════════════════════════════════════════════════════════
// --- Test Sessions and Results ---

export const createTestSession = async (sessionData: {
  config: any;
  questions: any[];
  user_answers: Record<string, any>;
  start_time: string;
  end_time?: string;
  is_offline: boolean;
  /**
   * The set this session was taken in. Optional here because it is usually
   * already on `config`; `withStudySetId` reads either, so no call site has to
   * remember which. Without it the set room's Test tab lists nothing.
   */
  studySetId?: string | null;
}, userId: string) => {
  console.log('Creating test session for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/tests`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(withStudySetId({
        ...sessionData,
        userId
      }, sessionData)),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message =
        (typeof errorBody.message === 'string' && errorBody.message) ||
        (typeof errorBody.error === 'string' && errorBody.error) ||
        `HTTP error! status: ${response.status}`;
      // FIXED (G4 · H14): the STATUS and CODE travel on the error, not only in
      // the message. The offline replay classifies transient (keep and retry)
      // against permanent (set aside) by status; when the server sends a
      // normal JSON error body the message carries no status, so every
      // rejection read as transient and ONE bad row wedged the whole FIFO
      // queue forever. The message still gets `(status: NNN)` appended for the
      // older classifiers that scrape it (see `ApiClientError`).
      const err = new Error(
        /status:\s*\d/.test(message) ? message : `${message} (status: ${response.status})`
      ) as Error & { status?: number; code?: string };
      err.status = response.status;
      if (typeof errorBody.code === 'string' && errorBody.code) err.code = errorBody.code;
      throw err;
    }

    const result = await response.json();
    console.log('Test session created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating test session:', error);
    throw error;
  }
};

// Submit, not a generic PATCH: only the answers are sent (as an ARRAY — the
// `user_answers` map is flattened with Object.values) and `end_time` in the
// signature is ignored, the server stamps it.
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
  /** Narrow to one course: a uuid, or the literal `'null'` for unfiled sessions. */
  courseId?: string | null;
  /** Narrow one level further, to a topic inside `courseId` (`'null'` = no topic). */
  topicId?: string | null;
};

// `lean` list rows arrive without a `session`, and are passed through untouched.
// When a session IS present, `normalizeTestResultSession` (shared) is what
// repairs question/answer shapes — including message-backed questions, whose
// real kind lives in `questionType`, not `type`.
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
  // The Library's course/topic filter (Phase 1 · A/B). A topic only means
  // something inside a real course, so "unfiled" never carries one.
  if (options?.courseId) params.set('courseId', options.courseId);
  if (options?.courseId && options.courseId !== UNFILED_COURSE_ID && options?.topicId) {
    params.set('topicId', options.topicId);
  }

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

// Two behaviours behind one name:
//  - `options.page` set → exactly that page (delegates once).
//  - `options.page` absent → walks EVERY page (default 500/page, hard stop at
//    100 pages = 50k rows) so all-time charts see full history. The loop also
//    stops on an empty page, so a server that reports hasMore forever cannot
//    spin more than `maxPages` times.
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
// Accepts BOTH response shapes this endpoint family returns: an already-nested
// `{ session }` result row (passed to `mapTestResultItem`), or a flat camelCase
// session row, which is re-wrapped into the result shape here. In the flat case
// score / totalQuestions / correctAnswersCount are RECOMPUTED from the answers
// whenever the row does not carry them, so an un-scored session still renders.
// Returns null on every failure — callers treat null as "not available", so a
// genuine error and a missing session are indistinguishable to them.
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

// ══════════════════════════════════════════════════════════════════════════
// USER QUESTION STATS — per-question attempt tallies behind the analytics
// Both calls retry ONCE through `apiFetch` (which applies the sessionHandler
// policy: refresh, replay once, never on a 403) and then
// give up; the read degrades to {} while the write rethrows.
// ══════════════════════════════════════════════════════════════════════════
// --- User Question Stats ---

export const upsertUserQuestionStat = async (userId: string, questionId: string, stat: {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
}) => {
  // Embedded personal-test questions (`q1`…) have no server row; the validator
  // 400s on a non-UUID id, so the write is skipped rather than logged as an error.
  if (!isQuestionStatEligible(questionId)) {
    return null;
  }
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

  try {
    // REFACTORED (R1): the hand-rolled "call, classify, call again" pair is now
    // one `apiFetch`. Identical semantics: one retry after a refresh, never on
    // a 403, and the same untouched Response for the error branch below.
    const response = await apiFetch(
      `${getApiRoot()}/api/v1/user-stats`,
      { method: 'POST', headers: await getAuthHeaders(), body },
      { timeoutMs: null }
    );

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

// Three failure classes, three different answers:
//  - 401/403 (after one refresh retry) → {} and a debug log; auth is simply
//    not ready yet during boot.
//  - network error / TypeError 'Failed to fetch' → {} silently (API down).
//  - any other non-ok → throws.
// REFACTORED (R1): the row-mapping block used to be duplicated verbatim in the
// retry branch — two copies that could (and did) drift, so a changed field
// silently went missing only on the retry path. `apiFetch` replays the request
// internally, so there is now ONE response and ONE mapping block.
export const fetchUserQuestionStats = async (userId: string) => {
  try {
    if (!(await hasValidSession())) {
      return {} as UserQuestionStats;
    }

    const response = await apiFetch(
      `${getApiRoot()}/api/v1/user-stats/${encodeURIComponent(userId)}`,
      { method: 'GET', headers: await getAuthHeaders() },
      { timeoutMs: null }
    );

    if (response.status === 401 || response.status === 403) {
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
    // Returning null here discards the testResults just mapped above, on
    // purpose: the caller then re-fetches BOTH halves individually rather than
    // rendering analytics against stats that silently read as "no attempts".
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

// ══════════════════════════════════════════════════════════════════════════
// PROFILES & ACCOUNT LIFECYCLE
// Everything that WRITES an account uses `getRequiredAuthHeaders`, which
// throws 'Authentication required' rather than sending an anonymous request;
// the reads use plain `getAuthHeaders` and degrade instead.
// Lifecycle: deactivate (soft, grace period) → reactivate, or
// delete (scheduled) / delete-immediate (password-confirmed, irreversible).
// ══════════════════════════════════════════════════════════════════════════
// --- Profile/User Functions ---

// 404 is expected — it is how "profile not created yet" reads during signup —
// so it is rethrown WITHOUT the console.error the other statuses get. 403 is
// tapped for ACCOUNT_SUSPENDED before rethrowing.
export const fetchUserProfile = async (userId: string) => {
  console.log('Fetching user profile for user:', userId);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      // The boot-time profile fetch is the first call a suspended account
      // makes; record ACCOUNT_SUSPENDED here so the notice shows immediately.
      if (response.status === 403) {
        const { noteSuspendedResponse } = await import('./accountSuspension');
        await noteSuspendedResponse(response);
      }
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

// Returns false rather than throwing, so a caller cannot tell a refusal from a
// network failure. `deleteUserAccountImmediate` (below) is the password-gated
// hard delete and DOES throw with the server's message.
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

// Drives the "your account is paused / will be deleted on X" banner. Always
// resolves — null means "unknown", which the banner reads as "nothing to show",
// so a failure here never falsely tells a user their account is fine.
export const fetchAccountLifecycle = async (userId: string): Promise<{
  status: 'active' | 'deactivated';
  deactivatedAt?: string | null;
  deletionScheduledAt?: string | null;
  graceDaysRemaining?: number | null;
  gracePeriodDays: number;
} | null> => {
  try {
    // REFACTORED (R1): one `apiFetch` in place of the call/classify/call pair.
    const response = await apiFetch(
      `${getApiRoot()}/api/v1/users/${userId}/lifecycle`,
      { headers: await getAuthHeaders() },
      { timeoutMs: null }
    );
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

// Deliberately UNAUTHENTICATED (no getAuthHeaders) — it runs during signup
// before a session exists. Only an explicit `available === true` counts as
// free, so an unexpected body shape blocks the name rather than allowing a
// collision.
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

export const updateUsername = async (userId: string, username: string, firstName?: string, lastName?: string): Promise<any> => {
  try {
    const headers = await getRequiredAuthHeaders();
    const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/username`, {
      method: 'PUT',
      headers,
      // Names are optional on the profile-setup step; omit blanks so the
      // server keeps whatever is already on file instead of writing ''.
      body: JSON.stringify({
        username,
        ...(firstName && firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName && lastName.trim() ? { lastName: lastName.trim() } : {}),
      }),
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

// ══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — the bell feed. The list read is capped at 100 server-side
// and has no pagination here; older notifications are simply not reachable.
// ══════════════════════════════════════════════════════════════════════════
// --- Notification Functions ---

export const createNotification = async (notificationData: {
  user_id: string;
  message: string;
  link?: string;
  /** Feature family for colour-coding (e.g. 'test_result'); defaults to info. */
  type?: string;
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
        type: notificationData.type || 'info'
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

// Same three-way degradation as `fetchUserQuestionStats`: no session or
// 401/403 → [], network error → [] silently, any other non-ok → throws.
// `userId` is unused in the request — the server scopes by the bearer token.
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

// ─── Group admin (delete/update, promote/demote, remove member, leave) ──────
// Physically separated from the GROUPS block above; same `/api/v1/groups` API.
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

// The first four fields are passed straight through (an `undefined` is dropped
// by JSON.stringify anyway); the three NULLABLE ones use conditional spread so
// an explicit null — "unfile this group" — is transmitted instead of skipped.
export const updateGroup = async (groupId: string, updates: { name?: string; description?: string; isArchived?: boolean; avatarUrl?: string; courseId?: string | null; visibility?: 'private' | 'community' | 'public'; communityId?: string | null }) => {
  console.log('Updating group:', groupId, 'updates:', updates);
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/groups/${groupId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        isArchived: updates.isArchived,
        avatarUrl: updates.avatarUrl,
        ...(updates.courseId !== undefined ? { courseId: updates.courseId } : {}),
        ...(updates.visibility !== undefined ? { visibility: updates.visibility } : {}),
        ...(updates.communityId !== undefined ? { communityId: updates.communityId } : {}),
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

// ══════════════════════════════════════════════════════════════════════════
// MARKETPLACE — the largest group in this file. Sub-blocks, in order:
//   listings CRUD · access gate · reviews/reports · seller dashboard ·
//   favorites · inquiries · offers · orders & payments · seller tooling
//   (analytics, coupons, campaigns, payout profile) · cart & addresses ·
//   saved searches · custom categories · similar listings · question banks ·
//   study packs · purchases · creators · shops.
// Conventions across the block:
//  - Reads normalise through `normalizeListingRecord` / `normalizeInquiryRecord`
//    / `normalizeOfferRecord` / `normalizeFavoriteRecord` (utils/storageUrl),
//    which rewrite storage paths into usable URLs.
//  - Browse reads go through `marketplaceListingsCache` and can throw
//    `RateLimitError` (429) — the ONLY error class the browse grid special-cases.
//  - Errors from write endpoints carry `.status` so forms can render a 400/403
//    inline; 403 bodies are also sniffed for ACCOUNT_SUSPENDED.
// ══════════════════════════════════════════════════════════════════════════
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
  /** Academic course (marketplace_listings.course_id). */
  courseId?: string | null;
  /** Topic within `courseId` (marketplace_listings.topic_id); rejected if it belongs elsewhere. */
  topicId?: string | null;
  /**
   * Rights attestation (RIGHTS_ATTESTATION_TEXT). The API requires it (400
   * ATTESTATION_REQUIRED_MESSAGE) when isAcademicListing({ listingKind, category }).
   */
  attestation?: boolean;
  [key: string]: unknown;
}) => {
  console.log('Creating marketplace listing:', listingData.title);
  try {
    // FIXED (F3): the route is behind
    // `idempotencyMiddleware({ operation: 'marketplace_create_listing' })` but
    // the web never sent a key, so a retry after an uncertain failure published
    // the listing twice. One key per create INTENT (this seller's title, price
    // and category), rotated once the create resolves.
    return await withPurchaseIntent(
      `create_listing:${listingData.category}:${listingData.title}:${listingData.price ?? ''}`,
      async (idempotencyKey) => {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings`, {
      method: 'POST',
      headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
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
      if (response.status === 403) {
        const { noteSuspendedBody } = await import('./accountSuspension');
        noteSuspendedBody(response.status, result);
      }
      // Keep the status so the form can show 400s (missing attestation,
      // blocked wording) inline instead of a generic toast.
      const error = new Error(result.error || result.message || 'Failed to create listing') as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    console.log('Listing created:', result.data);
    return result.data;
      }
    );
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
  /** Filters on category_specific_fields.condition (new/like-new/good/fair). */
  condition?: string;
  /** Keep only listings rated at least this (1–5 whole stars). */
  minRating?: number;
  /** Fine-grained campus listing type (taxonomy leaf id). */
  taxonomyNodeId?: string;
  /** When set with taxonomyNodeId, also include listings that have no node id. */
  includeUnclassified?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** `compact` returns card-shaped rows (first image only) for the browse grid. */
  responseProfile?: 'compact' | 'full';
} = {}): Promise<{ data: any[]; pagination: { page: number; limit: number; total: number } }> => {
  // The cache is keyed on the WHOLE filter object, so any new filter field
  // automatically gets its own entry — but a filter that is not serialised into
  // `queryParams` below would share a key with a different result set.
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
      // API error bodies are { success:false, error:'<seller-facing copy>' } (e.g. 403
      // when moderation has locked the listing); surface that copy to the seller.
      const error = await response.json().catch(() => ({}));
      if (response.status === 403) {
        const { noteSuspendedBody } = await import('./accountSuspension');
        noteSuspendedBody(response.status, error);
      }
      const requestError = new Error(error.error || error.message || 'Failed to update listing') as Error & {
        status?: number;
      };
      requestError.status = response.status;
      throw requestError;
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

/**
 * Mark / unmark a review as helpful. The control only renders when the API
 * returned a helpfulCount for the review, so pre-migration 503s are
 * unreachable from the UI.
 */
export const setMarketplaceReviewHelpful = async (
  listingId: string,
  reviewId: string,
  helpful: boolean
): Promise<{ helpfulCount: number; viewerMarkedHelpful: boolean }> => {
  const response = await fetch(
    `${getApiRoot()}/api/v1/marketplace/listings/${listingId}/reviews/${reviewId}/helpful`,
    {
      method: helpful ? 'POST' : 'DELETE',
      headers: await getAuthHeaders(),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Failed to update review reaction');
  }
  return payload.data;
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
// Note the split policy in this block: the two READS below swallow every
// failure ([] / null), so the dashboard shows "no listings / no stats" when the
// API is actually down, while `updateListingStatus` and the favorites reads
// propagate. Do not "make it consistent" without checking each caller's empty
// state first.

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
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Failed to update status');
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

// Any failure (including 401 while auth is still restoring) reads as "not
// favorited", so the heart renders empty. Safe because the write endpoints are
// idempotent — a mis-rendered empty heart cannot create a duplicate favorite.
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

// ─── Offers / negotiation ───────────────────────────────────────────────────
// Writes (`createOffer`, `respondToOffer`) throw; every READ in this block
// degrades to [] on any non-ok, so a failed load is indistinguishable from
// "no offers yet". Only `fetchOffers` normalises its rows
// (`normalizeOfferRecord`) — the listing-scoped reads return raw API shapes.
// --- Marketplace Offers ---

// FIXED (F3): an offer is a commitment to pay, and the route is behind
// `idempotencyMiddleware({ operation: 'marketplace_create_offer' })`, but the
// web sent no key — so a retry after an uncertain failure posted a second offer
// on the same listing. The key is now owned by the intent (this listing, this
// amount) and rotated only once the offer lands.
export const createOffer = async (listingId: string, amount: number, message?: string) => {
  try {
    return await withPurchaseIntent(
      `create_offer:${listingId}:${amount}`,
      async (idempotencyKey) => {
        const response = await fetch(`${getApiRoot()}/api/v1/marketplace/offers`, {
          method: 'POST',
          headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ listingId, amount, message }),
        });
        if (!response.ok) {
          throw await marketplaceMoneyError(response, 'Failed to create offer');
        }
        const result = await response.json();
        return result.data;
      }
    );
  } catch (error) {
    console.error('Error creating offer:', error);
    throw error;
  }
};

// FIXED (F3): `accept` is the money action — the route runs
// `withIdempotency(..., 'marketplace_offer_accept', ...)` around an atomic
// accept-and-create-order RPC plus a Paystack session. The web sent no key, so
// the server fell back to a key derived from the offer id alone; that is stable
// enough, but a retry after a FAILED attempt then hits the 10-minute failure
// marker with no way to present a fresh key. Owning the key here means a retry
// of the same intent replays, and a genuinely new attempt after a terminal
// rejection gets a new key.
export const respondToOffer = async (offerId: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
  try {
    return await withPurchaseIntent(
      `offer_respond:${offerId}:${action}:${counterAmount ?? ''}`,
      async (idempotencyKey) => {
        const response = await fetch(`${getApiRoot()}/api/v1/marketplace/offers/${offerId}`, {
          method: 'PUT',
          headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ action, counterAmount }),
        });
        if (!response.ok) {
          throw await marketplaceMoneyError(response, 'Failed to respond to offer');
        }
        const result = await response.json();
        return result.data;
      }
    );
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

// ─── Orders (the money path) ────────────────────────────────────────────────
// `updateMarketplaceOrder` is a single PATCH whose `action` selects the state
// transition (ship / confirm / open_dispute / …); the extra fields are only
// read for the action they belong to and are ignored otherwise, so sending a
// stale field cannot move the order sideways. Order reads throw rather than
// degrade — an empty orders list must never be shown because a fetch failed.
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
  payload: {
    action: string;
    meetingLocation?: string;
    sellerNote?: string;
    fulfillmentMode?: string;
    /** Phase 3 N — carried by `open_dispute` only; ignored for other actions. */
    disputeReason?: string;
    disputeCategory?: string;
    trackingNumber?: string;
    trackingUrl?: string;
  }
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

// ─── Seller tooling: analytics, buyer segments, coupons, preferences ────────
// All reads here return null/[] on failure (dashboards render an empty card);
// all writes throw with the server's `error` copy.
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
  shippingEnabled?: boolean;
  shippingFeeNaira?: number | null;
  shippingFreeOverNaira?: number | null;
  shipsFromCampusId?: string | null;
  shipsFromCity?: string | null;
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

// FIXED (F3): a boost is a paid promotion, keyed by the intent (this listing,
// this duration) so a retry cannot buy two boosts.
export const boostMarketplaceListing = async (listingId: string, durationHours: number = 72) =>
  withPurchaseIntent(`boost:${listingId}:${durationHours}`, async (idempotencyKey) => {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/boost`, {
      method: 'POST',
      headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ durationHours }),
    });

    if (!response.ok) {
      throw await marketplaceMoneyError(response, 'Failed to boost listing');
    }

    const result = await response.json();
    return result.data;
  });

// ─── Checkout & Paystack ────────────────────────────────────────────────────
// Amounts cross the wire in KOBO (integer minor units), never naira floats.
// The service fee is folded INTO the price the buyer sees: `totalChargeKobo` is
// what Paystack charges and `itemAmountKobo` + `serviceFeeKobo` decompose it.
// Buy-now may return an order alone (offline/manual payment) or an order plus
// `authorizationUrl`/`accessCode` to hand to Paystack — the caller must handle
// both. `verifyMarketplacePayment` is the client-side confirmation after
// redirect; the webhook is still the authority on whether the order is paid.
/**
 * FIXED (F3): the error a money call throws now carries the HTTP status.
 *
 * Every checkout helper below used to throw `new Error(err.error)`, a bare
 * Error with nothing on it, so a caller could not tell a 409 ("the same
 * idempotency key is still in flight — retry it") from a 400 the buyer has to
 * fix. `withPurchaseIntent` reads `status` to decide whether the purchase
 * intent is over (rotate the key) or still live (keep it), so the status has to
 * survive the throw.
 */
async function marketplaceMoneyError(response: Response, fallback: string): Promise<Error> {
  const body: any = await response.json().catch(() => ({}));
  // Route-level rejections send `{success:false, error:'<sentence>'}`; the
  // global handler sends `{error:'Error', message:'<sentence>'}` — prefer the
  // sentence over the class label either way.
  const label = typeof body?.error === 'string' ? body.error : '';
  const generic = label === '' || label === 'Error' || label === 'ApiError';
  const err = new Error(
    (generic ? body?.message : label) || label || body?.message || fallback
  ) as Error & { status?: number };
  err.status = response.status;
  return err;
}

export const buyMarketplaceListingNow = async (
  listingId: string,
  couponCode?: string,
  quantity?: number
) =>
  // FIXED (F3): one idempotency key per purchase INTENT (this listing, this
  // quantity, this coupon), reused on every retry and rotated only once the
  // purchase resolves. The web used to send no `Idempotency-Key` at all, so a
  // buyer who retried after a timeout relied entirely on the server's fallback
  // key — a content hash bucketed into 5-minute windows, which stops deduping
  // the moment the retry crosses a bucket boundary.
  withPurchaseIntent(
    `buy_now:${listingId}:${quantity ?? 1}:${couponCode ?? ''}`,
    async (idempotencyKey) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/listings/${listingId}/buy-now`, {
    method: 'POST',
    headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      ...(couponCode ? { couponCode } : {}),
      ...(quantity != null && quantity > 0 ? { quantity } : {}),
    }),
  });

  if (!response.ok) {
    throw await marketplaceMoneyError(response, 'Failed to complete purchase');
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
    }
  );

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

// Re-opens checkout on an order that already exists (buyer abandoned the
// Paystack page). Mints a FRESH reference rather than reusing the old one.
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

// ─── Seller payout profile (the gate on going live with real money) ─────────
// Bank details are sent to the BFF, which resolves them with Paystack; nothing
// here persists an account number locally.
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

// ─── Cart & delivery addresses ──────────────────────────────────────────────
// The cart is SERVER-side state (not localStorage), so it follows the account
// across devices; every mutation returns the whole recomputed cart, which is
// why callers replace their state from the response rather than patching it.
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

// One cart can span several sellers, so checkout takes a fulfillment choice
// PER SELLER (`groups`) and produces one order per seller.
export const checkoutMarketplaceCart = async (input?: {
  groups?: Array<{ sellerId: string; fulfillmentMode: string; meetingLocation?: string }>;
  addressId?: string | null;
}) =>
  // FIXED (F3): one idempotency key per checkout INTENT. The cart itself lives
  // only on the server, so the intent is named by the choices this checkout
  // makes over it (per-seller fulfillment + delivery address); the key survives
  // a timeout or a reload mid-payment and is rotated only once the checkout
  // resolves, so a retry cannot produce a second set of orders.
  withPurchaseIntent(
    `cart_checkout:${input?.addressId ?? ''}:${(input?.groups ?? [])
      .map((g) => `${g.sellerId}:${g.fulfillmentMode}`)
      .sort()
      .join(',')}`,
    async (idempotencyKey) => {
      const response = await fetch(`${getApiRoot()}/api/v1/marketplace/cart/checkout`, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input || {}),
      });
      if (!response.ok) {
        throw await marketplaceMoneyError(response, 'Checkout failed');
      }
      const result = await response.json();
      return result.data;
    }
  );

export const fetchMarketplaceAddresses = async () => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/addresses`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load addresses');
  const result = await response.json();
  return result.data;
};

export const createMarketplaceAddress = async (data: Record<string, unknown>) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/addresses`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save address');
  }
  const result = await response.json();
  return result.data;
};

export const updateMarketplaceAddress = async (addressId: string, data: Record<string, unknown>) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/addresses/${addressId}`, {
    method: 'PATCH',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update address');
  }
  const result = await response.json();
  return result.data;
};

export const deleteMarketplaceAddress = async (addressId: string) => {
  const response = await fetch(`${getApiRoot()}/api/v1/marketplace/addresses/${addressId}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete address');
  }
  const result = await response.json();
  return result.data;
};

export const fetchSellerFulfillment = async (sellerId: string) => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/sellers/${sellerId}/fulfillment`,
    { method: 'GET', headers: await getAuthHeaders() },
    5000,
  );
  if (!response.ok) return null;
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

// Both calls in this block are deliberately UNAUTHENTICATED (no getAuthHeaders)
// — they run in the public browse/compose flows before sign-in. Both also
// swallow every failure into an empty result, so the pickers just show fewer
// options rather than erroring.
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

export const classifyMarketplaceListing = async (input: {
  title: string;
  description?: string;
  department?: 'academic' | 'student-life';
}) => {
  try {
    const response = await fetch(`${getApiRoot()}/api/v1/marketplace/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { suggestions: [] };
    const result = await response.json();
    return result.data || { suggestions: [] };
  } catch {
    return { suggestions: [] };
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

// ─── Question banks (digital study product #1) ──────────────────────────────
// A bank is a listing plus a versioned question snapshot. Lifecycle: publish →
// (buy or free download) → `downloadQuestionBank` materialises an OFFLINE
// BUNDLE on the device → attempts post scores (queued in
// services/pendingQuestionBankScores.ts when offline) → the seller republishes
// with `updateQuestionBankContent`, bumping `version`, which is what
// `fetchQuestionBankUpdates` compares against each local bundle.
// Publish/update REQUIRE `attestation: true` (rights) — the API 400s without
// it, and both surface `.status` so the form can show that inline.
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
  /** Academic course written on both the listing and the bank. */
  courseId?: string | null;
  /** Topic within `courseId`; carried by the listing only, not the bank. */
  topicId?: string | null;
  content: { config?: Record<string, unknown>; questions: unknown[] };
  /** Rights attestation (RIGHTS_ATTESTATION_TEXT) — required; the API answers 400 without it. */
  attestation: true;
  /** "This pack was AI-assisted" toggle. */
  aiAssisted?: boolean;
  /** Up to 20 short references (≤ 200 chars each). */
  sourcesCited?: string[];
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
    const error = new Error((err as any).error || (err as any).message || 'Failed to publish question bank') as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
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
    // FIXED (F1) [E3 L4]: stamp the HTTP status on the error. The pending-score
    // queue counts an attempt ONLY when a status is present, so a transport
    // failure (offline, DNS, timeout — which throws before this point and
    // carries no status) can no longer burn the retry budget and delete a
    // legitimate score unsent. Same contract offlineFlashcardSync reads.
    // The message carries the status too, because the queue's classifier reads
    // it out of the message ("… status: 400"); the property is the same contract
    // offlineFlashcardSync reads. Both, so either classifier works.
    const base = (err as any).error || 'Failed to record score';
    const error = new Error(`${base} (status: ${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
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

/**
 * Seller republish: replace the published snapshot, bumping the version.
 * Re-requires the rights attestation (400 without it); aiAssisted /
 * sourcesCited refresh the bank's provenance when sent.
 */
export const updateQuestionBankContent = async (
  listingId: string,
  content: { config?: Record<string, unknown>; questions: unknown[] },
  provenance: { attestation: true; aiAssisted?: boolean; sourcesCited?: string[] }
): Promise<{ version: number; questionCount: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/question-banks/${encodeURIComponent(listingId)}/update-content`,
    {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ content, ...provenance }),
    },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error((err as any).error || (err as any).message || 'Failed to update question bank') as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
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

// ── Study packs (digital study products: guide + summaries + flashcards + questions) ──
// Same lifecycle as question banks above, but delivery is MULTI-PART: a
// download materialises up to three local artefacts (bundle / deck / note), so
// `deliveredRefs` on a purchase can hold any combination and each field is
// independently nullable.

export interface MarketplaceStudyPackMeta {
  counts: StudyPackCounts;
  version: number;
  owned: boolean;
}

/** Publish a study pack as a digital listing (from inline content or an AI draft). */
export const publishStudyPack = async (input: {
  title: string;
  description?: string;
  price?: number | null;
  campusId: string;
  location?: string;
  courseId?: string | null;
  /** Topic within `courseId`; carried by the listing only, not the pack. */
  topicId?: string | null;
  content?: StudyPackContentInput;
  draftId?: string | null;
  /** Rights attestation (RIGHTS_ATTESTATION_TEXT) — required; 400 without it. */
  attestation: true;
  aiAssisted?: boolean;
  sourcesCited?: string[];
}): Promise<{ listing: any; pack: { listingId: string; packId: string; version: number } }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/study-packs/publish`,
    { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify(input) },
    20000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(
      (err as any).error || (err as any).message || 'Failed to publish study pack'
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()).data;
};

/** Free packs and owner re-downloads: grants the entitlement and delivers the pack. */
export const downloadStudyPack = async (
  listingId: string
): Promise<{ bundleId: string | null; deckId: string | null; noteId: string | null; version: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/study-pack/download`,
    { method: 'POST', headers: await getAuthHeaders() },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to download study pack');
  }
  return (await response.json()).data;
};

export interface StudyPackPreview {
  title: string;
  counts: StudyPackCounts;
  toc: Array<{ title: string; anchor: string }>;
  summaryPreview: string | null;
  flashcardFronts: string[];
  questions: Array<{
    id?: string;
    questionStem?: string;
    text?: string;
    questionType?: string;
    options?: Array<{ id: string; text: string }>;
    imageUrl?: string;
    tags?: string[];
  }>;
  owned: boolean;
  isSeller: boolean;
  version: number;
}

/** Public sample of a study pack — question answers are stripped server-side. */
export const fetchStudyPackPreview = async (listingId: string): Promise<StudyPackPreview> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${encodeURIComponent(listingId)}/study-pack/preview`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load preview');
  }
  return (await response.json()).data;
};

/** Seller republish: replace the snapshot, bumping the version. Re-requires attestation. */
export const updateStudyPackContent = async (
  listingId: string,
  content: StudyPackContentInput,
  provenance: { attestation: true; aiAssisted?: boolean; sourcesCited?: string[] }
): Promise<{ version: number; counts: StudyPackCounts }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/study-packs/${encodeURIComponent(listingId)}/update-content`,
    { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ content, ...provenance }) },
    20000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(
      (err as any).error || (err as any).message || 'Failed to update study pack'
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()).data;
};

export interface MyStudyPack {
  listingId: string;
  version: number;
  counts: StudyPackCounts;
  courseId: string | null;
  title: string;
  price: number | null;
  status: string;
}

/** Study packs the current user has published. */
export const fetchMyStudyPacks = async (): Promise<MyStudyPack[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/study-packs/mine`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load your study packs');
  }
  return (await response.json()).data;
};

/** Re-materialize purchased packs (deck/note/bundle) on this device. */
export const restoreStudyPacks = async (): Promise<{ restored: number }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/study-packs/restore`,
    { method: 'POST', headers: await getAuthHeaders() },
    20000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to restore study packs');
  }
  return (await response.json()).data;
};

export interface MarketplacePurchase {
  listingId: string;
  kind: 'question_bank' | 'study_pack';
  title: string;
  sellerId: string;
  sellerName: string;
  version: number;
  versionAtDownload: number;
  updateAvailable: boolean;
  deliveredRefs: { bundleId?: string; deckId?: string; noteId?: string; version?: number };
  courseId: string | null;
  purchasedAt: string;
}

/** Unified buyer library across question banks + study packs. */
export const fetchMarketplacePurchases = async (): Promise<MarketplacePurchase[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/purchases`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load your purchases');
  }
  return (await response.json()).data;
};

// ── Creators (Phase 2 · J) ──
// Follow/unfollow are the SAME path with POST/DELETE and live under
// `/api/v1/users/:id/follow`, not `/creators` — the creator profile is just a
// marketplace-shaped read of a user.

export interface CreatorProfile {
  id: string;
  username: string | null;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  institution: string | null;
  programme: string | null;
  studyLevel: number | null;
  stats: {
    activePacks: number;
    learnersHelped: number;
    avgRating: number;
    reviewCount: number;
    followerCount: number;
    followingCount?: number;
  };
  isFollowing: boolean;
  isVerified: boolean;
  trustLevel: string;
  packs: Array<{
    id: string;
    title: string;
    price: number | null;
    images: string[];
    listingKind: string;
    courseId: string | null;
  }>;
}

export const fetchCreatorProfile = async (userId: string): Promise<CreatorProfile> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/creators/${encodeURIComponent(userId)}`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Creator not found');
  }
  return (await response.json()).data;
};

export const followCreator = async (userId: string): Promise<void> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/follow`,
    { method: 'POST', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Could not follow this creator');
  }
};

export const unfollowCreator = async (userId: string): Promise<void> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/follow`,
    { method: 'DELETE', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Could not unfollow this creator');
  }
};

// ── Phase 3 — Network (communities, discovery, feed, presence, mastery) ──
//
// Web hand-writes its own fetch layer (mobile uses the shared api client), so
// these mirror packages/shared/src/api/endpoints.ts by hand. Types come from
// @lantern/shared/network so the two clients cannot drift.

/** Sentinel for "the body parsed as neither JSON nor a quotable error". */
const NON_JSON_BODY = Symbol('non-json-body');

/**
 * Read the `{ success, data }` envelope from a response we already know is 2xx.
 *
 * A 200 is not a promise of JSON. When an /api/v1 path does not match, the Pages
 * SPA fallback answers with index.html — status 200, body `<!DOCTYPE html>` —
 * and a bare `.json()` throws `SyntaxError: Unexpected token '<'`, which tells
 * the user nothing and points the stack trace at the parser rather than the
 * request that lied. `/__lantern_api` behaves the same way in production by
 * design, so this is reachable without anything being broken.
 */
async function readEnvelope<T>(response: Response, fallbackError: string): Promise<T> {
  const payload = await response.json().catch(() => NON_JSON_BODY);
  if (payload === NON_JSON_BODY) throw new Error(fallbackError);
  return (payload as { data?: T }).data as T;
}

/**
 * `networkGet` for endpoints that return a list.
 *
 * The plain `as T` cast is a promise the network cannot keep: an envelope
 * without `data`, a shape change, or an HTML body all hand the caller something
 * that is not an array. The failure then surfaces far away as
 * `X.filter is not a function` inside a useMemo, blaming the component instead
 * of the request. An empty list renders as "nothing here", which is honest when
 * the server told us nothing.
 */
const networkGetList = async <T>(
  path: string,
  timeout?: number,
  fallbackError?: string
): Promise<T[]> => {
  const data = await networkGet<T[]>(path, timeout, fallbackError);
  return Array.isArray(data) ? data : [];
};

const networkGet = async <T>(path: string, timeout = 10000, fallbackError = 'Request failed'): Promise<T> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1${path}`,
    // withApiCredentials adds `credentials: 'include'` in cookie-auth mode.
    // Without it these reads depend on getAuthHeaders() having a bearer token,
    // which is not guaranteed on a cold start.
    withApiCredentials({ method: 'GET', headers: await getAuthHeaders() }),
    timeout
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || fallbackError);
  }
  return readEnvelope<T>(response, fallbackError);
};

const networkWrite = async <T>(
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
  fallbackError = 'Request failed'
): Promise<T> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1${path}`,
    // MUST go through withApiCredentials: it supplies the
    // `X-Requested-With: LanternStudy` header that csrfProtectionMiddleware
    // demands on every mutating cookie-authenticated request. Without it these
    // writes 403 with CSRF_VALIDATION_FAILED whenever getAuthHeaders() has no
    // bearer token to fall back on.
    withApiCredentials({
      method,
      headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || fallbackError);
  }
  return readEnvelope<T>(response, fallbackError);
};

const networkQuery = (params: Record<string, string | number | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
};

export const fetchMyCommunities = () => networkGetList<MyCommunity>('/communities');

export const fetchCommunity = (slug: string) =>
  networkGet<CommunityDetail>(`/communities/${encodeURIComponent(slug)}`, 10000, 'Community not found');

/**
 * The community as a server: lounge, text channels, open rooms, viewer role,
 * member + online counts. Uncached upstream so unread is fresh.
 */
export const fetchCommunityChannels = (communityId: string) =>
  networkGet<CommunityChannels>(
    `/communities/${encodeURIComponent(communityId)}/channels`,
    10000,
    'Could not load this community'
  );

/** Members-only roster, one page at a time; keep calling while `nextCursor` is set. */
export const fetchCommunityMembers = (
  communityId: string,
  opts: { limit?: number; cursor?: string } = {}
) =>
  networkGet<CommunityMembersPage>(
    `/communities/${encodeURIComponent(communityId)}/members${networkQuery({
      limit: opts.limit,
      cursor: opts.cursor,
    })}`,
    10000,
    'Could not load members'
  );

export const joinCommunity = (communityId: string) =>
  networkWrite<{ joined: true }>(
    `/communities/${encodeURIComponent(communityId)}/join`,
    'POST',
    undefined,
    'Could not join this community'
  );

/**
 * Open (mint on first use) a community's lounge — the persistent chat every
 * member shares — and join the caller. Members only; 503 until the
 * community-lounges migration is applied.
 */
export const openCommunityLounge = (communityId: string) =>
  networkWrite<{ groupId: string; name: string; created: boolean }>(
    `/communities/${encodeURIComponent(communityId)}/lounge`,
    'POST',
    undefined,
    'Could not open the community chat'
  );

export const leaveCommunity = (communityId: string) =>
  networkWrite<{ left: true }>(
    `/communities/${encodeURIComponent(communityId)}/join`,
    'DELETE',
    undefined,
    'Could not leave this community'
  );

export const createCommunity = (body: {
  name: string;
  description?: string;
  tags?: string[];
  kind?: string;
  visibility?: 'public' | 'private';
  startsAt?: string | null;
  endsAt?: string | null;
  location?: string | null;
}) =>
  networkWrite<Community>(
    '/communities',
    'POST',
    body,
    'Could not create this community'
  );

export const joinDiscoverableGroup = (groupId: string) =>
  networkWrite<{ joined: true }>(
    `/discover/groups/${encodeURIComponent(groupId)}/join`,
    'POST',
    undefined,
    'Could not join this group'
  );

export const discoverCommunities = (params: {
  q?: string;
  kind?: string;
  institutionId?: string;
  courseId?: string;
  limit?: number;
} = {}) => networkGetList<Community>(`/discover/communities${networkQuery(params)}`);

/** Discoverable groups — NOT /groups, which is memberships-only and cached per user. */
export const discoverGroups = (params: {
  q?: string;
  communityId?: string;
  courseId?: string;
  limit?: number;
} = {}) => networkGetList<DiscoverGroup>(`/discover/groups${networkQuery(params)}`);

export const discoverPeople = (params: {
  q?: string;
  institutionId?: string;
  courseId?: string;
  limit?: number;
} = {}) => networkGetList<DiscoverPerson>(`/discover/people${networkQuery(params)}`);

export const fetchStudyPresence = (params: { courseId?: string; institutionId?: string } = {}) =>
  networkGet<PresenceSnapshot>(`/discover/presence${networkQuery(params)}`);

/** Study intent rides the EXISTING heartbeat rather than a second timer. */
export const sendStudyHeartbeat = (body: { context?: string; courseId?: string; topic?: string }) =>
  networkWrite<unknown>('/users/presence/heartbeat', 'POST', body, 'Could not update presence');

export const clearStudyPresence = () =>
  networkWrite<unknown>('/users/presence/study', 'DELETE', undefined, 'Could not clear presence');

export const fetchFeed = (params: { limit?: number; before?: string } = {}) =>
  networkGet<FeedPage>(`/feed${networkQuery(params)}`);

export const fetchLearningConnections = () =>
  networkGet<LearningConnectionSummary>('/feed/connections');

export const fetchMasteryGraph = (params: { courseId?: string; limit?: number } = {}) =>
  networkGet<MasteryGraph>(`/mastery${networkQuery(params)}`, 15000);

export const refreshMasteryGraph = () =>
  networkWrite<{ topics: TopicMastery[] }>('/mastery/refresh', 'POST', undefined, 'Could not refresh');

export const fetchExamReadiness = () => networkGetList<ExamReadiness>('/mastery/exam-readiness');

/**
 * Syllabus-aware readiness for every active course (no exam date needed).
 * With a courseId, the response also carries the cohort-floored class signal.
 */
export const fetchCourseReadiness = (courseId?: string) =>
  networkGet<{ courses: CourseReadiness[]; classSignal?: CourseClassSignal }>(
    `/mastery/readiness${networkQuery(courseId ? { courseId } : {})}`,
    15000
  );

/**
 * Tags on this student's own work for a course that no outline topic covers.
 * Drives the outline editor's "Unmatched tags" one-tap add.
 */
export const fetchUnmatchedTags = (courseId: string) =>
  networkGet<import('@lantern/shared/learning/readinessCard').UnmatchedTagsResponse>(
    `/mastery/unmatched-tags${networkQuery({ courseId })}`,
    10000
  );

// ── Phase 4 Q — referrals ──

export const fetchReferralSummary = () => networkGet<ReferralSummary>('/referrals');

// ── Phase 4 R — public campus pages ──

export interface CampusSummary {
  slug: string;
  name: string;
  city: string;
  state: string;
  kind: string;
  counts: { students: number; courses: number; communities: number; listings: number; creators: number };
  courses: Array<{ code: string; title: string }>;
  programmes: string[];
}

/**
 * PUBLIC: this must work for a logged-out visitor, so it deliberately does NOT
 * send auth headers — getAuthHeaders() would stall on a cold guest session.
 */
export const fetchCampusSummary = async (
  slug: string,
  programme?: string
): Promise<CampusSummary> => {
  const qs = programme ? `?programme=${encodeURIComponent(programme)}` : '';
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/campuses/${encodeURIComponent(slug)}/summary${qs}`,
    { method: 'GET' },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Campus not found');
  }
  return (await response.json()).data as CampusSummary;
};

export const fetchAmbassadors = (institutionId: string, limit?: number) =>
  networkGet<Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>>(
    `/referrals/ambassadors${networkQuery({ institutionId, limit })}`
  );

export const fetchGamificationLeaderboard = (params: {
  page?: number;
  limit?: number;
  ambassador?: boolean;
  institutionId?: string;
} = {}) =>
  networkGet<Array<{ rank: number; user: { id: string; name: string; avatarUrl?: string; points: number } }>>(
    `/gamification/leaderboard${networkQuery({
      page: params.page,
      limit: params.limit,
      ambassador: params.ambassador ? '1' : undefined,
      institutionId: params.institutionId,
    })}`
  );

export const joinOrCreateStudyRoom = (input: {
  courseId?: string | null;
  communityId?: string | null;
  topicId?: string | null;
  topic?: string | null;
  title?: string | null;
}) =>
  networkWrite<import('@lantern/shared/network').StudyRoomDetail>(
    '/study-rooms/join-or-create',
    'POST',
    input,
    'Could not open a study room'
  );

/**
 * The hub's Room tab: open rooms, newest first, the viewer's own first.
 * Inside a community pass `communityId` (+ `courseId` for a course community,
 * so hub-started course rooms show under it too).
 */
export const listStudyRooms = (params: { communityId?: string; courseId?: string } = {}) =>
  networkGet<import('@lantern/shared/network').StudyRoomListItem[]>(
    `/study-rooms${networkQuery(params)}`
  );

export const fetchStudyRoom = (roomId: string) =>
  networkGet<import('@lantern/shared/network').StudyRoomDetail>(
    `/study-rooms/${encodeURIComponent(roomId)}`
  );

export const joinStudyRoom = (roomId: string) =>
  networkWrite<import('@lantern/shared/network').StudyRoomDetail>(
    `/study-rooms/${encodeURIComponent(roomId)}/join`,
    'POST',
    {},
    'Could not join the room'
  );

export const leaveStudyRoom = (roomId: string) =>
  networkWrite<{ left: true }>(
    `/study-rooms/${encodeURIComponent(roomId)}/leave`,
    'POST',
    {},
    'Could not leave the room'
  );

export interface SellerPaymentRow {
  orderId: string;
  listingId: string | null;
  title: string;
  itemAmountKobo: number;
  platformFeeKobo: number;
  sellerPayoutKobo: number;
  status: string;
  paidAt: string | null;
  payoutAt: string | null;
}

/** The seller's earnings ledger (Phase 2 · I). */
export const fetchSellerPayments = async (page = 1): Promise<SellerPaymentRow[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/seller/payments?page=${page}`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load your earnings');
  }
  return (await response.json()).data;
};

// ── AI Study Product Factory (Phase 2 · H) ──

export type { StudyPackDraft, StudyPackDraftSummary } from '@lantern/shared/marketplace';

/** Charge 5 AI credits and start generating a study-pack draft (async). */
export const createStudyPackDraft = async (input: {
  noteIds?: string[];
  folderId?: string | null;
  courseId?: string | null;
  title?: string;
}): Promise<{ draftId: string; jobId?: string; status?: string; draft?: StudyPackDraft }> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/study-pack/draft`,
    { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify(input) },
    30000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error((err as any).error || 'Could not start the study pack') as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return response.json();
};

/** The caller's study-pack drafts (excludes published). */
export const fetchStudyPackDrafts = async (): Promise<StudyPackDraftSummary[]> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/study-pack/drafts`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to load your drafts');
  }
  return (await response.json()).data;
};

/** One draft with its full generated content. */
export const fetchStudyPackDraft = async (draftId: string): Promise<StudyPackDraft> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/study-pack/drafts/${encodeURIComponent(draftId)}`,
    { method: 'GET', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Draft not found');
  }
  return (await response.json()).data;
};

export const deleteStudyPackDraft = async (draftId: string): Promise<void> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/study-pack/drafts/${encodeURIComponent(draftId)}`,
    { method: 'DELETE', headers: await getAuthHeaders() },
    10000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Could not delete draft');
  }
};

export const fetchSemesterPackProposals = async (
  academicYear?: string,
): Promise<import('@lantern/shared/marketplace').SemesterPackProposalResponse> => {
  const qs = academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : '';
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/study-pack/semester-proposals${qs}`,
    { method: 'GET', headers: await getAuthHeaders() },
    15000
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || 'Could not load semester proposals');
  }
  return (await response.json()).data;
};

/** Auth'd AI health — includes handwritingOcr on/off for the photo-notes banner. */
export const fetchAiHealth = async (): Promise<{
  handwritingOcr?: 'on' | 'off';
  gemini?: 'on' | 'off';
}> => {
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/ai/health`,
    { method: 'GET', headers: await getAuthHeaders() },
    8000
  );
  if (!response.ok) return {};
  return response.json();
};

export const fetchMarketplaceListingFull = async (
  listingId: string
): Promise<{
  listing: any;
  isFavorited: boolean;
  similarListings: any[];
  canReview?: boolean;
  questionBank?: MarketplaceQuestionBankMeta | null;
  studyPack?: MarketplaceStudyPackMeta | null;
}> => {
  // FIXED (F9): this used to accept a `userId` and build `const params =
  // userId ? `` : ''` — both branches empty, so no query string was ever
  // appended and the argument did nothing. The viewer-scoped fields
  // (isFavorited, canReview, owned) are derived from the bearer token, and the
  // parameter only made it look as though a caller could ask on someone
  // else's behalf. It is gone rather than wired.
  const response = await fetchWithTimeout(
    `${getApiRoot()}/api/v1/marketplace/listings/${listingId}/full`,
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
// Purely device-local: a list of listing ids, most-recent-first, re-inserted on
// each view (so a repeat view moves to the front) and capped at 20. The key
// starts with `lantern_`, so `shouldClearClientStorageKeyOnLogout` wipes it on
// sign-out — it does not leak across accounts on a shared browser. The ids are
// hydrated into listings by `fetchMarketplaceListingsByIds`, which drops any
// that are gone.

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

// ══════════════════════════════════════════════════════════════════════════
// IMAGE UPLOADS — all go to the BFF as base64 JSON, never multipart, because
// the server re-validates the MAGIC BYTES (SEC-07) before storing.
// ══════════════════════════════════════════════════════════════════════════

// Compress (best-effort; falls back to the original on any canvas failure),
// read as a data: URL, and derive the content type from the data URL's own
// prefix rather than `File.type` — see the block comment below. Rejects
// anything outside JPEG/PNG/GIF/WebP with a user-readable message, so callers
// do not have to pre-validate.
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
export const uploadMarketplaceImage = async (
  file: File,
  listingId?: string,
  options?: { purpose?: 'shop' | 'listing' },
) => {
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
    body: JSON.stringify({
      ...payload,
      listingId,
      purpose: options?.purpose,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to upload marketplace image');
  }
  return json.data as { url: string; path: string; storageUrl?: string };
};

// The ONE storage call in this file that bypasses the BFF: it deletes straight
// from the `marketplace-images` bucket through supabase-js, so whether the
// caller is allowed to remove that object is decided by STORAGE RLS, not by
// any server-side ownership check.
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

// ══════════════════════════════════════════════════════════════════════════
// DIRECT MESSAGES — threads, sending, blocking, message requests, unread
// counts, mutes, and the audio/image attachment uploads.
// Reads here THROW rather than degrade (`AUTH_NOT_READY` / `AUTH_UNAUTHORIZED`
// are sentinel messages callers match on): an empty array would be rendered as
// "no conversations" and would overwrite a loaded inbox.
// ══════════════════════════════════════════════════════════════════════════
// --- Direct Message Functions ---

// Retries ONCE, after 400ms, and only when the error message matches the
// transient set (auth-bootstrap, network, 502/503/504). Any other failure —
// including a 4xx — propagates on the first attempt.
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

// Mirrors `sendMessage` for groups: the body is serialised once so the
// `retryUncertainDelivery` replay is byte-identical and `clientMessageId` makes
// it idempotent. Only 408/5xx (via `createDeliveryResponseError`) are retried.
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
    // Same normalisation as `sendMessage`: local id stays `temp-<uuid>`, the wire
    // value is the bare UUID. The DM route does not run the strict-UUID validator
    // today, so this is consistency (and future-proofing) rather than a live 400.
    recipientId,
    clientMessageId: clientMessageId ? toWireClientMessageId(clientMessageId) : clientMessageId,
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

export const listBlockedUsers = async (userId: string): Promise<{ blockedUserIds: string[] }> => {
  const response = await fetch(`${getApiRoot()}/api/v1/users/${userId}/blocks`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load blocked users');
  }
  const result = await response.json();
  return { blockedUserIds: (result?.data?.blockedUserIds ?? []) as string[] };
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

// ─── Unread counts and read receipts (groups + DMs) ─────────────────────────
// The four reads/writes below NEVER throw: a badge is cosmetic, and a thrown
// error during boot would take out the whole chat list.
// `previousLastReadAt` is returned so a caller can UNDO an accidental mark-read
// (the "New messages" divider re-anchors to it); it is read from either the
// envelope root or `data`, because the two endpoints disagree on shape.
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

// Web image upload — parity with mobile, which could already post chat images.
// The API image endpoint keys on groupId only (no threadId param).
export const uploadChatImage = async (payload: {
  fileName: string;
  base64Data: string;
  contentType: string;
  groupId?: string;
}): Promise<{ url: string; path: string }> => {
  const response = await fetch(`${getApiRoot()}/api/v1/messages/upload-image`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.message || 'Failed to upload image');
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

// ─── Mutes (per DM thread and per group; identical shape, different paths) ───
// Every one of the six wrappers resolves to null on failure. null is NOT
// "unmuted" — callers must render an unknown mute state rather than showing the
// bell as on. `parseMuteResponse` also returns null for a 2xx whose body lacks
// a boolean `muted`, so a malformed response cannot be mistaken for a verdict.
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
// UNION by bundleId, local wins on a tie — bundle content is immutable once
// downloaded, so there is nothing to reconcile field-by-field. Local-only
// bundles are uploaded SERIALLY inside the loop (one await per bundle), and a
// failed upload is swallowed by `saveOfflineBundle` returning false, so the
// merge still succeeds and that bundle is retried on the next sync. Any throw
// returns the local list unchanged — never an empty one.
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
// Optimistic concurrency with a module-level version cache
// (`lastKnownSettingsVersion`) plus a serialising promise chain
// (`settingsSaveQueue`). Both must be reset on logout via
// `clearLastKnownSettingsVersion`, or the next account's first PUT carries the
// previous user's version.
// Writes are PATCHES by category: the server deep-merges what is sent onto the
// latest row, which is what makes the 409 retry safe — the same patch is
// replayed against the newer version rather than re-sending a whole stale blob.

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

    // REFACTORED (R1): one `apiFetch` in place of the call/classify/call pair.
    // The 401/403/404 → null branch below already covered "retry did not help",
    // so dropping the early `return null` changes nothing.
    const response = await apiFetch(
      `${getApiRoot()}/api/v1/users/${encodeURIComponent(userId)}/settings`,
      { method: 'GET', headers: await getAuthHeaders() },
      { timeoutMs: null }
    );

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

// Up to 3 attempts. A 409 re-reads the current version — preferably from the
// conflict body, otherwise with a follow-up GET — and replays the SAME patch.
// Exhausting the attempts returns `{ ok: false, conflict: true }` plus the
// server's settings, so the caller can rebase rather than silently lose the
// edit; every other failure returns a bare `{ ok: false }`.
// The whole run is appended to `settingsSaveQueue` (with `run` as BOTH
// handlers, so a rejected predecessor does not stall the chain) — concurrent
// theme / checklist / tips saves would otherwise all race the same version.
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
// SEPARATE from USER SETTINGS above — a different table and endpoint
// (`/api/v1/preferences`), with no CAS version and last-write-wins. `theme` is
// a column; everything else rides the `preferences` JSONB. `themePreference`
// ('system' included) is the canonical appearance choice and is validated
// against the three literals on read, so a junk value degrades to undefined.
// The write SPREADS the existing `preferences` object, so a caller that passes
// a stale copy silently reverts other keys.

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
      // FIXED (SW) [Sentry WEB-1R]: this logged the parsed BODY, which Sentry
      // renders as "[object Object]" — five events that said nothing at all.
      // Log a sentence with the status in it, and treat the expected statuses
      // (expiry, suspension, rate limit) as warnings so they do not file.
      const body = await response.json().catch(() => ({} as Record<string, unknown>));
      const detail =
        (typeof body?.error === 'string' && body.error) ||
        (typeof body?.message === 'string' && body.message) ||
        response.statusText ||
        'request failed';
      const line = `Error saving user preferences: HTTP ${response.status} ${detail}`;
      if ([401, 403, 429].includes(response.status)) console.warn(line);
      else console.error(line);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      'Error saving user preferences:',
      error instanceof Error ? error.message : String(error)
    );
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
    if (!userId) return false;
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      // A direct PostgREST upsert here used to race the boot auth handshake and
      // fail silently under RLS. Go through the service-role API instead, which
      // authenticates by bearer token and is the same path every other budget
      // write uses.
      console.warn('No valid session available for saving user budget.');
      return false;
    }
    const response = await fetch(
      `${getApiRoot()}/api/v1/users/${userId}/budget`,
      withApiCredentials({
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyLimit: budget.monthlyLimit,
          monthYear: budget.monthYear,
        }),
      })
    );
    if (!response.ok) {
      console.error('Error saving user budget: HTTP', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error saving user budget:', error);
    return false;
  }
};

const BUDGET_TRANSACTIONS_KEY = 'budget:GET:/transactions';

export const fetchBudgetTransactions = async (userId: string): Promise<TransactionData[]> => {
  try {
    if (!userId) return [];
    // FIXED (SW) [Sentry WEB-1H, 78 events in one afternoon]: the Budget screen
    // refetches on open, on focus and on visibilitychange, so once the
    // authenticated limiter said 429 every one of those asked again and logged
    // again. Sit out the window the server named; the store keeps showing what
    // it already has, which is the same thing an empty [] would have produced.
    const { dedupe, isRateLimited, noteRateLimited } = await import('./requestThrottle');
    if (isRateLimited(BUDGET_TRANSACTIONS_KEY)) return [];

    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      console.warn('No valid session available for fetching budget transactions.');
      return [];
    }

    // The route is self-scoped server-side; no client-side user matching needed.
    // Deduped: a focus event and a visibilitychange arrive together and used to
    // open two identical requests.
    // The BODY is read inside dedupe, not outside it: a Response can only be
    // consumed once, so sharing the Response itself would break the second
    // caller with "body already read".
    const response = await dedupe(BUDGET_TRANSACTIONS_KEY, async () => {
      const res = await fetch(
        `${getApiRoot()}/api/v1/budget/transactions`,
        withApiCredentials({ headers })
      );
      return {
        ok: res.ok,
        status: res.status,
        retryAfter: res.headers?.get?.('Retry-After') ?? null,
        payload: res.ok ? await res.json().catch(() => ({})) : {},
      };
    });
    if (!response.ok) {
      // 401/403 = session expiry / suspension, 429 = the server asking us to
      // slow down; all three are handled elsewhere, and a console.error here
      // files a Sentry issue per attempt for an expected condition.
      if (response.status === 401 || response.status === 403) {
        console.warn('Skipping budget transactions fetch: HTTP', response.status);
      } else if (response.status === 429) {
        const wait = noteRateLimited(BUDGET_TRANSACTIONS_KEY, response.retryAfter);
        console.warn(
          `[Budget] transactions rate limited; backing off ${Math.ceil(wait / 1000)}s`
        );
      } else {
        console.error('Error fetching budget transactions: HTTP', response.status);
      }
      return [];
    }
    const body = response.payload as { data?: unknown };
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

// Same union-by-id merge as `syncOfflineBundles`, local-wins, then sorted
// newest-first. It only UPLOADS local-only rows — a transaction deleted on
// another device is re-created here, because absence from the server list is
// indistinguishable from "not synced yet".
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
// The only block in this file that still talks to PostgREST DIRECTLY
// (`supabase.from('pending_sync_results')`), so access is governed by RLS, not
// by the BFF — which is also why `savePendingSyncResult` passes an explicit
// `user_id` and the reads filter on it client-side.
// The upsert's `onConflict: 'id'` targets the PRIMARY KEY (a plain unique
// index), so it is safe; the same option against a PARTIAL unique index is what
// used to 42P10 on message reactions.
// Every function here swallows its error and returns false/[]; the durable
// queue the replay actually reads is the local one in
// `useTestStore.pendingSyncResults` (see services/offlineTestSync.ts), so a
// failure to mirror it server-side does not lose the result.

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

// ══════════════════════════════════════════════════════════════════════════
// EMAIL VERIFICATION & PASSWORD RESET
// The only calls in this file that go to Supabase GoTrue directly rather than
// the BFF, because these flows mint and consume Supabase's own email tokens.
// They still ride `supabaseFetch`, so a cookie-mode refresh triggered here is
// intercepted like any other. All four rethrow the raw supabase-js error.
// The redirect origin is taken from `window.location.origin` at call time, so
// whatever host the user is on must be in the project's allowed redirect list.
// `updateAuthPassword` changes the password but does NOT invalidate other
// sessions — callers pair it with `revokeOtherSessions()` above.
// ══════════════════════════════════════════════════════════════════════════
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
