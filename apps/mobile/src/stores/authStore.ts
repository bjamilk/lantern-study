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

// Demo mode flag - set to true for offline testing without backend
const DEMO_MODE = false;

// Mock user for demo mode
const DEMO_USER: User = {
  id: 'demo-user-123',
  email: 'demo@lanternstudy.app',
  app_metadata: {},
  user_metadata: { name: 'Demo User' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
} as User;

const DEMO_SESSION: Session = {
  access_token: 'demo-token',
  refresh_token: 'demo-refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: DEMO_USER,
} as Session;

interface AuthState {
  user: User | null;
  session: Session | null;
  profileName: string | null;
  profileFirstName: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  isPasswordRecovery: boolean;
  error: string | null;
  isDemoMode: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  signInAsDemo: () => void;
  clearError: () => void;
  setPasswordRecovery: (active: boolean) => void;
  refreshProfileName: (userId: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profileName: null,
  profileFirstName: null,
  isLoading: false,
  isInitialized: false,
  isPasswordRecovery: false,
  error: null,
  isDemoMode: DEMO_MODE,

  refreshProfileName: async (userId: string) => {
    try {
      const profile = await fetchUserProfile(userId);
      const p = profile as { name?: string; first_name?: string; firstName?: string };
      const name = p.name?.trim();
      const firstName = (p.first_name || p.firstName)?.trim();
      set({
        ...(name ? { profileName: name } : {}),
        ...(firstName ? { profileFirstName: firstName } : {}),
      });
    } catch (error) {
      console.warn('[Auth] Failed to refresh profile name:', error);
    }
  },
  
  initialize: async () => {
    try {
      set({ isLoading: true });
      
      // In demo mode, auto-login as demo user
      if (DEMO_MODE) {
        set({ 
          user: DEMO_USER,
          session: DEMO_SESSION,
          profileName: DEMO_USER.user_metadata?.name ?? 'Demo User',
          isInitialized: true,
          isLoading: false,
        });
        return;
      }
      
      // Refresh session if present, otherwise load current session
      const { data: refreshData } = await supabase.auth.refreshSession();
      const session = refreshData.session ?? (await getSession());
      
      if (session) {
        let profileName: string | null = null;
        let profileFirstName: string | null = null;
        try {
          const profile = await ensureUserProfile(session.user);
          profileName = profile.displayName;
          profileFirstName = profile.firstName ?? null;
        } catch (profileError) {
          console.warn('[Auth] Failed to ensure user profile:', profileError);
        }

        set({ 
          user: session.user,
          session,
          profileName,
          profileFirstName,
          isInitialized: true,
          isLoading: false,
        });
      } else {
        set({ 
          user: null,
          session: null,
          profileName: null,
          profileFirstName: null,
          isInitialized: true,
          isLoading: false,
        });
      }
      
      // Set up auth state listener
      onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event);

        if (event === 'PASSWORD_RECOVERY' && session) {
          set({ user: session.user, session, isPasswordRecovery: true });
          return;
        }

        if (event === 'SIGNED_OUT') {
          set({ user: null, session: null, profileName: null, profileFirstName: null, isPasswordRecovery: false });
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
          set({ user: null, session: null, profileName: null, profileFirstName: null, isPasswordRecovery: false });
        }
      });
    } catch (error: any) {
      console.error('Failed to initialize auth:', error);
      
      // In demo mode fallback, still allow app to work
      if (DEMO_MODE) {
        set({ 
          user: DEMO_USER,
          session: DEMO_SESSION,
          profileName: DEMO_USER.user_metadata?.name ?? 'Demo User',
          isInitialized: true,
          isLoading: false,
        });
        return;
      }
      
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
      
      // Demo mode - accept any credentials
      if (DEMO_MODE) {
        const demoUser = {
          ...DEMO_USER,
          email,
          user_metadata: { name: email.split('@')[0] },
        } as User;
        set({ 
          user: demoUser,
          session: { ...DEMO_SESSION, user: demoUser },
          profileName: demoUser.user_metadata?.name ?? null,
          isLoading: false,
        });
        return;
      }
      
      const { user, session } = await signInWithEmail(email, password);

      let profileName: string | null = null;
      let profileFirstName: string | null = null;
      if (user) {
        try {
          const profile = await ensureUserProfile(user);
          profileName = profile.displayName;
          profileFirstName = profile.firstName ?? null;
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
      
      // Demo mode - auto succeed
      if (DEMO_MODE) {
        const demoUser = {
          ...DEMO_USER,
          email,
          user_metadata: { name: name || email.split('@')[0] },
        } as User;
        set({ 
          user: demoUser,
          session: { ...DEMO_SESSION, user: demoUser },
          profileName: demoUser.user_metadata?.name ?? null,
          isLoading: false,
        });
        return;
      }
      
      const { user, session } = await signUpWithEmail(email, password, name);

      let profileName: string | null = null;
      let profileFirstName: string | null = null;
      if (user) {
        const profile = await ensureUserProfile(user);
        profileName = profile.displayName;
        profileFirstName = profile.firstName ?? null;
      }
      
      // Note: Depending on Supabase settings, user might need to verify email
      set({ 
        user,
        session,
        profileName,
        profileFirstName,
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
  
  signOut: async () => {
    set({ isLoading: true, error: null });
    const userId = get().user?.id;

    try {
      const { useMarketplaceStore, LEGACY_MARKETPLACE_STORAGE_KEYS } = await import('./marketplaceStore');
      await useMarketplaceStore.getState().reset();

      // Drop user-scoped settings cache so pending patches cannot leak across accounts.
      try {
        const { clearLocalSettings } = await import('./settingsStore');
        await clearLocalSettings(userId);
      } catch {
        // continue with local sign-out
      }

      if (!DEMO_MODE) {
        try {
          const { API_BASE_URL, getAuthHeaders } = await import('../services/supabase');
          const headers = await getAuthHeaders();
          if (headers.Authorization) {
            await fetch(`${API_BASE_URL}/api/v1/auth/logout`, { method: 'POST', headers });
          }
        } catch {
          // continue with local sign-out
        }
        await supabaseSignOut();
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

      await AsyncStorage.multiRemove([...new Set(keysToRemove)]).catch(() => {});
    } catch (error: any) {
      const sessionAlreadyGone =
        error?.name === 'AuthSessionMissingError' ||
        String(error?.message ?? '').includes('Auth session missing');

      if (!sessionAlreadyGone) {
        console.error('Sign out failed:', error);
        set({
          error: error.message || 'Failed to sign out',
          isLoading: false,
        });
        throw error;
      }
    } finally {
      set({
        user: null,
        session: null,
        profileName: null,
        profileFirstName: null,
        isLoading: false,
      });
    }
  },
  
  signInAsDemo: () => {
    set({ 
      user: DEMO_USER,
      session: DEMO_SESSION,
      profileName: DEMO_USER.user_metadata?.name ?? 'Demo User',
      isLoading: false,
      isInitialized: true,
    });
  },
  
  clearError: () => set({ error: null }),
}));
