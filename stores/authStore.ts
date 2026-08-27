/**
 * Web Auth Store
 * Manages authentication state for the web application
 * Uses Zustand for state management
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

function displayNameFromMeta(
  meta: Record<string, unknown> | undefined,
  email: string | undefined,
  fallback = 'User',
): string {
  const raw = meta?.name;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const fromEmail = email?.split('@')[0];
  return fromEmail || fallback;
}

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
  
  // Actions
  setCurrentUser: (user: User | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setPasswordRecovery: (active: boolean) => void;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
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
      isPasswordRecovery:
        typeof window !== 'undefined' &&
        (window.location.pathname === '/reset-password' ||
          window.location.hash.includes('type=recovery')),
      error: null,

      // Set current user
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

            const userObj: User = profile ? {
              id: profile.id,
              name: profile.name || 'User',
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

            resetSessionExpiredGuard();
            set({
              currentUser: userObj,
              isAuthenticated: true,
              isAuthLoading: false,
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

            // Cache the access token so subsequent API calls are instant
            if (data.session?.access_token) {
              setCachedAuthToken(data.session.access_token, data.user.id);
              if (isCookieAuthEnabled()) {
                await exchangeCookieSession(data.session);
              }
            }

            resetSessionExpiredGuard();
            set({
              currentUser: userObj,
              isAuthenticated: true,
              isAuthLoading: false,
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
      logout: async () => {
        try {
          await apiLogoutSession();
        } finally {
          setSentryUser(null);
          set({
            currentUser: null,
            isAuthenticated: false,
            isAuthLoading: false,
          });
        }
      },

      // Refresh user from database via API server
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
                name: profile.name || currentUser.name,
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
          if (updates.username) apiUpdates.username = updates.username;
          if (updates.firstName) apiUpdates.first_name = updates.firstName;
          if (updates.lastName) apiUpdates.last_name = updates.lastName;

          // Sync with API server
          await apiUpdateUserProfile(currentUser.id, apiUpdates);
        } catch (error) {
          console.error('Failed to update user:', error);
          // Revert on error
          set({ currentUser });
        }
      },

      // Increment user stats
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
              set({ isAuthLoading: false });
              return;
            }
            session = (sessionResult as { data: { session: typeof session } }).data.session;
          }
          
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
              name: profile.name || 'User',
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
            });
          } else {
            set({
              currentUser: null,
              isAuthenticated: false,
              isAuthLoading: false,
            });
          }
        } catch (error) {
          console.error('Failed to check auth state:', error);
          set({ isAuthLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
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
