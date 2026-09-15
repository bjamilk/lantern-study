/**
 * Web Auth Store
 * Manages authentication state for the web application
 * Uses Zustand for state management
 *
 * Exports: `useAuthStore` — the whole session lifecycle for the web app.
 *  - Boot: `getInitialAuthState()` runs ONCE at module load, before React, and
 *    fast-boots `currentUser` from localStorage only when a cached token AND a
 *    persisted profile agree (`shouldRestorePersistedAuthUser`). `isAuthLoading`
 *    always starts true — the fast boot is a paint, not a verdict.
 *  - Verify: `checkAuthState()` re-resolves the session against the server and
 *    is the only action that may clear `currentUser` on its own.
 *  - Enter: `login()` / `signup()`; leave: `logout()`.
 *  - Mutate: `refreshUser()`, `updateUser()` (optimistic + revert),
 *    `incrementStats()` (fire-and-forget PATCH).
 *
 * Touches: services/supabase (`supabase.auth`, `setCachedAuthToken`,
 *   `apiLogoutSession`, `bootstrapAuthFromStorage`, `readPersistedAuthUser`,
 *   the `/users/:id` profile fetch/create/update), services/authCookieSession
 *   (BFF login / session / refresh / exchange), services/sentry (`setSentryUser`),
 *   services/sessionHandler (`resetSessionExpiredGuard`), and the zustand
 *   `persist` key `auth-storage-v2` in localStorage.
 *
 * Gotchas:
 *  - Cookie-auth mode (production): the session is HttpOnly-cookie backed, and
 *    the in-memory supabase session's `refresh_token` is the literal placeholder
 *    `'cookie-managed'`. gotrue-js will happily POST that placeholder to
 *    /auth/v1/token and get a 400, which it reports as SIGNED_OUT. The
 *    `global.fetch` interceptor on the supabase client (commit d922d44) is what
 *    keeps that from happening: it reroutes those POSTs to the BFF refresh,
 *    turns a genuine 401/403 into a 400 (real revoke → real sign-out) and a
 *    transient failure into `TypeError('Failed to fetch')` so gotrue KEEPS the
 *    session. Therefore: a transient network failure is NOT a sign-out. Nothing
 *    in this file may clear `currentUser` because a request failed — note that
 *    `refreshUser` and `checkAuthState` both only log on catch.
 *  - `logout()` clears exactly three things here: the Sentry user, `currentUser`
 *    and `isAuthenticated` (plus `isAuthLoading`). Everything else — the token
 *    cache, the cookie, the server session — is `apiLogoutSession()`'s job, and
 *    every OTHER store's per-user data must be purged by its own `reset()` /
 *    `ensureOwner()` from the sign-out effect. This store cannot do it for them.
 *  - Rule for the whole app: module-level caches and persisted slices MUST be
 *    cleared on a user switch, not just on sign-out. An effect whose deps
 *    include a state array holds the PRE-purge array for the rest of that
 *    commit, so a stale closure writes the previous user's data straight back
 *    after the purge. Effects that run on user switch must read
 *    `useSomeStore.getState()` inside the effect body.
 *  - The `onAuthStateChange` listener deliberately does not live here — see the
 *    note at the bottom of the file.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserStats } from '../types';
import {
  supabase,
  setCachedAuthToken,
  apiLogoutSession,
  bootstrapAuthFromStorage,
  readPersistedAuthUser,
  fetchUserProfile as apiFetchUserProfile,
  createUserProfile as apiCreateUserProfile,
  updateUserProfile as apiUpdateUserProfile,
} from '../services/supabase';
import {
  isCookieAuthEnabled,
  loginViaCookieBff,
  fetchCookieSession,
  refreshCookieSession,
  exchangeCookieSession,
} from '../services/authCookieSession';
import { resolvePlatformAdmin } from '../utils/platformAdmin';
import { setSentryUser } from '../services/sentry';
import { normalizeTestPresets } from '@lantern/shared/utils/apiMappers';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { formatSupabaseClientAuthError } from '@lantern/shared';
import { shouldRestorePersistedAuthUser } from '../utils/authBootstrap';
import { resetSessionExpiredGuard } from '../services/sessionHandler';
import { resolveDisplayName } from '../utils/displayIdentity';

/**
 * Display name from Supabase auth metadata, for the brief window before the
 * server profile lands. The account email is deliberately NOT a name source:
 * an account with no metadata name falls back to the neutral placeholder, never
 * to the email's local part ("nimaj22"), which an avatar would otherwise turn
 * into invented initials ("NI") on the person's own cards.
 */
function displayNameFromMeta(
  meta: Record<string, unknown> | undefined,
  _email?: string | undefined,
  fallback = 'User',
): string {
  const raw = meta?.name;
  return resolveDisplayName([typeof raw === 'string' ? raw : null], fallback);
}

// Synchronous first paint, computed at module load. Reads the token bootstrap
// and the persisted profile out of localStorage and only trusts the pair when
// they agree. `isAuthLoading` stays true in BOTH branches: this is a guess that
// checkAuthState() confirms or overturns, never the final answer.
function getInitialAuthState(): {
  currentUser: User | null;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
} {
  if (typeof window === 'undefined') {
    return { currentUser: null, isAuthenticated: false, isAuthLoading: true };
  }
  const boot = bootstrapAuthFromStorage();
  const persisted = readPersistedAuthUser();
  // Never treat a persisted profile as logged-in without a matching local token.
  // Otherwise / redirects to dashboard and auth bootstrap 401s pollute guest landing.
  if (shouldRestorePersistedAuthUser(boot, persisted)) {
    return {
      currentUser: persisted as unknown as User,
      isAuthenticated: true,
      isAuthLoading: true,
    };
  }
  return { currentUser: null, isAuthenticated: false, isAuthLoading: true };
}

const initialAuthState = getInitialAuthState();

// Initial user stats
const initialUserStats: UserStats = {
  testsCompleted: 0,
  questionsCreated: 0,
  groupsCreated: 0,
  highScoreTests: 0,
  perfectScoreTests: 0,
  gamesWon: 0,
  listingsCreated: 0,
  listingsSold: 0,
  fiveStarReviews: 0,
  offersMade: 0,
  campusAmbassador: 0,
};

interface AuthState {
  // State
  currentUser: User | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  isPasswordRecovery: boolean;
  error: string | null;
  /**
   * The last `checkAuthState()` could not reach a verdict — it timed out or
   * threw — as opposed to answering "no session". Not persisted: it describes
   * this boot only. Read by App's auth gate so a failed restore is not
   * rendered as a plain sign-out (F9).
   */
  sessionRestoreFailed: boolean;
  
  // Actions
  setCurrentUser: (user: User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setPasswordRecovery: (active: boolean) => void;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * `needsEmailConfirmation` means the account was created but Supabase
   * returned no session (confirmation required): there is no signed-in user,
   * so the caller must send the student to their inbox, not into the app.
   */
  signup: (
    email: string,
    password: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  incrementStats: (stat: keyof UserStats, amount?: number) => void;
  checkAuthState: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial State — sync fast-boot from localStorage when token + user are cached
      currentUser: initialAuthState.currentUser,
      isAuthLoading: initialAuthState.isAuthLoading,
      isAuthenticated: initialAuthState.isAuthenticated,
      sessionRestoreFailed: false,
      isPasswordRecovery:
        typeof window !== 'undefined' &&
        (window.location.pathname === '/reset-password' ||
          window.location.hash.includes('type=recovery')),
      error: null,

      // Set current user
      // The single write path for the identity. It mirrors into Sentry so a
      // crash report is attributed to whoever is signed in NOW; passing null
      // here is what detaches the previous user from later events.
      setCurrentUser: (user) => {
        setSentryUser(user ? { id: user.id, email: user.email } : null);
        set({
          currentUser: user,
          isAuthenticated: !!user,
        });
      },

      // Set loading state
      setAuthLoading: (loading) => {
        set({ isAuthLoading: loading });
      },

      setPasswordRecovery: (active) => {
        set({ isPasswordRecovery: active });
      },

      // Login
      // Password sign-in, in two shapes decided by `isCookieAuthEnabled()`:
      //  - cookie mode (prod): the BFF sets the HttpOnly cookie and returns a
      //    session; the tokens are ALSO pushed into supabase-js so realtime and
      //    RLS reads have a memory session. That memory session's refresh_token
      //    is the 'cookie-managed' placeholder — see the header.
      //  - direct mode (local/dev): supabase.auth.signInWithPassword.
      // Either way an auth failure sets `error` and returns, and nothing below
      // runs; the caller reads the returned { success, error }.
      login: async (email, password) => {
        set({ isAuthLoading: true, error: null });
        try {
          let authUser: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> };
          let session: { access_token?: string; refresh_token?: string } | null = null;

          if (isCookieAuthEnabled()) {
            const cookieResult = await loginViaCookieBff(email, password);
            if (cookieResult.error || !cookieResult.session?.user) {
              const errMsg = formatSupabaseClientAuthError(cookieResult.error || 'Login failed');
              set({ isAuthLoading: false, error: errMsg });
              return { success: false, error: errMsg };
            }
            session = cookieResult.session;
            authUser = cookieResult.session.user;
            if (session.access_token && session.refresh_token) {
              await supabase.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              });
            }
          } else {
            const { data, error } = await supabase.auth.signInWithPassword({
              email,
              password,
            });

            if (error) {
              const errMsg = formatSupabaseClientAuthError(error.message);
              set({ isAuthLoading: false, error: errMsg });
              return { success: false, error: errMsg };
            }

            if (!data.user) {
              set({ isAuthLoading: false });
              return { success: false, error: 'Login failed' };
            }

            authUser = data.user;
            session = data.session;
          }

          if (authUser) {
            // Fetch or create user profile via API server
            // Profile lookup, then create-on-miss. BOTH are best-effort: a
            // throw here must not fail a login that already succeeded, so the
            // catch swallows and the code falls through to the auth-metadata
            // shaped user below. The cost is that a transient profile 500
            // logs the student in with points 0 / no settings until the next
            // refreshUser() — visibly degraded, but signed in.
            let profile: any = null;
            try {
              profile = await apiFetchUserProfile(authUser.id);
            } catch (e) {
              // Profile may not exist yet
            }
            
            if (!profile) {
              const meta = authUser.user_metadata || {};
              try {
                profile = await apiCreateUserProfile({
                  id: authUser.id,
                  name: displayNameFromMeta(meta, email),
                  username: typeof meta.username === 'string' ? meta.username : undefined,
                  first_name: typeof meta.first_name === 'string' ? meta.first_name : undefined,
                  last_name: typeof meta.last_name === 'string' ? meta.last_name : undefined,
                  phone: typeof meta.phone === 'string' ? meta.phone : undefined,
                  points: 0,
                  badges: [],
                  stats: initialUserStats,
                });
              } catch (createErr) {
                console.error('Failed to create profile:', createErr);
              }
            }

            // Two shapes of the same User. `isAdmin` comes from the JWT's
            // app_metadata in both — never from the profile row, which the user
            // can write. The degraded (no-profile) branch carries no `settings`
            // and no academic identity at all, so consumers must tolerate them
            // being undefined rather than null here.
            const userObj: User = profile ? {
              id: profile.id,
              name: resolveDisplayName([profile.name], 'User'),
              email: email,
              isAdmin: authUser.app_metadata?.is_platform_admin === true,
              avatarUrl: profile.avatarUrl || '',
              points: profile.points || 0,
              badges: profile.badges || [],
              stats: profile.stats || initialUserStats,
              settings: normalizeUserSettings(profile.settings),
              testPresets: normalizeTestPresets(profile),
              username: profile.username || undefined,
              firstName: profile.firstName || undefined,
              lastName: profile.lastName || undefined,
              // Academic identity (Phase 1): null = known-missing, so the
              // profile-setup step / dashboard banner can prompt.
              institutionId: profile.institutionId ?? null,
              institution: profile.institution ?? null,
              faculty: profile.faculty ?? null,
              programme: profile.programme ?? null,
              studyLevel: profile.studyLevel ?? null,
              entryYear: profile.entryYear ?? null,
              expectedGraduationYear: profile.expectedGraduationYear ?? null,
            } : {
              id: authUser.id,
              name: displayNameFromMeta(authUser.user_metadata, email),
              email: email,
              isAdmin: authUser.app_metadata?.is_platform_admin === true,
              avatarUrl: '',
              points: 0,
              badges: [],
              stats: initialUserStats,
              testPresets: [],
            };

            // Cache the access token so subsequent API calls are instant
            if (session?.access_token) {
              setCachedAuthToken(session.access_token, authUser.id);
            }

            // A fresh session re-arms the "session expired" one-shot guard, so
            // a 401 from the PREVIOUS session can't suppress the banner for
            // this one.
            resetSessionExpiredGuard();
            set({
              currentUser: userObj,
              isAuthenticated: true,
              isAuthLoading: false,
              sessionRestoreFailed: false,
            });
            return { success: true };
          }

          set({ isAuthLoading: false });
          return { success: false, error: 'Login failed' };
        } catch (error: any) {
          set({ isAuthLoading: false, error: error.message });
          return { success: false, error: error.message };
        }
      },

      // Signup
      // Account creation. Unlike login this ALWAYS goes direct to supabase-js;
      // cookie mode is entered afterwards by exchanging the returned session
      // for the HttpOnly cookie (`exchangeCookieSession`), which is why that
      // call sits inside the access-token guard below.
      signup: async (email, password, name) => {
        set({ isAuthLoading: true, error: null });
        try {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { name },
            },
          });

          if (error) {
            set({ isAuthLoading: false, error: error.message });
            return { success: false, error: error.message };
          }

          if (data.user) {
            // Create user profile via API server
            let profile: any = null;
            try {
              profile = await apiCreateUserProfile({
                id: data.user.id,
                name: name,
                points: 0,
                badges: [],
                stats: initialUserStats,
              });
            } catch (createErr) {
              console.error('Failed to create profile:', createErr);
            }

            const userObj: User = {
              id: data.user.id,
              name: name,
              email: email,
              isAdmin: data.user.app_metadata?.is_platform_admin === true,
              avatarUrl: '',
              points: 0,
              badges: [],
              stats: initialUserStats,
            };

            // Cache the access token so subsequent API calls are instant.
            // Supabase returns `session: null` when e-mail confirmation is
            // required, in which case neither the token cache nor the cookie
            // exchange happens.
            // FIXED (F9): the set() below used to mark the account
            // authenticated in that no-session case too, so a
            // confirmation-required signup landed on the app shell with NO
            // token and every API call 401'd until the account was confirmed
            // and signed in properly. Signed-in now means "has a session";
            // otherwise the caller is told to send the student to their inbox.
            if (!data.session?.access_token) {
              set({ isAuthLoading: false });
              return { success: true, needsEmailConfirmation: true };
            }

            setCachedAuthToken(data.session.access_token, data.user.id);
            if (isCookieAuthEnabled()) {
              await exchangeCookieSession(data.session);
            }

            resetSessionExpiredGuard();
            set({
              currentUser: userObj,
              isAuthenticated: true,
              isAuthLoading: false,
              sessionRestoreFailed: false,
            });
            return { success: true };
          }

          set({ isAuthLoading: false });
          return { success: false, error: 'Signup failed' };
        } catch (error: any) {
          set({ isAuthLoading: false, error: error.message });
          return { success: false, error: error.message };
        }
      },

      // Logout
      // Sign-out. `apiLogoutSession()` revokes server-side (and clears the
      // cookie + token cache); the `finally` guarantees the local identity is
      // dropped even when that call fails, so a network problem can never leave
      // the tab showing a signed-in shell.
      //
      // What this clears is ONLY the identity: Sentry's user, `currentUser`,
      // `isAuthenticated`, `isAuthLoading`. Every other store's per-user data
      // (notes, decks, budget, chats, companion thread, AI jobs, the offline
      // queue) is purged by the sign-out effect calling each store's own
      // reset()/ensureOwner(). Anything that keeps a module-level or persisted
      // cache must also clear it on a USER SWITCH, not just here — otherwise a
      // stale-closure effect elsewhere in the same commit writes the purged
      // data straight back under the new account.
      logout: async () => {
        try {
          await apiLogoutSession();
        } finally {
          setSentryUser(null);
          set({
            currentUser: null,
            isAuthenticated: false,
            isAuthLoading: false,
            sessionRestoreFailed: false,
          });
        }
      },

      // Refresh user from database via API server
      // Re-read the profile and merge it over the in-memory user, field by
      // field, with the CURRENT value as the fallback — so a partial profile
      // response never blanks a name or an avatar the tab already had. The
      // academic-identity fields use `!== undefined` rather than `||` because
      // null is a meaningful answer there ("known-missing", which drives the
      // profile-setup prompt) and must survive the merge.
      //
      // `isAdmin` is re-derived from the session JWT each time. On failure this
      // only logs: a transient network error is NOT a sign-out, and clearing
      // `currentUser` here would sign the student out on a dropped request.
      refreshUser: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const profile = await apiFetchUserProfile(currentUser.id);
          const isAdmin = resolvePlatformAdmin(sessionData.session?.user, profile?.settings);
          if (profile) {
            set({
              currentUser: {
                ...currentUser,
                name: resolveDisplayName([profile.name, currentUser.name], currentUser.name),
                avatarUrl: profile.avatarUrl || currentUser.avatarUrl,
                points: profile.points ?? currentUser.points,
                badges: profile.badges || currentUser.badges,
                stats: profile.stats || currentUser.stats,
                settings: profile.settings
                  ? normalizeUserSettings(profile.settings)
                  : currentUser.settings,
                testPresets: normalizeTestPresets(profile),
                username: profile.username || currentUser.username,
                firstName: profile.firstName || currentUser.firstName,
                lastName: profile.lastName || currentUser.lastName,
                institutionId: profile.institutionId !== undefined ? profile.institutionId : (currentUser.institutionId ?? null),
                institution: profile.institution !== undefined ? profile.institution : (currentUser.institution ?? null),
                faculty: profile.faculty !== undefined ? profile.faculty : (currentUser.faculty ?? null),
                programme: profile.programme !== undefined ? profile.programme : (currentUser.programme ?? null),
                studyLevel: profile.studyLevel !== undefined ? profile.studyLevel : (currentUser.studyLevel ?? null),
                entryYear: profile.entryYear !== undefined ? profile.entryYear : (currentUser.entryYear ?? null),
                expectedGraduationYear:
                  profile.expectedGraduationYear !== undefined
                    ? profile.expectedGraduationYear
                    : (currentUser.expectedGraduationYear ?? null),
                isAdmin,
              }
            });
          } else {
            set({ currentUser: { ...currentUser, isAdmin } });
          }
        } catch (error) {
          console.error('Failed to refresh user:', error);
        }
      },

      // Update user profile via API server
      // Optimistic profile edit: paint locally, PATCH, and on failure put the
      // pre-edit user back. The revert restores the snapshot taken at entry, so
      // two overlapping updateUser calls can have the loser's revert undo the
      // winner's successful edit — callers serialise their own saves.
      //
      // FIXED (F9): the payload below tested username/first/last for
      // truthiness, so clearing one to an empty string was applied to local
      // state and never SENT — the old value came back on the next
      // refreshUser, which reads as the field refusing to be cleared. They now
      // use `!== undefined` and send `null` for an empty string, matching
      // `avatarUrl`/`points`/`testPresets`, which always supported clearing.
      // `name` deliberately keeps the truthy test: the server validates it as
      // 1-100 characters, so an empty display name is a 400, not a clear.
      updateUser: async (updates) => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          // Update local state immediately (optimistic)
          const updatedUser = { ...currentUser, ...updates };
          set({ currentUser: updatedUser });

          // Build API-compatible update payload
          const apiUpdates: any = {};
          if (updates.name) apiUpdates.name = updates.name;
          if (updates.avatarUrl !== undefined) apiUpdates.avatar_url = updates.avatarUrl || null;
          if (updates.points !== undefined) apiUpdates.points = updates.points;
          if (updates.badges) apiUpdates.badges = updates.badges;
          if (updates.stats) apiUpdates.stats = updates.stats;
          if (updates.testPresets !== undefined) apiUpdates.test_presets = updates.testPresets;
          if (updates.username !== undefined) apiUpdates.username = updates.username || null;
          if (updates.firstName !== undefined) apiUpdates.first_name = updates.firstName || null;
          if (updates.lastName !== undefined) apiUpdates.last_name = updates.lastName || null;

          // Sync with API server
          await apiUpdateUserProfile(currentUser.id, apiUpdates);
        } catch (error) {
          console.error('Failed to update user:', error);
          // Revert on error
          set({ currentUser });
        }
      },

      // Increment user stats
      // Local-first counter bump, then a fire-and-forget PATCH of the whole
      // stats object. Last write wins on the server, so two tabs incrementing
      // at once can lose one of the increments; the next refreshUser() pulls
      // the server's value back over the local one.
      incrementStats: (stat, amount = 1) => {
        const { currentUser } = get();
        if (!currentUser) return;

        const updatedStats = {
          ...currentUser.stats,
          [stat]: (currentUser.stats[stat] || 0) + amount,
        };

        const updatedUser = { ...currentUser, stats: updatedStats };
        set({ currentUser: updatedUser });

        // Sync with API server
        apiUpdateUserProfile(currentUser.id, { stats: updatedStats }).catch(console.error);
      },

      // Check auth state on app load (with timeout)
      // The boot verdict, run once by the app-boot effect. This is the ONLY
      // action that may decide "no session" and clear `currentUser` — and it
      // does so only on the explicit `else` below, when the session resolved
      // and there is no user on it.
      //
      // Two ways to get a session:
      //  - cookie mode: ask the BFF for the current session, and if that is
      //    null try one refresh. Success also pushes the tokens into
      //    supabase-js so realtime/RLS work.
      //  - direct mode: supabase.auth.getSession() raced against a 5s timeout.
      //    A timeout is treated as UNKNOWN, not as signed-out: it only drops
      //    isAuthLoading and returns, leaving the fast-boot user in place.
      // Likewise the catch only logs — a thrown fetch must not sign anyone out.
      checkAuthState: async () => {
        set({ isAuthLoading: true });
        try {
          let session: { access_token?: string; refresh_token?: string; user?: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } } | null = null;

          if (isCookieAuthEnabled()) {
            session =
              (await fetchCookieSession()) ??
              (await refreshCookieSession());
            if (session?.access_token && session.refresh_token) {
              await supabase.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              });
            }
          } else {
            const getSessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), 5000);
            });
            const sessionResult = await Promise.race([getSessionPromise, timeoutPromise]);
            if (!sessionResult) {
              console.warn('[Auth] checkAuthState timed out');
              // A timeout is NOT an answer. Saying so is what stops the auth
              // gate from rendering this as a sign-out (F9).
              set({ isAuthLoading: false, sessionRestoreFailed: true });
              return;
            }
            session = (sessionResult as { data: { session: typeof session } }).data.session;
          }
          
          // Session confirmed: cache the token FIRST so the profile fetch below
          // (and every other boot fetch) has an Authorization header, then
          // fetch-or-create the profile exactly as login() does.
          if (session?.user) {
            // Cache the token
            if (session.access_token) {
              setCachedAuthToken(session.access_token, session.user.id);
            }
            
            let profile: any = null;
            try {
              profile = await apiFetchUserProfile(session.user.id);
            } catch (e) {
              // Profile fetch failed
            }
            
            if (!profile) {
              try {
                profile = await apiCreateUserProfile({
                  id: session.user.id,
                  name: displayNameFromMeta(
                    session.user.user_metadata as Record<string, unknown> | undefined,
                    session.user.email,
                  ),
                  points: 0,
                  badges: [],
                  stats: initialUserStats,
                });
              } catch (createErr) {
                console.error('Failed to create profile:', createErr);
              }
            }

            const userObj: User = profile ? {
              id: profile.id,
              name: resolveDisplayName([profile.name], 'User'),
              email: session.user.email || '',
              isAdmin: session.user.app_metadata?.is_platform_admin === true,
              avatarUrl: profile.avatarUrl || '',
              points: profile.points || 0,
              badges: profile.badges || [],
              stats: profile.stats || initialUserStats,
              settings: normalizeUserSettings(profile.settings),
              testPresets: normalizeTestPresets(profile),
              username: profile.username || undefined,
              firstName: profile.firstName || undefined,
              lastName: profile.lastName || undefined,
              // Academic identity (Phase 1): null = known-missing, so the
              // profile-setup step / dashboard banner can prompt.
              institutionId: profile.institutionId ?? null,
              institution: profile.institution ?? null,
              faculty: profile.faculty ?? null,
              programme: profile.programme ?? null,
              studyLevel: profile.studyLevel ?? null,
              entryYear: profile.entryYear ?? null,
              expectedGraduationYear: profile.expectedGraduationYear ?? null,
            } : {
              id: session.user.id,
              name: displayNameFromMeta(
                session.user.user_metadata as Record<string, unknown> | undefined,
                session.user.email,
              ),
              email: session.user.email || '',
              isAdmin: session.user.app_metadata?.is_platform_admin === true,
              avatarUrl: '',
              points: 0,
              badges: [],
              stats: initialUserStats,
              testPresets: [],
            };

            set({
              currentUser: userObj,
              isAuthenticated: true,
              isAuthLoading: false,
              sessionRestoreFailed: false,
            });
          } else {
            // The one legitimate sign-out path in this store: the session
            // resolved and carried no user. Reached only when the request
            // actually answered — timeouts and throws take the branches above.
            set({
              currentUser: null,
              isAuthenticated: false,
              isAuthLoading: false,
              sessionRestoreFailed: false,
            });
          }
        } catch (error) {
          console.error('Failed to check auth state:', error);
          set({ isAuthLoading: false, sessionRestoreFailed: true });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      // Persisted slice, localStorage key `auth-storage-v2`. It is the PROFILE
      // only — no tokens ever live here — and `isAdmin` is stripped on the way
      // out so a localStorage edit can never grant admin UI; it is re-derived
      // from the JWT on every login/refresh/boot. There is no per-user
      // namespacing: one key holds whoever last signed in on this browser,
      // which is why `merge` below re-checks it against the token bootstrap.
      name: 'auth-storage-v2',
      partialize: (state) => ({
        currentUser: state.currentUser
          ? { ...state.currentUser, isAdmin: undefined }
          : null,
        isAuthenticated: state.isAuthenticated,
      }),
      // Drop stale profiles that outlive the Supabase session so guest `/` stays a guest.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<AuthState>;
        const boot = bootstrapAuthFromStorage();
        if (!shouldRestorePersistedAuthUser(boot, persisted.currentUser ?? null)) {
          return {
            ...currentState,
            ...persisted,
            currentUser: null,
            isAuthenticated: false,
          };
        }
        return {
          ...currentState,
          ...persisted,
          isAuthenticated: true,
        };
      },
    }
  )
);
// NOTE: The onAuthStateChange listener has been removed from this file.
// It is handled exclusively in useAppEffects.ts to avoid duplicate profile
// fetches and double-setting of user state on SIGNED_IN/SIGNED_OUT events.
