/**
 * Web Auth Store
 * Manages authentication state for the web application
 * Uses Zustand for state management
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserStats } from '../types';
import { supabase } from '../services/supabase';

// Helper functions for user profile management
const fetchUserProfile = async (userId: string): Promise<User | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error || !data) return null;
  
  return {
    id: data.id,
    name: data.name || 'User',
    username: data.username || undefined,
    firstName: data.first_name || undefined,
    lastName: data.last_name || undefined,
    email: data.email,
    avatarUrl: data.avatar_url,
    points: data.points || 0,
    badges: data.badges || [],
    stats: data.stats || initialUserStats,
  };
};

const createUserProfile = async (profile: User): Promise<User | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar_url: profile.avatarUrl,
      points: profile.points,
      badges: profile.badges,
      stats: profile.stats,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating profile:', error);
    return null;
  }
  
  return profile;
};

const updateUserProfile = async (userId: string, updates: Partial<User>): Promise<void> => {
  const updateData: any = {};
  if (updates.name) updateData.name = updates.name;
  if (updates.email) updateData.email = updates.email;
  if (updates.avatarUrl) updateData.avatar_url = updates.avatarUrl;
  if (updates.points !== undefined) updateData.points = updates.points;
  if (updates.badges) updateData.badges = updates.badges;
  if (updates.stats) updateData.stats = updates.stats;
  if (updates.username) updateData.username = updates.username;
  if (updates.firstName) updateData.first_name = updates.firstName;
  if (updates.lastName) updateData.last_name = updates.lastName;
  
  const { error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', userId);
  
  if (error) {
    console.error('Error updating profile:', error);
    throw error;
  }
};

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
};

interface AuthState {
  // State
  currentUser: User | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  
  // Actions
  setCurrentUser: (user: User | null) => void;
  setAuthLoading: (loading: boolean) => void;
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
      // Initial State
      currentUser: null,
      isAuthLoading: true,
      isAuthenticated: false,
      error: null,

      // Set current user
      setCurrentUser: (user) => {
        set({ 
          currentUser: user, 
          isAuthenticated: !!user,
          isAuthLoading: false,
        });
      },

      // Set loading state
      setAuthLoading: (loading) => {
        set({ isAuthLoading: loading });
      },

      // Login
      login: async (email, password) => {
        set({ isAuthLoading: true, error: null });
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            set({ isAuthLoading: false, error: error.message });
            return { success: false, error: error.message };
          }

          if (data.user) {
            // Fetch or create user profile
            let profile = await fetchUserProfile(data.user.id);
            
            if (!profile) {
              // Create profile if it doesn't exist
              const newProfile: User = {
                id: data.user.id,
                name: data.user.user_metadata?.name || email.split('@')[0],
                email: email,
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.user_metadata?.name || email)}&background=random&color=fff`,
                points: 0,
                badges: [],
                stats: initialUserStats,
              };
              profile = await createUserProfile(newProfile);
            }

            set({
              currentUser: profile,
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
            // Create user profile
            const newProfile: User = {
              id: data.user.id,
              name: name,
              email: email,
              avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
              points: 0,
              badges: [],
              stats: initialUserStats,
            };
            
            const profile = await createUserProfile(newProfile);

            set({
              currentUser: profile,
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
          await supabase.auth.signOut();
        } finally {
          set({ 
            currentUser: null, 
            isAuthenticated: false,
            isAuthLoading: false,
          });
        }
      },

      // Refresh user from database
      refreshUser: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          const profile = await fetchUserProfile(currentUser.id);
          if (profile) {
            set({ currentUser: profile });
          }
        } catch (error) {
          console.error('Failed to refresh user:', error);
        }
      },

      // Update user profile
      updateUser: async (updates) => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          // Update local state immediately
          const updatedUser = { ...currentUser, ...updates };
          set({ currentUser: updatedUser });

          // Sync with database
          await updateUserProfile(currentUser.id, updates);
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

        // Sync with database
        updateUserProfile(currentUser.id, { stats: updatedStats }).catch(console.error);
      },

      // Check auth state on app load
      checkAuthState: async () => {
        set({ isAuthLoading: true });
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session?.user) {
            let profile = await fetchUserProfile(session.user.id);
            
            if (!profile) {
              // Create profile if it doesn't exist
              const newProfile: User = {
                id: session.user.id,
                name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
                email: session.user.email || '',
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.user_metadata?.name || 'User')}&background=random&color=fff`,
                points: 0,
                badges: [],
                stats: initialUserStats,
              };
              profile = await createUserProfile(newProfile);
            }

            set({
              currentUser: profile,
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
      name: 'auth-storage',
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Listen for auth state changes
supabase.auth.onAuthStateChange(async (event, session) => {
  const store = useAuthStore.getState();
  
  if (event === 'SIGNED_IN' && session?.user) {
    const profile = await fetchUserProfile(session.user.id);
    if (profile) {
      store.setCurrentUser(profile);
    }
  } else if (event === 'SIGNED_OUT') {
    store.setCurrentUser(null);
  }
});
