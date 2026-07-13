/**
 * Settings Store
 * Manages user settings with sync to Supabase backend
 * Settings are shared between web and mobile apps
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, API_BASE_URL, getAuthHeaders } from '../services/supabase';
import { fetchUserPreferences, saveUserPreferences } from '../services/api';
import NetInfo from '@react-native-community/netinfo';
import { clearPushToken } from '../services/pushNotifications';
import {
  type UserSettings,
  type NotificationSettings,
  type StudySettings,
  type AppearanceSettings,
  type PrivacySettings,
  type AccessibilitySettings,
  type SyncSettings,
  DEFAULT_USER_SETTINGS,
  mergeSettingsCategory,
  normalizeUserSettings,
} from '@lantern/shared/settings';

export type {
  UserSettings,
  NotificationSettings,
  StudySettings,
  AppearanceSettings,
  PrivacySettings,
  AccessibilitySettings,
  SyncSettings,
};

export const DEFAULT_SETTINGS: UserSettings = DEFAULT_USER_SETTINGS;

// Debounce timer for auto-sync
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 2000;
let currentUserId: string | null = null;

async function canSyncNow(settings: UserSettings): Promise<boolean> {
  if (!settings.sync.autoSync) return false;
  if (!settings.sync.syncOnWifiOnly) return true;
  const state = await NetInfo.fetch();
  return state.type === 'wifi' && state.isConnected === true;
}

// ============================================
// STORE INTERFACE
// ============================================

interface SettingsState {
  settings: UserSettings;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  hasUnsyncedChanges: boolean;
  
  // Actions
  loadSettings: (userId: string) => Promise<void>;
  updateSettings: <K extends keyof UserSettings>(
    category: K,
    updates: Partial<UserSettings[K]>
  ) => Promise<void>;
  updateSingleSetting: <K extends keyof UserSettings>(
    category: K,
    key: keyof UserSettings[K],
    value: any
  ) => Promise<void>;
  syncSettings: (userId: string) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  clearError: () => void;
}

// ============================================
// STORE IMPLEMENTATION
// ============================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      isLoading: false,
      isSyncing: false,
      error: null,
      hasUnsyncedChanges: false,
      
      loadSettings: async (userId: string) => {
        // Store user ID for auto-sync
        currentUserId = userId;
        
        // Get current cached settings from persisted store (instant)
        const cachedSettings = get().settings;
        const hasCachedSettings = cachedSettings.updatedAt !== DEFAULT_SETTINGS.updatedAt;
        
        // If we have cached settings, don't show loading state - use them immediately
        if (!hasCachedSettings) {
          set({ isLoading: true, error: null });
        }
        
        try {
          // Create a timeout promise
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 3000)
          );
          
          // Try to fetch from backend with timeout
          const headers = await getAuthHeaders();
            const fetchPromise = fetch(`${API_BASE_URL}/api/v1/users/${userId}/settings`, {
            headers,
          });
          
          try {
            const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
            
            if (response?.ok) {
              const data = await response.json();
              if (data.data?.settings) {
                const mergedSettings = normalizeUserSettings(data.data.settings);
                // Overlay low-data from slim prefs without clobbering system theme.
                try {
                  const prefs = await fetchUserPreferences(userId);
                  if (prefs) {
                    const lowDataMode =
                      prefs.lowDataMode ??
                      (prefs.preferences?.lowDataMode as boolean | undefined) ??
                      mergedSettings.appearance.lowDataMode;
                    set({
                      settings: {
                        ...mergedSettings,
                        appearance: {
                          ...mergedSettings.appearance,
                          lowDataMode: Boolean(lowDataMode),
                        },
                      },
                      isLoading: false,
                      hasUnsyncedChanges: false,
                    });
                    return;
                  }
                } catch {
                  // Preferences are optional
                }
                set({ 
                  settings: mergedSettings,
                  isLoading: false,
                  hasUnsyncedChanges: false,
                });
                return;
              }
            }
          } catch {
            // API failed or timed out, fall through to Supabase
          }
          
          // Fallback: try to load from Supabase directly
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('settings')
            .eq('id', userId)
            .single();
          
          if (!error && profile?.settings) {
            const mergedSettings = normalizeUserSettings(profile.settings);
            set({ 
              settings: mergedSettings,
              isLoading: false,
              hasUnsyncedChanges: false,
            });
          } else {
            // Use defaults/cached if nothing found
            set({ isLoading: false });
          }

          // Load cross-platform preferences (theme + low data mode)
          try {
            const prefs = await fetchUserPreferences(userId);
            if (prefs) {
              const { settings: current } = get();
              const themePreference = prefs.preferences?.themePreference;
              const resolvedTheme =
                themePreference === 'system' || themePreference === 'light' || themePreference === 'dark'
                  ? themePreference
                  : current.appearance.theme === 'system'
                    ? 'system'
                    : prefs.theme === 'light'
                      ? 'light'
                      : prefs.theme === 'dark'
                        ? 'dark'
                        : current.appearance.theme;
              const lowDataMode =
                prefs.lowDataMode ??
                (prefs.preferences?.lowDataMode as boolean | undefined) ??
                current.appearance.lowDataMode;
              set({
                settings: {
                  ...current,
                  appearance: {
                    ...current.appearance,
                    theme: resolvedTheme,
                    lowDataMode: Boolean(lowDataMode),
                  },
                },
              });
            }
          } catch {
            // Preferences are optional
          }
        } catch (error: any) {
          console.error('Failed to load settings:', error);
          // Don't show error if we have cached settings
          set({ 
            error: hasCachedSettings ? null : error.message,
            isLoading: false,
          });
        }
      },
      
      updateSettings: async (category, updates) => {
        const { settings } = get();
        const newSettings = mergeSettingsCategory(settings, category, updates as Partial<UserSettings[typeof category]>);
        
        set({ 
          settings: newSettings,
          hasUnsyncedChanges: true,
        });
        
        // Auto-sync if enabled (with debounce)
        if (settings.sync.autoSync && currentUserId) {
          // Clear existing timer
          if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
          }
          // Set new debounced sync
          syncDebounceTimer = setTimeout(() => {
            get().syncSettings(currentUserId!).catch(() => {});
          }, SYNC_DEBOUNCE_MS);
        }
      },
      
      updateSingleSetting: async (category, key, value) => {
        const { settings } = get();
        const newSettings = mergeSettingsCategory(settings, category, {
          [key]: value,
        } as Partial<UserSettings[typeof category]>);
        
        set({ 
          settings: newSettings,
          hasUnsyncedChanges: true,
        });

        if (
          category === 'notifications' &&
          key === 'pushEnabled' &&
          value === false &&
          currentUserId
        ) {
          void clearPushToken();
        }
        
        // Auto-sync if enabled (with debounce)
        if (settings.sync.autoSync && currentUserId) {
          // Clear existing timer
          if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
          }
          // Set new debounced sync
          syncDebounceTimer = setTimeout(() => {
            get().syncSettings(currentUserId!).catch(() => {});
          }, SYNC_DEBOUNCE_MS);
        }
      },
      
      syncSettings: async (userId: string) => {
        const { settings, isSyncing } = get();
        
        // Use stored userId if not provided
        const effectiveUserId = userId || currentUserId;
        
        if (isSyncing) return;

        const allowed = await canSyncNow(settings);
        if (!allowed) {
          set({ isSyncing: false });
          return;
        }
        
        try {
          set({ isSyncing: true, error: null });
          
          // Try API first
          const headers = await getAuthHeaders();
          const response = await fetch(`${API_BASE_URL}/api/v1/users/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ settings }),
          }).catch(() => null);
          
          if (response?.ok) {
            // Sync cross-platform preferences (resolved theme column + canonical themePreference)
            try {
              const resolvedTheme =
                settings.appearance.theme === 'system' ? 'light' : settings.appearance.theme;
              await saveUserPreferences(userId, {
                theme: resolvedTheme,
                lowDataMode: settings.appearance.lowDataMode,
                themePreference: settings.appearance.theme,
              });
            } catch {
              // Non-blocking
            }

            set({ 
              isSyncing: false,
              hasUnsyncedChanges: false,
              settings: {
                ...settings,
                sync: {
                  ...settings.sync,
                  lastSyncTime: new Date().toISOString(),
                },
              },
            });
            return;
          }
          
          // Fallback: direct Supabase update
          if (effectiveUserId) {
            const { error } = await supabase
              .from('profiles')
              .update({ settings })
              .eq('id', effectiveUserId);
            
            if (!error) {
              try {
                const resolvedTheme =
                  settings.appearance.theme === 'system' ? 'light' : settings.appearance.theme;
                await saveUserPreferences(effectiveUserId, {
                  theme: resolvedTheme,
                  lowDataMode: settings.appearance.lowDataMode,
                  themePreference: settings.appearance.theme,
                });
              } catch {
                // Non-blocking
              }

              set({ 
                isSyncing: false,
                hasUnsyncedChanges: false,
                settings: {
                  ...settings,
                  sync: {
                    ...settings.sync,
                    lastSyncTime: new Date().toISOString(),
                  },
                },
              });
              return;
            }
          }
          
          // Save locally even if sync fails
          set({ isSyncing: false });
        } catch (error: any) {
          console.error('Failed to sync settings:', error);
          set({ 
            error: error.message,
            isSyncing: false,
          });
        }
      },
      
      resetToDefaults: async () => {
        set({ 
          settings: {
            ...DEFAULT_SETTINGS,
            updatedAt: new Date().toISOString(),
          },
          hasUnsyncedChanges: true,
        });
      },
      
      clearError: () => set({ error: null }),
    }),
    {
      name: 'lantern-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Export convenience hooks for specific settings categories
export const useNotificationSettings = () => 
  useSettingsStore(state => state.settings.notifications);

export const useStudySettings = () => 
  useSettingsStore(state => state.settings.study);

export const useAppearanceSettings = () => 
  useSettingsStore(state => state.settings.appearance);

export const usePrivacySettings = () => 
  useSettingsStore(state => state.settings.privacy);

export const useAccessibilitySettings = () => 
  useSettingsStore(state => state.settings.accessibility);

export const useSyncSettings = () => 
  useSettingsStore(state => state.settings.sync);
