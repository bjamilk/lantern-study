// ===========================================
// Lantern Study - Auth Store (Zustand)
// ===========================================
// Cross-platform authentication state management

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';
import { getDefaultStorageAdapter, STORAGE_KEYS } from '../storage';

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
    
    // Actions
    setUser: (user: User | null) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    login: (user: User) => void;
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            isAuthenticated: false,
            isLoading: true,
            error: null,

            setUser: (user) => set({ 
                user, 
                isAuthenticated: !!user,
                isLoading: false 
            }),

            setLoading: (isLoading) => set({ isLoading }),

            setError: (error) => set({ error, isLoading: false }),

            login: (user) => set({ 
                user, 
                isAuthenticated: true, 
                isLoading: false,
                error: null 
            }),

            logout: () => set({ 
                user: null, 
                isAuthenticated: false, 
                isLoading: false,
                error: null 
            }),

            updateUser: (updates) => {
                const currentUser = get().user;
                if (!currentUser) return;
                
                set({ 
                    user: { ...currentUser, ...updates } 
                });
            },
        }),
        {
            name: STORAGE_KEYS.USER,
            storage: createJSONStorage(() => ({
                getItem: async (name) => {
                    const adapter = getDefaultStorageAdapter();
                    return adapter.getItem(name);
                },
                setItem: async (name, value) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.setItem(name, value);
                },
                removeItem: async (name) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.removeItem(name);
                },
            })),
            partialize: (state) => ({ 
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);
