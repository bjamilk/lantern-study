/**
 * Authentication Store
 * Manages user authentication state with Supabase
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  supabase, 
  signInWithEmail, 
  signUpWithEmail, 
  signOut as supabaseSignOut,
  onAuthStateChange,
  getSession 
} from '../services/supabase';
import { ensureUserProfile } from '../services/ensureUserProfile';
import { fetchUserProfile } from '../services/api';
import { signInWithGoogleOAuth, signInWithAppleNative } from '../services/socialAuth';
import type { User, Session } from '@supabase/supabase-js';
import { isEmailNotConfirmedError } from '@lantern/shared';
import { extractAcademicProfile, type AcademicProfile } from '../utils/academicProfile';

/**
 * Who ended the session.
 *
 * `user`   — the student tapped Sign out. They meant it: wipe the handset.
 * `revoked` — the server ended it (SESSION_REVOKED / a refresh that proved the
 *   token is dead). The student did not ask for this and may sign straight
 *   back in, so their unsynced work MUST survive. A network failure never
 *   produces this any more — see services/authFailure.ts.
 */
export type SignOutReason = 'user' | 'revoked';

/**
 * Outbound queues holding work the student has done but not yet uploaded.
 * These are never cleared on a sign-out the student did not ask for: wiping
 * them is how a dropped connection used to delete a finished offline test.
 */
const UNSYNCED_WORK_KEYS = ['@lantern_pending_results', 'lantern_sync_queue'] as const;

interface AuthState {
  user: User | null;
  session: Session | null;
  profileName: string | null;
  profileFirstName: string | null;
  /**
   * Academic identity from GET /users/me (institution, programme, level …).
   * null until the profile has been fetched; see utils/academicProfile.
   */
  academicProfile: AcademicProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  isPasswordRecovery: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: (opts?: { reason?: SignOutReason }) => Promise<void>;
  clearError: () => void;
  setPasswordRecovery: (active: boolean) => void;
  refreshProfileName: (userId: string) => Promise<void>;
  setAcademicProfile: (profile: AcademicProfile | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profileName: null,
  profileFirstName: null,
  academicProfile: null,
  isLoading: false,
  isInitialized: false,
  isPasswordRecovery: false,
  error: null,

  setAcademicProfile: (academicProfile) => set({ academicProfile }),

  refreshProfileName: async (userId: string) => {
    try {
      const profile = await fetchUserProfile(userId);
      const p = profile as { name?: string; first_name?: string; firstName?: string };
      const name = p.name?.trim();
      const firstName = (p.first_name || p.firstName)?.trim();
      set({
        ...(name ? { profileName: name } : {}),
        ...(firstName ? { profileFirstName: firstName } : {}),
        academicProfile: extractAcademicProfile(profile),
      });
    } catch (error) {
      console.warn('[Auth] Failed to refresh profile name:', error);
    }
  },
  
  initialize: async () => {
    try {
      set({ isLoading: true });

      // Refresh session if present, otherwise load current session.
      // Guard with a timeout so a stalled auth call can't hang app boot forever.
      let session = null;
      try {
        session = await Promise.race([
          (async () => {
            const { data: refreshData } = await supabase.auth.refreshSession();
            return refreshData.session ?? (await getSession());
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('auth-init-timeout')), 8000)
          ),
        ]);
      } catch (e) {
        console.warn('[Auth] session restore timed out/failed, continuing unauthenticated:', String(e));
        // Transient stall (e.g. QUIC hang to Supabase on emulators): leave the
        // persisted session untouched and retry in the background. A slow
        // network must never become a logout. When the retry succeeds the
        // onAuthStateChange listener below restores the authenticated state.
        setTimeout(() => {
          void supabase.auth.refreshSession().catch(() => {});
        }, 10000);
      }

      if (session) {
        let profileName: string | null = null;
        let profileFirstName: string | null = null;
        let academicProfile: AcademicProfile | null = null;
        try {
          const profile = await ensureUserProfile(session.user);
          profileName = profile.displayName;
          profileFirstName = profile.firstName ?? null;
          academicProfile = profile.academic ?? null;
        } catch (profileError) {
          console.warn('[Auth] Failed to ensure user profile:', profileError);
        }

        set({
          user: session.user,
          session,
          profileName,
          profileFirstName,
          academicProfile,
          isInitialized: true,
          isLoading: false,
        });
      } else {
        set({
          user: null,
          session: null,
          profileName: null,
          profileFirstName: null,
          academicProfile: null,
          isInitialized: true,
          isLoading: false,
        });
      }

      // Set up auth state listener (deferred so its initial-session emission can't
      // block the first render).
      setTimeout(() => {
      onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event);

        if (event === 'PASSWORD_RECOVERY' && session) {
          set({ user: session.user, session, isPasswordRecovery: true });
          return;
        }

        if (event === 'SIGNED_OUT') {
          set({ user: null, session: null, profileName: null, profileFirstName: null, academicProfile: null, isPasswordRecovery: false });
          return;
        }
        
        if (session) {
          if (get().isPasswordRecovery) {
            set({ user: session.user, session });
            return;
          }
          set({ user: session.user, session });
          void get().refreshProfileName(session.user.id);
        } else {
          // Null session on anything other than an explicit SIGNED_OUT (handled
          // above) is a race, not a logout: INITIAL_SESSION before a slow
          // storage read resolves, or a transient refresh failure. Wiping state
          // here is how a network stall signed users out. Keep the current state.
          console.warn('[Auth] ignoring null-session auth event:', event);
        }
      });
      }, 0);
    } catch (error: any) {
      console.error('Failed to initialize auth:', error);

      set({
        error: error.message,
        isInitialized: true,
        isLoading: false,
      });
    }
  },
  
  signIn: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });

      const { user, session } = await signInWithEmail(email, password);

      let profileName: string | null = null;
      let profileFirstName: string | null = null;
      let academicProfile: AcademicProfile | null = null;
      if (user) {
        try {
          const profile = await ensureUserProfile(user);
          profileName = profile.displayName;
          profileFirstName = profile.firstName ?? null;
          academicProfile = profile.academic ?? null;
        } catch (profileError) {
          console.warn('Profile sync failed after sign-in; continuing with auth session:', profileError);
          profileName =
            (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
            user.email?.split('@')[0] ||
            null;
        }
      }

      set({
        user,
        session,
        profileName,
        profileFirstName,
        academicProfile,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Sign in failed:', error);
      const message = error.message || 'Failed to sign in';
      set({ 
        error: message,
        isLoading: false,
      });
      if (isEmailNotConfirmedError(error)) {
        throw error;
      }
    }
  },
  
  setPasswordRecovery: (active) => set({ isPasswordRecovery: active }),
  
  signInWithGoogle: async () => {
    try {
      set({ isLoading: true, error: null });
      const { user, session } = await signInWithGoogleOAuth();
      const profile = await ensureUserProfile(user);
      set({
        user,
        session,
        profileName: profile.displayName,
        profileFirstName: profile.firstName ?? null,
        academicProfile: profile.academic ?? null,
        isLoading: false,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to sign in with Google';
      if (!message.includes('cancelled')) {
        console.error('Google sign in failed:', error);
      }
      set({ error: message.includes('cancelled') ? null : message, isLoading: false });
      if (!message.includes('cancelled')) throw error;
    }
  },

  signInWithApple: async () => {
    try {
      set({ isLoading: true, error: null });
      const { user, session } = await signInWithAppleNative();
      const profile = await ensureUserProfile(user);
      set({
        user,
        session,
        profileName: profile.displayName,
        profileFirstName: profile.firstName ?? null,
        academicProfile: profile.academic ?? null,
        isLoading: false,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to sign in with Apple';
      if (!message.includes('cancelled') && !message.includes('ERR_REQUEST_CANCELED')) {
        console.error('Apple sign in failed:', error);
      }
      const cancelled =
        message.includes('cancelled') ||
        message.includes('ERR_REQUEST_CANCELED') ||
        (error as { code?: string })?.code === 'ERR_REQUEST_CANCELED';
      set({ error: cancelled ? null : message, isLoading: false });
      if (!cancelled) throw error;
    }
  },

  signUp: async (email: string, password: string, name?: string) => {
    try {
      set({ isLoading: true, error: null });

      const { user, session } = await signUpWithEmail(email, password, name);

      let profileName: string | null = null;
      let profileFirstName: string | null = null;
      let academicProfile: AcademicProfile | null = null;
      if (user) {
        const profile = await ensureUserProfile(user);
        profileName = profile.displayName;
        profileFirstName = profile.firstName ?? null;
        academicProfile = profile.academic ?? null;
      }

      // Note: Depending on Supabase settings, user might need to verify email
      set({
        user,
        session,
        profileName,
        profileFirstName,
        academicProfile,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Sign up failed:', error);
      set({ 
        error: error.message || 'Failed to sign up',
        isLoading: false,
      });
      throw error;
    }
  },
  
  signOut: async (opts) => {
    const reason: SignOutReason = opts?.reason ?? 'user';
    set({ isLoading: true, error: null });
    const userId = get().user?.id;
    let remoteError: any = null;
    let LEGACY_MARKETPLACE_STORAGE_KEYS: readonly string[] = [];

    // The local cleanup below runs INDEPENDENTLY of the remote revoke. It used
    // to sit after it in one try block, so an offline sign-out threw at the
    // network call and left every cache — and the refresh token — on the
    // handset while the UI claimed the student was logged out.
    try {
      const marketplace = await import('./marketplaceStore');
      LEGACY_MARKETPLACE_STORAGE_KEYS = marketplace.LEGACY_MARKETPLACE_STORAGE_KEYS;
      await marketplace.useMarketplaceStore.getState().reset();
    } catch {
      // continue with local sign-out
    }

    // Chat wallpapers: the AsyncStorage key is user-scoped and stays put on
    // purpose, but the IN-MEMORY manifest is module state that outlives the
    // sign-out. On a shared handset that meant the next account's first chat
    // frame was painted with the previous student's personal photo.
    try {
      const { useChatWallpaperStore } = await import('./chatWallpaperStore');
      useChatWallpaperStore.getState().reset();
    } catch {
      // continue with local sign-out
    }

    // Signed storage URLs are module-level, in-memory and keyed only by
    // (bucket, path, variant) — nothing in the key says WHOSE session minted
    // them. Board and chat photos are now re-signed on read against that
    // cache, so on a shared handset the next account would be handed URLs
    // minted under the previous student's authorisation, for up to six hours.
    // Exactly the chat-wallpaper problem above, one cache over.
    try {
      const { clearSignedUrlCache } = await import('../utils/signedUrlCache');
      clearSignedUrlCache();
    } catch {
      // continue with local sign-out
    }

    // Drop user-scoped settings cache so pending patches cannot leak across accounts.
    try {
      const { clearLocalSettings } = await import('./settingsStore');
      await clearLocalSettings(userId);
    } catch {
      // continue with local sign-out
    }

    // Remote revoke — best effort. supabaseSignOut() itself falls back to a
    // local scope when the network is the thing that failed, so the refresh
    // token is dropped from storage either way (services/supabase.ts).
    try {
      const { API_BASE_URL, getAuthHeaders } = await import('../services/supabase');
      const headers = await getAuthHeaders();
      if (headers.Authorization) {
        await fetch(`${API_BASE_URL}/api/v1/auth/logout`, { method: 'POST', headers });
      }
    } catch {
      // continue with local sign-out
    }

    try {
      await supabaseSignOut();
    } catch (error: any) {
      remoteError = error;
    }

    const keysToRemove = [
      '@lantern_offline_data',
      '@lantern_pending_results',
      'lantern_groups',
      'lantern_messages',
      'lantern_sync_queue',
      'lantern_decks',
      'lantern_flashcards',
      'lantern_stats',
      'lantern_tests',
      'lantern_test_attempts',
      'lantern_test_questions',
      'budgetTransactions',
      'monthlyBudget',
      'lantern-settings',
      ...LEGACY_MARKETPLACE_STORAGE_KEYS,
    ];

    if (userId) {
      keysToRemove.push(
        `walletBalance_${userId}`,
        `savingsGoals_${userId}`,
        `expenseSplits_${userId}`,
        `lantern-settings:${userId}`,
      );
    }

    // Only a sign-out the student asked for wipes everything. On a revoked
    // session their unsynced work stays put so it can still be uploaded when
    // they sign back in — a session ending is not permission to delete a
    // finished test they have not managed to submit yet.
    const preserved = reason === 'user' ? new Set<string>() : new Set<string>(UNSYNCED_WORK_KEYS);
    const finalKeys = [...new Set(keysToRemove)].filter((key) => !preserved.has(key));

    await AsyncStorage.multiRemove(finalKeys).catch(() => {});

    set({
      user: null,
      session: null,
      profileName: null,
      profileFirstName: null,
      academicProfile: null,
      isLoading: false,
    });

    if (remoteError) {
      const sessionAlreadyGone =
        remoteError?.name === 'AuthSessionMissingError' ||
        String(remoteError?.message ?? '').includes('Auth session missing');

      // The handset is already clean at this point; the throw only tells a
      // user-initiated caller that the server was not told.
      if (!sessionAlreadyGone && reason === 'user') {
        console.error('Sign out failed:', remoteError);
        set({ error: remoteError.message || 'Failed to sign out' });
        throw remoteError;
      }
    }
  },
  
  clearError: () => set({ error: null }),
}));
