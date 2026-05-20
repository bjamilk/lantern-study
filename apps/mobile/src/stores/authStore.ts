/**
 * Authentication Store
 * Manages user authentication state with Supabase
 */
import { create } from 'zustand';
import { 
  supabase, 
  signInWithEmail, 
  signUpWithEmail, 
  signOut as supabaseSignOut,
  onAuthStateChange,
  getSession 
} from '../services/supabase';
import type { User, Session } from '@supabase/supabase-js';

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
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  isDemoMode: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInAsDemo: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: false,
  isInitialized: false,
  error: null,
  isDemoMode: DEMO_MODE,
  
  initialize: async () => {
    try {
      set({ isLoading: true });
      
      // In demo mode, auto-login as demo user
      if (DEMO_MODE) {
        set({ 
          user: DEMO_USER,
          session: DEMO_SESSION,
          isInitialized: true,
          isLoading: false,
        });
        return;
      }
      
      // Get current session
      const session = await getSession();
      
      if (session) {
        set({ 
          user: session.user,
          session,
          isInitialized: true,
          isLoading: false,
        });
      } else {
        set({ 
          user: null,
          session: null,
          isInitialized: true,
          isLoading: false,
        });
      }
      
      // Set up auth state listener
      onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event);
        
        if (session) {
          set({ user: session.user, session });
        } else {
          set({ user: null, session: null });
        }
      });
    } catch (error: any) {
      console.error('Failed to initialize auth:', error);
      
      // In demo mode fallback, still allow app to work
      if (DEMO_MODE) {
        set({ 
          user: DEMO_USER,
          session: DEMO_SESSION,
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
          isLoading: false,
        });
        return;
      }
      
      const { user, session } = await signInWithEmail(email, password);
      
      set({ 
        user,
        session,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Sign in failed:', error);
      set({ 
        error: error.message || 'Failed to sign in',
        isLoading: false,
      });
      throw error;
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
          isLoading: false,
        });
        return;
      }
      
      const { user, session } = await signUpWithEmail(email, password, name);
      
      // Note: Depending on Supabase settings, user might need to verify email
      set({ 
        user,
        session,
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
    try {
      set({ isLoading: true, error: null });
      
      // Demo mode - just clear state
      if (DEMO_MODE) {
        set({ 
          user: null,
          session: null,
          isLoading: false,
        });
        return;
      }
      
      await supabaseSignOut();
      
      set({ 
        user: null,
        session: null,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Sign out failed:', error);
      set({ 
        error: error.message || 'Failed to sign out',
        isLoading: false,
      });
      throw error;
    }
  },
  
  signInAsDemo: () => {
    set({ 
      user: DEMO_USER,
      session: DEMO_SESSION,
      isLoading: false,
      isInitialized: true,
    });
  },
  
  clearError: () => set({ error: null }),
}));
