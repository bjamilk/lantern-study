/**
 * Settings Store
 * Manages user settings with sync to the API (CAS + category patches).
 * Settings are shared between web and mobile apps.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, getAuthHeaders } from '../services/supabase';
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
  type UserSettingsPatch,
  DEFAULT_USER_SETTINGS,
  mergeSettingsCategory,
  normalizeUserSettings,
  applySettingsPatch,
  mergeSettingsPatches,
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

export type SettingsSyncResult =
  | 'synced'
  | 'deferred'
  | 'conflict'
  | 'failed'
  | 'skipped';

// Debounce timer for auto-sync
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 2000;
let currentUserId: string | null = null;

async function wifiAllowsSync(settings: UserSettings): Promise<boolean> {
  if (!settings.sync.syncOnWifiOnly) return true;
  const state = await NetInfo.fetch();
  return state.type === 'wifi' && state.isConnected === true;
}

function scheduleAutoSync(get: () => SettingsState) {
  if (!currentUserId) return;
  const { settings } = get();
  if (!settings.sync.autoSync) return;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    get().syncSettings(currentUserId!).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

// ============================================
// STORE INTERFACE
// ============================================

interface SettingsState {
  settings: UserSettings;
  settingsVersion: number | null;
  /** Accumulated local category patches awaiting a successful sync. */
  pendingPatch: UserSettingsPatch;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  hasUnsyncedChanges: boolean;

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
  syncSettings: (userId: string, options?: { force?: boolean }) => Promise<SettingsSyncResult>;
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
      settingsVersion: null,
      pendingPatch: {},
      isLoading: false,
      isSyncing: false,
      error: null,
      hasUnsyncedChanges: false,

      loadSettings: async (userId: string) => {
        currentUserId = userId;

        const cachedSettings = get().settings;
        const hasCachedSettings = cachedSettings.updatedAt !== DEFAULT_SETTINGS.updatedAt;
        const localPending = get().pendingPatch;
        const hasUnsynced = get().hasUnsyncedChanges || Object.keys(localPending).length > 0;

        if (!hasCachedSettings) {
          set({ isLoading: true, error: null });
        }

        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 3000)
          );

          const headers = await getAuthHeaders();
          const fetchPromise = fetch(`${API_BASE_URL}/api/v1/users/${userId}/settings`, {
            headers,
          });

          try {
            const response = (await Promise.race([fetchPromise, timeoutPromise])) as Response;

            if (response?.ok) {
              const data = await response.json();
              if (data.data?.settings) {
                const remoteSettings = normalizeUserSettings(data.data.settings);
                const settingsVersion =
                  typeof data.data.settingsVersion === 'number'
                    ? data.data.settingsVersion
                    : null;

                // Prefer remote, then re-apply any unsynced local patch so edits survive reload.
                const mergedSettings = hasUnsynced
                  ? applySettingsPatch(remoteSettings, localPending)
                  : remoteSettings;

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
                      settingsVersion,
                      isLoading: false,
                      // Keep dirty flag if we still have a pending patch.
                      hasUnsyncedChanges: hasUnsynced,
                    });
                    return;
                  }
                } catch {
                  // Preferences are optional
                }

                set({
                  settings: mergedSettings,
                  settingsVersion,
                  isLoading: false,
                  hasUnsyncedChanges: hasUnsynced,
                });
                return;
              }
            }
          } catch {
            // API failed or timed out — keep local cache + pending patch.
          }

          // Offline / API down: keep cached settings; do not clear unsynced state.
          set({ isLoading: false });
        } catch (error: any) {
          console.error('Failed to load settings:', error);
          set({
            error: hasCachedSettings ? null : error.message,
            isLoading: false,
          });
        }
      },

      updateSettings: async (category, updates) => {
        const { settings, pendingPatch } = get();
        const newSettings = mergeSettingsCategory(
          settings,
          category,
          updates as Partial<UserSettings[typeof category]>
        );
        const nextPatch = mergeSettingsPatches(pendingPatch, {
          [category]: updates,
        } as UserSettingsPatch);

        set({
          settings: newSettings,
          pendingPatch: nextPatch,
          hasUnsyncedChanges: true,
        });

        scheduleAutoSync(get);
      },

      updateSingleSetting: async (category, key, value) => {
        const { settings, pendingPatch } = get();
        const updates = { [key]: value } as Partial<UserSettings[typeof category]>;
        const newSettings = mergeSettingsCategory(settings, category, updates);
        const nextPatch = mergeSettingsPatches(pendingPatch, {
          [category]: updates,
        } as UserSettingsPatch);

        set({
          settings: newSettings,
          pendingPatch: nextPatch,
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

        scheduleAutoSync(get);
      },

      syncSettings: async (userId: string, options) => {
        const force = options?.force === true;
        const { settings, isSyncing, pendingPatch, hasUnsyncedChanges } = get();
        const effectiveUserId = userId || currentUserId;

        if (isSyncing) return 'skipped';
        if (!effectiveUserId) return 'failed';

        // Manual sync may run even when autoSync is off; still respect Wi‑Fi-only.
        if (!force && !settings.sync.autoSync && !hasUnsyncedChanges) {
          return 'skipped';
        }
        const wifiOk = await wifiAllowsSync(settings);
        if (!wifiOk) {
          set({ isSyncing: false });
          return 'deferred';
        }

        const patchToSend =
          Object.keys(pendingPatch).length > 0
            ? pendingPatch
            : (settings as unknown as UserSettingsPatch);

        try {
          set({ isSyncing: true, error: null });

          const headers = await getAuthHeaders();
          const expectedSettingsVersion = get().settingsVersion;
          const response = await fetch(`${API_BASE_URL}/api/v1/users/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              settings: patchToSend,
              ...(expectedSettingsVersion != null
                ? { expectedSettingsVersion }
                : {}),
            }),
          }).catch(() => null);

          if (response?.status === 409) {
            const conflictBody = await response.json().catch(() => ({}));
            const conflictData = conflictBody?.data;
            const remoteSettings = conflictData?.settings
              ? normalizeUserSettings(conflictData.settings)
              : null;
            const remoteVersion =
              typeof conflictData?.settingsVersion === 'number'
                ? conflictData.settingsVersion
                : null;

            if (remoteSettings) {
              // Rebase pending local patch onto server state and retry once.
              const rebased = applySettingsPatch(remoteSettings, pendingPatch);
              const retry = await fetch(`${API_BASE_URL}/api/v1/users/settings`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  settings: pendingPatch,
                  ...(remoteVersion != null
                    ? { expectedSettingsVersion: remoteVersion }
                    : {}),
                }),
              }).catch(() => null);

              if (retry?.ok) {
                const body = await retry.json().catch(() => ({}));
                const nextVersion =
                  typeof body?.data?.settingsVersion === 'number'
                    ? body.data.settingsVersion
                    : remoteVersion != null
                      ? remoteVersion + 1
                      : get().settingsVersion;
                const authoritative = body?.data?.settings
                  ? normalizeUserSettings(body.data.settings)
                  : rebased;

                try {
                  const resolvedTheme =
                    authoritative.appearance.theme === 'system'
                      ? 'light'
                      : authoritative.appearance.theme;
                  await saveUserPreferences(effectiveUserId, {
                    theme: resolvedTheme,
                    lowDataMode: authoritative.appearance.lowDataMode,
                    themePreference: authoritative.appearance.theme,
                  });
                } catch {
                  // Non-blocking
                }

                set({
                  isSyncing: false,
                  hasUnsyncedChanges: false,
                  pendingPatch: {},
                  settingsVersion: nextVersion,
                  settings: {
                    ...authoritative,
                    sync: {
                      ...authoritative.sync,
                      lastSyncTime: new Date().toISOString(),
                    },
                  },
                  error: null,
                });
                return 'synced';
              }

              set({
                settings: rebased,
                settingsVersion: remoteVersion,
                isSyncing: false,
                hasUnsyncedChanges: Object.keys(pendingPatch).length > 0,
                error: 'Settings were updated on another device. Reloaded latest.',
              });
              return 'conflict';
            }

            await get().loadSettings(effectiveUserId);
            set({
              isSyncing: false,
              error: 'Settings were updated on another device. Reloaded latest.',
            });
            return 'conflict';
          }

          if (response?.ok) {
            const body = await response.json().catch(() => ({}));
            const nextVersion =
              typeof body?.data?.settingsVersion === 'number'
                ? body.data.settingsVersion
                : expectedSettingsVersion != null
                  ? expectedSettingsVersion + 1
                  : get().settingsVersion;
            const authoritative = body?.data?.settings
              ? normalizeUserSettings(body.data.settings)
              : settings;

            try {
              const resolvedTheme =
                authoritative.appearance.theme === 'system'
                  ? 'light'
                  : authoritative.appearance.theme;
              await saveUserPreferences(effectiveUserId, {
                theme: resolvedTheme,
                lowDataMode: authoritative.appearance.lowDataMode,
                themePreference: authoritative.appearance.theme,
              });
            } catch {
              // Non-blocking
            }

            set({
              isSyncing: false,
              hasUnsyncedChanges: false,
              pendingPatch: {},
              settingsVersion: nextVersion,
              settings: {
                ...authoritative,
                sync: {
                  ...authoritative.sync,
                  lastSyncTime: new Date().toISOString(),
                },
              },
              error: null,
            });
            return 'synced';
          }

          // Keep local pending changes; do not fall back to direct Supabase full replace.
          set({
            isSyncing: false,
            hasUnsyncedChanges: true,
            error: 'Could not sync settings. Changes are saved on this device.',
          });
          return 'failed';
        } catch (error: any) {
          console.error('Failed to sync settings:', error);
          set({
            error: error.message,
            isSyncing: false,
            hasUnsyncedChanges: true,
          });
          return 'failed';
        }
      },

      resetToDefaults: async () => {
        const reset = {
          ...DEFAULT_SETTINGS,
          updatedAt: new Date().toISOString(),
        };
        set({
          settings: reset,
          pendingPatch: reset as unknown as UserSettingsPatch,
          hasUnsyncedChanges: true,
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'lantern-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        settings: state.settings,
        settingsVersion: state.settingsVersion,
        pendingPatch: state.pendingPatch,
        hasUnsyncedChanges: state.hasUnsyncedChanges,
      }),
    }
  )
);

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getSettingsSnapshot(): UserSettings {
  return useSettingsStore.getState().settings;
}

export const useNotificationSettings = () =>
  useSettingsStore((state) => state.settings.notifications);

export const useStudySettings = () =>
  useSettingsStore((state) => state.settings.study);

export const useAppearanceSettings = () =>
  useSettingsStore((state) => state.settings.appearance);

export const usePrivacySettings = () =>
  useSettingsStore((state) => state.settings.privacy);

export const useAccessibilitySettings = () =>
  useSettingsStore((state) => state.settings.accessibility);

export const useSyncSettings = () =>
  useSettingsStore((state) => state.settings.sync);
