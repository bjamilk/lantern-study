/**
 * Settings Store
 * Manages user settings with sync to the API (CAS + category patches).
 * Settings are shared between web and mobile apps.
 *
 * Persistence is user-scoped (`lantern-settings:${userId}`) so pending
 * patches from User A cannot sync onto User B after account switch.
 *
 * Main exports: `useSettingsStore`, `DEFAULT_SETTINGS`, the per-category
 * hooks (`useNotificationSettings`, `useStudySettings`,
 * `useAppearanceSettings`, `usePrivacySettings`, `useAccessibilitySettings`,
 * `useSyncSettings`) and the matching types.
 *
 * Touches: AsyncStorage via zustand `persist`, services/api
 * (`fetchUserPreferences`, `saveUserPreferences`), services/supabase for the
 * auth headers, NetInfo for the flush trigger, and
 * services/pushNotifications (`clearPushToken`) when notifications go off.
 *
 * Gotchas: edits accumulate in `pendingPatch` and are flushed as a
 * compare-and-set write, so a rejected CAS merges the server copy back in
 * rather than overwriting it — never write `settings` straight to the server
 * from elsewhere. The flush is also driven by a module-level NetInfo listener
 * and honours the student's sync-on-wifi-only preference, so an edit can sit
 * unsynced indefinitely on cellular. Migration from the old unscoped key
 * carries `pendingPatch` forward only when the current one is empty.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, getAuthHeaders } from '../services/supabase';
import { fetchUserPreferences, saveUserPreferences } from '../services/api';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
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
  resolveSettingsAfterSync,
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

/** Legacy unscoped key — cleared on logout / migrated away on load. */
export const LEGACY_SETTINGS_STORAGE_KEY = 'lantern-settings';
export const settingsStorageKey = (userId: string) => `lantern-settings:${userId}`;

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
let networkFlushUnsubscribe: (() => void) | null = null;

async function wifiAllowsSync(settings: UserSettings): Promise<boolean> {
  if (!settings.sync.syncOnWifiOnly) return true;
  const state = await NetInfo.fetch();
  return state.type === 'wifi' && state.isConnected === true;
}

function scheduleAutoSync(get: () => SettingsState) {
  if (!currentUserId) return;
  const { settings, ownerUserId } = get();
  if (ownerUserId && ownerUserId !== currentUserId) return;
  if (!settings.sync.autoSync) return;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    get().syncSettings(currentUserId!).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

function networkStateAllowsFlush(state: NetInfoState, settings: UserSettings): boolean {
  if (state.isConnected !== true) return false;
  if (!settings.sync.syncOnWifiOnly) return true;
  return state.type === 'wifi';
}

/** Flush deferred pending sync when connectivity / Wi‑Fi returns. */
function ensureSettingsNetworkFlushListener() {
  if (networkFlushUnsubscribe) return;
  networkFlushUnsubscribe = NetInfo.addEventListener((state) => {
    const userId = currentUserId;
    if (!userId) return;
    const store = useSettingsStore.getState();
    if (store.ownerUserId && store.ownerUserId !== userId) return;
    if (!store.hasUnsyncedChanges && Object.keys(store.pendingPatch).length === 0) return;
    if (store.isSyncing) return;
    if (!networkStateAllowsFlush(state, store.settings)) return;
    void store.syncSettings(userId, { force: true });
  });
}

async function bindPersistToUser(userId: string): Promise<void> {
  const name = settingsStorageKey(userId);
  const persistApi = useSettingsStore.persist;
  if (persistApi.getOptions().name !== name) {
    persistApi.setOptions({ name });
    await persistApi.rehydrate();
  }

  // One-time migration from legacy global key into the user-scoped key.
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacyRaw) {
      const current = useSettingsStore.getState();
      const scopedEmpty =
        !current.ownerUserId &&
        Object.keys(current.pendingPatch).length === 0 &&
        !current.hasUnsyncedChanges &&
        current.settings.updatedAt === DEFAULT_SETTINGS.updatedAt;
      if (scopedEmpty) {
        const parsed = JSON.parse(legacyRaw) as { state?: Partial<SettingsState> };
        const legacyState = parsed?.state;
        if (legacyState?.settings) {
          useSettingsStore.setState({
            settings: normalizeUserSettings(legacyState.settings),
            settingsVersion:
              typeof legacyState.settingsVersion === 'number'
                ? legacyState.settingsVersion
                : null,
            pendingPatch: (legacyState.pendingPatch as UserSettingsPatch) ?? {},
            hasUnsyncedChanges: Boolean(legacyState.hasUnsyncedChanges),
            ownerUserId: userId,
          });
        }
      }
      await AsyncStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY).catch(() => {});
    }
  } catch {
    // Migration is best-effort.
  }
}

function resetInMemorySettings() {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  currentUserId = null;
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    settingsVersion: null,
    pendingPatch: {},
    isLoading: false,
    isSyncing: false,
    error: null,
    hasUnsyncedChanges: false,
    ownerUserId: null,
  });
}

/**
 * Clear settings memory + AsyncStorage keys on sign-out.
 * Removes both the active user-scoped key and the legacy global key.
 */
export async function clearLocalSettings(userId?: string | null): Promise<void> {
  const id = userId ?? currentUserId ?? useSettingsStore.getState().ownerUserId;
  resetInMemorySettings();
  const keys = [LEGACY_SETTINGS_STORAGE_KEY];
  if (id) keys.push(settingsStorageKey(id));
  await AsyncStorage.multiRemove(keys).catch(() => {});
  try {
    useSettingsStore.persist.setOptions({ name: LEGACY_SETTINGS_STORAGE_KEY });
  } catch {
    // ignore
  }
}

// ============================================
// STORE INTERFACE
// ============================================

interface SettingsState {
  settings: UserSettings;
  settingsVersion: number | null;
  /** Accumulated local category patches awaiting a successful sync. */
  pendingPatch: UserSettingsPatch;
  /** User id that owns the cached settings / pending patch. */
  ownerUserId: string | null;
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
      ownerUserId: null,
      isLoading: false,
      isSyncing: false,
      error: null,
      hasUnsyncedChanges: false,

      loadSettings: async (userId: string) => {
        currentUserId = userId;
        ensureSettingsNetworkFlushListener();
        await bindPersistToUser(userId);

        const state = get();
        // Refuse to keep another user's pending patches in memory.
        if (state.ownerUserId && state.ownerUserId !== userId) {
          set({
            settings: DEFAULT_SETTINGS,
            settingsVersion: null,
            pendingPatch: {},
            hasUnsyncedChanges: false,
            ownerUserId: userId,
            error: null,
          });
        } else if (!state.ownerUserId) {
          set({ ownerUserId: userId });
        }

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
                      ownerUserId: userId,
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
                  ownerUserId: userId,
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
          set({ ownerUserId: userId, isLoading: false });
        } catch (error: any) {
          console.error('Failed to load settings:', error);
          set({
            error: hasCachedSettings ? null : error.message,
            ownerUserId: userId,
            isLoading: false,
          });
        }
      },

      updateSettings: async (category, updates) => {
        const { settings, pendingPatch, ownerUserId } = get();
        if (ownerUserId && currentUserId && ownerUserId !== currentUserId) {
          return;
        }
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
          ownerUserId: currentUserId ?? ownerUserId,
        });

        scheduleAutoSync(get);
      },

      updateSingleSetting: async (category, key, value) => {
        const { settings, pendingPatch, ownerUserId } = get();
        if (ownerUserId && currentUserId && ownerUserId !== currentUserId) {
          return;
        }
        const updates = { [key]: value } as Partial<UserSettings[typeof category]>;
        const newSettings = mergeSettingsCategory(settings, category, updates);
        const nextPatch = mergeSettingsPatches(pendingPatch, {
          [category]: updates,
        } as UserSettingsPatch);

        set({
          settings: newSettings,
          pendingPatch: nextPatch,
          hasUnsyncedChanges: true,
          ownerUserId: currentUserId ?? ownerUserId,
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
        const { settings, isSyncing, pendingPatch, hasUnsyncedChanges, ownerUserId } = get();
        const effectiveUserId = userId || currentUserId;

        if (isSyncing) return 'skipped';
        if (!effectiveUserId) return 'failed';

        // Refuse sync if cached/pending settings belong to a different user.
        if (ownerUserId && ownerUserId !== effectiveUserId) {
          set({
            error: 'Settings cache belongs to another account. Reload after sign-in.',
            isSyncing: false,
          });
          return 'failed';
        }

        // Manual sync may run even when autoSync is off; still respect Wi‑Fi-only.
        if (!force && !settings.sync.autoSync && !hasUnsyncedChanges) {
          return 'skipped';
        }
        const wifiOk = await wifiAllowsSync(settings);
        if (!wifiOk) {
          set({ isSyncing: false });
          return 'deferred';
        }

        // Snapshot only the pending patch we are about to send so mid-flight
        // edits accumulated while isSyncing are retained after success.
        const sentPending: UserSettingsPatch = mergeSettingsPatches({}, pendingPatch);
        const patchToSend =
          Object.keys(pendingPatch).length > 0
            ? pendingPatch
            : (settings as unknown as UserSettingsPatch);

        try {
          set({ isSyncing: true, error: null, ownerUserId: effectiveUserId });

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
              const pendingForRetry = get().pendingPatch;
              const rebased = applySettingsPatch(remoteSettings, pendingForRetry);
              const retry = await fetch(`${API_BASE_URL}/api/v1/users/settings`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  settings: pendingForRetry,
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

                // Drop only the patch that was sent on retry; keep mid-flight edits.
                const sentForRetry: UserSettingsPatch = mergeSettingsPatches(
                  {},
                  pendingForRetry
                );
                const resolved = resolveSettingsAfterSync({
                  authoritative,
                  pendingAfterSync: get().pendingPatch,
                  sentPending: sentForRetry,
                });

                set({
                  isSyncing: false,
                  hasUnsyncedChanges: resolved.hasUnsyncedChanges,
                  pendingPatch: resolved.pendingPatch,
                  settingsVersion: nextVersion,
                  settings: resolved.settings,
                  ownerUserId: effectiveUserId,
                  error: null,
                });
                if (resolved.hasUnsyncedChanges) {
                  scheduleAutoSync(get);
                }
                return 'synced';
              }

              set({
                settings: rebased,
                settingsVersion: remoteVersion,
                isSyncing: false,
                hasUnsyncedChanges: Object.keys(get().pendingPatch).length > 0,
                ownerUserId: effectiveUserId,
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

            const resolved = resolveSettingsAfterSync({
              authoritative,
              pendingAfterSync: get().pendingPatch,
              sentPending,
            });

            set({
              isSyncing: false,
              hasUnsyncedChanges: resolved.hasUnsyncedChanges,
              pendingPatch: resolved.pendingPatch,
              settingsVersion: nextVersion,
              settings: resolved.settings,
              ownerUserId: effectiveUserId,
              error: null,
            });
            if (resolved.hasUnsyncedChanges) {
              scheduleAutoSync(get);
            }
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
          ownerUserId: currentUserId ?? get().ownerUserId,
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: LEGACY_SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        settings: state.settings,
        settingsVersion: state.settingsVersion,
        pendingPatch: state.pendingPatch,
        hasUnsyncedChanges: state.hasUnsyncedChanges,
        ownerUserId: state.ownerUserId,
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
