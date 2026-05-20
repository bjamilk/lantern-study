/**
 * Settings Store
 * Manages user settings with sync to Supabase backend
 * Settings are shared between web and mobile apps
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, API_BASE_URL, getAuthHeaders } from '../services/supabase';

// Debounce timer for auto-sync
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 2000; // Wait 2 seconds after last change before syncing

// Store current user ID for auto-sync
let currentUserId: string | null = null;

// ============================================
// TYPES - Shared with Web App
// ============================================

export interface NotificationSettings {
  // Push Notifications
  pushEnabled: boolean;
  dailyReminder: boolean;
  reminderTime: string; // HH:mm format
  groupActivity: boolean;
  marketplaceUpdates: boolean;
  badgeUnlocks: boolean;
  srsReminders: boolean;
  testResults: boolean;
  
  // Email Notifications
  emailEnabled: boolean;
  weeklyDigest: boolean;
  groupInvites: boolean;
}

export interface StudySettings {
  // Daily Goals
  dailyCardGoal: number;
  dailyTestGoal: number;
  
  // SRS Settings
  srsNewCardsPerDay: number;
  srsEasyBonus: number; // multiplier (e.g., 1.3)
  srsIntervalModifier: number; // percentage (e.g., 100)
  srsMaxInterval: number; // days
  
  // Test Settings
  defaultTestMode: 'study' | 'exam';
  showExplanationsImmediately: boolean;
  autoAdvanceDelay: number; // seconds, 0 = manual
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  
  // Review Settings
  autoPlayAudio: boolean;
  showCardProgress: boolean;
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  showAnimations: boolean;
}

export interface PrivacySettings {
  profileVisibility: 'public' | 'groups' | 'private';
  showOnlineStatus: boolean;
  showStudyActivity: boolean;
  allowDirectMessages: 'everyone' | 'groups' | 'none';
}

export interface AccessibilitySettings {
  reduceMotion: boolean;
  highContrast: boolean;
  screenReaderOptimized: boolean;
  hapticFeedback: boolean;
}

export interface SyncSettings {
  autoSync: boolean;
  syncOnWifiOnly: boolean;
  lastSyncTime: string | null;
  syncConflictResolution: 'local' | 'remote' | 'ask';
}

export interface UserSettings {
  notifications: NotificationSettings;
  study: StudySettings;
  appearance: AppearanceSettings;
  privacy: PrivacySettings;
  accessibility: AccessibilitySettings;
  sync: SyncSettings;
  
  // Metadata
  version: number;
  updatedAt: string;
}

// ============================================
// DEFAULT SETTINGS
// ============================================

export const DEFAULT_SETTINGS: UserSettings = {
  notifications: {
    pushEnabled: true,
    dailyReminder: true,
    reminderTime: '20:00',
    groupActivity: true,
    marketplaceUpdates: true,
    badgeUnlocks: true,
    srsReminders: true,
    testResults: true,
    emailEnabled: true,
    weeklyDigest: true,
    groupInvites: true,
  },
  study: {
    dailyCardGoal: 20,
    dailyTestGoal: 1,
    srsNewCardsPerDay: 10,
    srsEasyBonus: 1.3,
    srsIntervalModifier: 100,
    srsMaxInterval: 365,
    defaultTestMode: 'study',
    showExplanationsImmediately: true,
    autoAdvanceDelay: 0,
    shuffleQuestions: true,
    shuffleOptions: true,
    autoPlayAudio: false,
    showCardProgress: true,
  },
  appearance: {
    theme: 'dark',
    accentColor: '#6366f1',
    fontSize: 'medium',
    compactMode: false,
    showAnimations: true,
  },
  privacy: {
    profileVisibility: 'groups',
    showOnlineStatus: true,
    showStudyActivity: true,
    allowDirectMessages: 'groups',
  },
  accessibility: {
    reduceMotion: false,
    highContrast: false,
    screenReaderOptimized: false,
    hapticFeedback: true,
  },
  sync: {
    autoSync: true,
    syncOnWifiOnly: false,
    lastSyncTime: null,
    syncConflictResolution: 'remote',
  },
  version: 1,
  updatedAt: new Date().toISOString(),
};

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
          const fetchPromise = fetch(`${API_BASE_URL}/api/users/${userId}/settings`, {
            headers,
          });
          
          try {
            const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
            
            if (response?.ok) {
              const data = await response.json();
              if (data.data?.settings) {
                // Merge with defaults to ensure all new fields exist
                const mergedSettings = deepMerge(DEFAULT_SETTINGS, data.data.settings);
                set({ 
                  settings: mergedSettings,
                  isLoading: false,
                  hasUnsyncedChanges: false,
                });
                return;
              }
            }
          } catch (fetchError) {
            // API failed or timed out, try Supabase
            console.log('API fetch failed, trying Supabase directly');
          }
          
          // Fallback: try to load from Supabase directly
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('settings')
            .eq('id', userId)
            .single();
          
          if (!error && profile?.settings) {
            const mergedSettings = deepMerge(DEFAULT_SETTINGS, profile.settings);
            set({ 
              settings: mergedSettings,
              isLoading: false,
              hasUnsyncedChanges: false,
            });
          } else {
            // Use defaults/cached if nothing found
            set({ isLoading: false });
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
        
        const categorySettings = settings[category] as Record<string, any>;
        const updatedCategory = { ...categorySettings, ...(updates as Record<string, any>) };
        
        const newSettings: UserSettings = {
          ...settings,
          [category]: updatedCategory,
          updatedAt: new Date().toISOString(),
        };
        
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
        
        const categorySettings = settings[category] as Record<string, any>;
        const updatedCategory = { ...categorySettings, [key]: value };
        
        const newSettings: UserSettings = {
          ...settings,
          [category]: updatedCategory,
          updatedAt: new Date().toISOString(),
        };
        
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
      
      syncSettings: async (userId: string) => {
        const { settings, isSyncing } = get();
        
        // Use stored userId if not provided
        const effectiveUserId = userId || currentUserId;
        
        if (isSyncing) return;
        
        try {
          set({ isSyncing: true, error: null });
          
          // Try API first
          const headers = await getAuthHeaders();
          const response = await fetch(`${API_BASE_URL}/api/users/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ settings }),
          }).catch(() => null);
          
          if (response?.ok) {
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

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        (result as any)[key] = deepMerge(
          target[key] as object,
          source[key] as object
        );
      } else {
        (result as any)[key] = source[key];
      }
    }
  }
  
  return result;
}

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
