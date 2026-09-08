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
  readStoredSession,
} from '../services/supabase';
import { ensureUserProfile } from '../services/ensureUserProfile';
import { fetchUserProfile } from '../services/api';
import { signInWithGoogleOAuth, signInWithAppleNative } from '../services/socialAuth';
import type { User, Session } from '@supabase/supabase-js';
import { isEmailNotConfirmedError } from '@lantern/shared';
import { profileDisplayName } from '../hooks/profileIdentity';
import { extractAcademicProfile, type AcademicProfile } from '../utils/academicProfile';
import { PENDING_RESULTS_LEGACY_KEY, pendingResultsKey } from './pendingResultsScope';
import { SYNC_QUEUE_LEGACY_KEY, syncQueueKey } from '@lantern/shared/sync';
import {
  PENDING_QBANK_SCORES_LEGACY_KEY,
  pendingQbankScoresKey,
} from '../utils/pendingQuestionBankScoresScope';
import { planSignOutKeyRemoval } from './signOutStorageKeys';
import {
  planSessionRestore,
  restoreRetryDelayMs,
  type SessionRestoreNetworkResult,
  type SessionState,
} from './sessionRestore';
import { classifyRefreshError } from '../services/authFailure';
import { useUIStore } from './uiStore';

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
 * Outbound queues holding work the student has done but not yet uploaded:
 * pending offline results, the offline sync queue and queued question-bank
 * scores. Which of them a sign-out may delete is decided by
 * stores/signOutStorageKeys — never cleared on a sign-out the student did not
 * ask for (wiping them is how a dropped connection used to delete a finished
 * offline test), and never for another account on the same handset.
 */

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
  /**
   * Whether the session in `session` has been confirmed with the auth server
   * on this launch. `restoring` means the app is running on the session read
   * from disk while a refresh retries in the background — fully usable, and
   * NEVER a reason to render the sign-in route. See stores/sessionRestore.ts.
   */
  sessionState: SessionState;
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

/** How long the boot refresh may take before we fall back to the stored session. */
const BOOT_REFRESH_TIMEOUT_MS = 8_000;
const BOOT_TIMEOUT_MARKER = 'auth-init-timeout';

/**
 * Fallback display name so a restoring boot greets the student, not "User".
 *
 * This name is not only a greeting: it is the identity the app stamps on the
 * viewer's own chat and board cards until the server's copy lands, and a board
 * shows those to everyone who can read it. So it goes through the SAME pure
 * planner every mobile surface uses (`profileDisplayName`): a genuine metadata
 * name survives — including one that merely equals the email local part — while
 * a literal address, and the bare local part on its own, resolve to '' (→
 * null). The email local part is never dressed up as a name, so the old
 * top-bar "NI" can no longer be seeded from here.
 */
export function displayNameFromUser(user: User): string | null {
  return (
    profileDisplayName({
      metadataName: typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : null,
      email: user.email ?? null,
    }) || null
  );
}

/**
 * One boot refresh attempt, reduced to the four outcomes the planner speaks.
 *
 * Nothing here may throw: every failure has to become a `SessionRestoreNetworkResult`,
 * because the alternative — an exception escaping into `initialize`'s catch —
 * is exactly the path that used to leave `session` null and sign a student out.
 */
async function attemptBootRefresh(): Promise<{
  networkResult: SessionRestoreNetworkResult;
  session: Session | null;
}> {
  try {
    const result = await Promise.race([
      supabase.auth.refreshSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(BOOT_TIMEOUT_MARKER)), BOOT_REFRESH_TIMEOUT_MS)
      ),
    ]);

    if (result.error) {
      return {
        networkResult: classifyRefreshError(result.error) === 'invalid' ? 'refused' : 'offline',
        session: null,
      };
    }
    if (result.data.session) {
      return { networkResult: 'ok', session: result.data.session };
    }
    // No session and no error proves nothing; treat it as a failed transport.
    return { networkResult: 'offline', session: null };
  } catch (error) {
    if (error instanceof Error && error.message === BOOT_TIMEOUT_MARKER) {
      return { networkResult: 'timeout', session: null };
    }
    return {
      networkResult: classifyRefreshError(error) === 'invalid' ? 'refused' : 'offline',
      session: null,
    };
  }
}

/**
 * Background retry for a `restoring` boot. Module state, single-flight: a
 * second `initialize()` (Fast Refresh, a remount from the font-scale key)
 * must not stack a second backoff ladder.
 */
let restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
let restoreRetryAttempt = 0;

/**
 * Bumped every time the session ends or changes hands (signOut, SIGNED_OUT,
 * and every explicit sign-in). The app is now interactive while the boot
 * refresh is still in flight, so a student can tap Sign out at 3 s and have
 * the refresh land at 7 s. A refresh that started under an older epoch
 * describes a session that no longer exists and must not be written back into
 * the store — that would resurrect the account they just signed out of (or
 * null out the one they just signed in to).
 */
let sessionEpoch = 0;

export function cancelSessionRestoreRetry(): void {
  if (restoreRetryTimer) clearTimeout(restoreRetryTimer);
  restoreRetryTimer = null;
  restoreRetryAttempt = 0;
}

/**
 * Retry the refresh until it succeeds or gotrue positively refuses it.
 *
 * Deliberately does NOT touch `user`/`session` on failure: the whole point is
 * that the app keeps running on the stored session, so realtime and auto-sync
 * — which key off `user?.id` — never see a null and never tear down.
 */
function scheduleSessionRestoreRetry(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState
): void {
  if (restoreRetryTimer) return;
  restoreRetryAttempt += 1;
  restoreRetryTimer = setTimeout(async () => {
    restoreRetryTimer = null;
    if (get().sessionState !== 'restoring') {
      cancelSessionRestoreRetry();
      return;
    }

    const epoch = sessionEpoch;
    const { networkResult, session } = await attemptBootRefresh();

    // Up to 8 s passed. If the session ended meanwhile (sign-out, SIGNED_OUT)
    // or a TOKEN_REFRESHED already confirmed it, this result is stale: apply
    // nothing, and do not cancel a ladder a newer initialize() may own.
    if (epoch !== sessionEpoch || get().sessionState !== 'restoring') return;

    if (networkResult === 'ok' && session) {
      cancelSessionRestoreRetry();
      useUIStore.getState().setAuthOffline(false);
      set({ user: session.user, session, sessionState: 'authenticated' });
      void get().refreshProfileName(session.user.id);
      return;
    }

    if (networkResult === 'refused') {
      cancelSessionRestoreRetry();
      void get().signOut({ reason: 'revoked' });
      return;
    }

    scheduleSessionRestoreRetry(set, get);
  }, restoreRetryDelayMs(restoreRetryAttempt));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profileName: null,
  profileFirstName: null,
  academicProfile: null,
  isLoading: false,
  isInitialized: false,
  sessionState: 'signed-out',
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
      cancelSessionRestoreRetry();

      // Step 1 — what is on this handset, read WITHOUT the network.
      // `supabase.auth.getSession()` cannot answer this: auth-js refreshes
      // inside it once the access token is past its expiry margin, which is
      // the very call that stalls here.
      const stored = await readStoredSession();

      // Step 2 — render the app on the stored session IMMEDIATELY.
      //
      // This is the fix. The old code waited up to 8 s and then, on timeout,
      // continued with a null session: the navigator swapped to "Sign in to
      // continue", every realtime channel tore down, the theme fell back to
      // light and the avatar to initials — a convincing fake of a signed-out
      // student, undone ~15 s later when the refresh finally landed. A stored
      // session is enough to draw the real app; the refresh only decides
      // whether the token gets renewed or the session is genuinely dead.
      if (stored) {
        // A remount (font-scale key, Fast Refresh) calls initialize() again
        // on a session this launch may already have confirmed. Don't downgrade
        // what the store knows about the SAME account: the real display name
        // and 'authenticated' stay until the refresh below says otherwise.
        const current = get();
        const sameAccount = current.user?.id === stored.user.id;
        set({
          user: stored.user,
          session: stored,
          profileName:
            sameAccount && current.profileName
              ? current.profileName
              : displayNameFromUser(stored.user),
          sessionState:
            sameAccount && current.sessionState === 'authenticated' ? 'authenticated' : 'restoring',
          isInitialized: true,
          isLoading: false,
        });
      }

      // Step 3 — try to refresh, then apply the pure rule.
      const epoch = sessionEpoch;
      const { networkResult, session: refreshed } = await attemptBootRefresh();
      const plan = planSessionRestore({
        networkResult,
        storedSession: stored ? 'present' : 'absent',
      });

      if (epoch !== sessionEpoch) {
        // The app was live on the stored session for those seconds and the
        // student signed out (or in as someone else) meanwhile. This result
        // describes a session that no longer exists; writing it would put
        // the signed-out account straight back on screen.
        console.warn(`[Auth] session changed while the boot refresh was in flight; ignoring its ${networkResult}`);
      } else if (plan.signOut === 'revoked') {
        console.warn('[Auth] the auth server refused the stored session; signing out');
        await get().signOut({ reason: 'revoked' });
        set({ sessionState: 'signed-out', isInitialized: true, isLoading: false });
      } else if (plan.route === 'sign-in') {
        set({
          user: null,
          session: null,
          profileName: null,
          profileFirstName: null,
          academicProfile: null,
          sessionState: 'signed-out',
          isInitialized: true,
          isLoading: false,
        });
      } else if (plan.useStoredSession && stored) {
        // Timeout or offline with a session on disk: stay on it and keep
        // trying. One quiet line in the shell — the existing offline
        // indicator, which also retries the moment NetInfo says the link
        // is back.
        console.warn(
          `[Auth] session restore ${networkResult}; running on the stored session and retrying`
        );
        useUIStore.getState().setAuthOffline(true);
        set({ sessionState: 'restoring', isInitialized: true, isLoading: false });
        scheduleSessionRestoreRetry(set, get);
      } else {
        const session = refreshed;
        let profileName: string | null = session ? displayNameFromUser(session.user) : null;
        let profileFirstName: string | null = null;
        let academicProfile: AcademicProfile | null = null;
        if (session) {
          try {
            const profile = await ensureUserProfile(session.user);
            profileName = profile.displayName;
            profileFirstName = profile.firstName ?? null;
            academicProfile = profile.academic ?? null;
          } catch (profileError) {
            console.warn('[Auth] Failed to ensure user profile:', profileError);
          }
        }

        useUIStore.getState().setAuthOffline(false);
        set({
          user: session?.user ?? null,
          session: session ?? null,
          profileName,
          profileFirstName,
          academicProfile,
          sessionState: session ? 'authenticated' : 'signed-out',
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
          cancelSessionRestoreRetry();
          sessionEpoch += 1;
          set({ user: null, session: null, profileName: null, profileFirstName: null, academicProfile: null, isPasswordRecovery: false, sessionState: 'signed-out' });
          return;
        }

        if (session) {
          // A NEW access token means the auth server answered, so this is also
          // how a `restoring` boot ends when a refresh finally lands. An
          // INITIAL_SESSION carrying the same token we are already restoring on
          // proves nothing — auth-js emits it straight from storage — so it
          // must not clear the notice or stop the retry ladder.
          const previous = get().session;
          const confirmed =
            get().sessionState !== 'restoring' ||
            session.access_token !== previous?.access_token;
          if (confirmed) {
            cancelSessionRestoreRetry();
            useUIStore.getState().setAuthOffline(false);
          }
          const sessionState: SessionState = confirmed ? 'authenticated' : 'restoring';
          if (get().isPasswordRecovery) {
            set({ user: session.user, session, sessionState });
            return;
          }
          set({ user: session.user, session, sessionState });
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
          profileName = displayNameFromUser(user);
        }
      }

      set({
        user,
        session,
        profileName,
        profileFirstName,
        academicProfile,
        sessionState: session ? 'authenticated' : 'signed-out',
        isLoading: false,
      });
      sessionEpoch += 1;
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
        sessionState: session ? 'authenticated' : 'signed-out',
        isLoading: false,
      });
      sessionEpoch += 1;
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
        sessionState: session ? 'authenticated' : 'signed-out',
        isLoading: false,
      });
      sessionEpoch += 1;
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
        sessionState: session ? 'authenticated' : 'signed-out',
        isLoading: false,
      });
      sessionEpoch += 1;
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
    // Nothing may resurrect a session the student (or the server) has ended:
    // stop the ladder, and stamp the epoch so any refresh still in flight is
    // discarded when it lands.
    cancelSessionRestoreRetry();
    sessionEpoch += 1;
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

    // Pending offline results are stored per user, but the store's IN-MEMORY
    // list is module state that outlives the sign-out. Left in place, the next
    // account's sync would see a non-empty list, skip loading its own, and
    // persist "none of these are mine" over its stored results. Storage is
    // untouched here — the keyed removal below decides that by reason.
    try {
      const { useOfflineStore } = await import('./offlineStore');
      useOfflineStore.setState({ pendingResults: [] });
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
      PENDING_RESULTS_LEGACY_KEY,
      PENDING_QBANK_SCORES_LEGACY_KEY,
      'lantern_groups',
      'lantern_messages',
      SYNC_QUEUE_LEGACY_KEY,
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
        // Pending results are keyed per user; only THIS account's list is a
        // candidate for removal, and only on a sign-out they asked for.
        pendingResultsKey(userId),
        // Same rule for the other two outbound queues: this account's key is
        // a candidate, nobody else's ever is.
        syncQueueKey(userId),
        pendingQbankScoresKey(userId),
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
    const finalKeys = planSignOutKeyRemoval(reason, userId, keysToRemove);

    await AsyncStorage.multiRemove(finalKeys).catch(() => {});

    set({
      user: null,
      session: null,
      profileName: null,
      profileFirstName: null,
      academicProfile: null,
      sessionState: 'signed-out',
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
