import { useState, useCallback } from 'react';
import { User, TestPreset, TestConfig } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useStudyGoalsStore } from '../stores/studyGoalsStore';
import { useAcademicStore } from '../stores/academicStore';
import { useLibraryStore } from '../stores/libraryStore';
import { MOCK_USERS } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import {
    updateUserProfile,
    saveUserPreferences,
    saveUserSettingsDetailed,
    updateAuthPassword,
    supabase,
    apiLogoutSession,
    deactivateUserAccount,
    deleteUserAccountImmediate,
    reactivateUserAccount,
    exportUserAccountData,
    importUserAccountBackup,
    hasValidSession,
} from '../services/supabase';
import {
    type UserSettings,
    DEFAULT_USER_SETTINGS,
    normalizeUserSettings,
    mergeSettingsCategory,
} from '@lantern/shared/settings';
import { syncCopy } from '@lantern/shared/design';
import { applyUserSettingsToDom } from '../utils/applyUserSettingsToDom';
import { useToastStore } from '../stores/toastStore';

/** Monotonic generation so a stale failed save cannot roll back a newer optimistic update. */
let settingsMutationGeneration = 0;
/** Debounce quiet "Settings saved" toasts so rapid study numeric edits don't spam. */
let settingsSavedToastTimer: ReturnType<typeof setTimeout> | null = null;

function notifySettingsSavedQuietly() {
    if (settingsSavedToastTimer) clearTimeout(settingsSavedToastTimer);
    settingsSavedToastTimer = setTimeout(() => {
        settingsSavedToastTimer = null;
        useToastStore.getState().showToast(syncCopy.settingsSaved, 'success');
    }, 600);
}

export type BootstrapDomain =
    | 'groups'
    | 'dms'
    | 'decks'
    | 'flashcards'
    | 'tests'
    | 'notifications'
    | 'preferences'
    | 'budget'
    | 'offline';

export type BootstrapDomainStatus = 'pending' | 'loaded' | 'error';

export type BootstrapLoadState = Record<BootstrapDomain, BootstrapDomainStatus>;

export const INITIAL_BOOTSTRAP_LOAD_STATE: BootstrapLoadState = {
    groups: 'pending',
    dms: 'pending',
    decks: 'pending',
    flashcards: 'pending',
    tests: 'pending',
    notifications: 'pending',
    preferences: 'pending',
    budget: 'pending',
    offline: 'pending',
};

export function useAuthHandlers() {
    const { currentUser, setCurrentUser, setAuthLoading } = useAuthStore();
    const { setGroups, setAllMessages, setDmThreads, setAllDirectMessages } = useGroupStore();
    const { theme, setTheme, setSelectedChat, setLowDataMode, lowDataMode } = useUIStore();

    const [users, setUsers] = useState<User[]>(MOCK_USERS);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [bootstrapLoad, setBootstrapLoad] = useState<BootstrapLoadState>(INITIAL_BOOTSTRAP_LOAD_STATE);

    const getUserSettings = useCallback((): UserSettings => {
        return normalizeUserSettings(currentUser?.settings);
    }, [currentUser?.settings]);

    const persistProfileUpdate = useCallback(async (updates: {
        name?: string;
        avatar_url?: string | null;
        phone?: string;
        test_presets?: any[];
    }) => {
        if (!currentUser) return false;
        if (!(await hasValidSession())) {
            console.warn('Skipping profile update because no valid session is available.');
            return false;
        }
        await updateUserProfile(currentUser.id, updates);
        return true;
    }, [currentUser]);

    const applySettingsToUi = useCallback((settings: UserSettings) => {
        applyUserSettingsToDom(settings, { setTheme, setLowDataMode });
    }, [setTheme, setLowDataMode]);

    const handleUpdateSettingsCategory = useCallback(<K extends keyof UserSettings>(
        category: K,
        updates: Partial<UserSettings[K]>
    ) => {
        if (!currentUser) return;
        const previousSettings = getUserSettings();
        const next = mergeSettingsCategory(previousSettings, category, updates);
        const mutationId = ++settingsMutationGeneration;
        // Optimistic UI — roll back only if this mutation is still the latest.
        setCurrentUser({ ...currentUser, settings: next });
        if (category === 'appearance' || category === 'accessibility') {
            applySettingsToUi(next);
        }
        void (async () => {
            if (!(await hasValidSession())) {
                if (mutationId === settingsMutationGeneration) {
                    const latest = useAuthStore.getState().currentUser;
                    if (latest?.id === currentUser.id) {
                        setCurrentUser({ ...latest, settings: previousSettings });
                    }
                    if (category === 'appearance' || category === 'accessibility') {
                        applySettingsToUi(previousSettings);
                    }
                    useToastStore.getState().showToast('Failed to save settings. Please try again.', 'error');
                }
                return;
            }
            // Send category patch only — server deep-merges onto latest CAS row.
            const result = await saveUserSettingsDetailed(currentUser.id, {
                [category]: updates,
            });
            if (!result.ok) {
                if (mutationId === settingsMutationGeneration) {
                    const latest = useAuthStore.getState().currentUser;
                    if (latest?.id === currentUser.id) {
                        const rollbackSettings = result.settings
                            ? normalizeUserSettings(result.settings)
                            : previousSettings;
                        setCurrentUser({ ...latest, settings: rollbackSettings });
                        if (category === 'appearance' || category === 'accessibility') {
                            applySettingsToUi(rollbackSettings);
                        }
                    }
                    const message = result.conflict
                        ? syncCopy.updatedOnAnotherDevice
                        : 'Failed to save settings. Please try again.';
                    useToastStore.getState().showToast(message, 'error');
                }
                return;
            }
            if (result.settings && mutationId === settingsMutationGeneration) {
                const latest = useAuthStore.getState().currentUser;
                if (latest?.id === currentUser.id) {
                    setCurrentUser({
                        ...latest,
                        settings: normalizeUserSettings(result.settings),
                    });
                }
            }
            // Quiet confirmation for study numeric saves (debounced); skip toggle spam.
            if (category === 'study' && mutationId === settingsMutationGeneration) {
                notifySettingsSavedQuietly();
            }
            if (category === 'appearance') {
                const appearance = result.settings
                    ? normalizeUserSettings(result.settings).appearance
                    : next.appearance;
                const resolvedTheme =
                    appearance.theme === 'system' ? theme : appearance.theme;
                void saveUserPreferences(currentUser.id, {
                    theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                    lowDataMode: appearance.lowDataMode,
                    themePreference: appearance.theme,
                }).catch(() => undefined);
            }
        })();
    }, [currentUser, getUserSettings, applySettingsToUi, setCurrentUser, theme]);

    const handleUpdateNotificationSettings = useCallback((
        updates: Partial<UserSettings['notifications']>
    ) => {
        handleUpdateSettingsCategory('notifications', updates);
    }, [handleUpdateSettingsCategory]);

    const handleUpdatePrivacySettings = useCallback((
        updates: Partial<UserSettings['privacy']>
    ) => {
        handleUpdateSettingsCategory('privacy', updates);
    }, [handleUpdateSettingsCategory]);

    const handleResetSettings = useCallback(async () => {
        if (!currentUser) return;
        if (!window.confirm('Reset all settings to defaults? Your study data will not be affected.')) {
            return;
        }
        const previous = currentUser;
        const reset = {
            ...DEFAULT_USER_SETTINGS,
            updatedAt: new Date().toISOString(),
        };
        const mutationId = ++settingsMutationGeneration;
        setCurrentUser({ ...currentUser, settings: reset });
        applySettingsToUi(reset);
        if (!(await hasValidSession())) {
            setCurrentUser(previous);
            applySettingsToUi(normalizeUserSettings(previous.settings));
            useToastStore.getState().showToast('Failed to reset settings. Please try again.', 'error');
            return;
        }
        const result = await saveUserSettingsDetailed(currentUser.id, reset);
        if (!result.ok) {
            if (mutationId === settingsMutationGeneration) {
                setCurrentUser(previous);
                applySettingsToUi(normalizeUserSettings(previous.settings));
            }
            useToastStore.getState().showToast('Failed to reset settings. Please try again.', 'error');
            return;
        }
        if (result.settings && mutationId === settingsMutationGeneration) {
            const authoritative = normalizeUserSettings(result.settings);
            setCurrentUser({ ...currentUser, settings: authoritative });
            applySettingsToUi(authoritative);
        }
        useToastStore.getState().showToast('Settings have been reset to defaults.', 'info');
    }, [currentUser, applySettingsToUi, setCurrentUser]);

    const toggleTheme = useCallback(async () => {
        const current = getUserSettings();
        const resolvedTheme = current.appearance.theme === 'system'
            ? theme
            : current.appearance.theme;
        const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        handleUpdateSettingsCategory('appearance', { theme: newTheme });
    }, [getUserSettings, theme, handleUpdateSettingsCategory]);

    const handleLogout = useCallback(async () => {
        await apiLogoutSession(); // also clears lastKnownSettingsVersion

        setCurrentUser(null);
        setGroups([]);
        setAllMessages({});
        setSelectedChat(null);
        setDmThreads([]);
        setAllDirectMessages({});
        setDataLoaded(false);
        setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
        useBudgetStore.getState().reset();
        useStudyGoalsStore.getState().reset();
        useAcademicStore.getState().reset();
        useLibraryStore.getState().reset();
    }, [setCurrentUser, setGroups, setAllMessages, setSelectedChat, setDmThreads, setAllDirectMessages]);

    const handleUpdateProfile = useCallback(async (name: string, phone: string): Promise<boolean> => {
        if (!currentUser) return false;
        const previous = currentUser;
        setCurrentUser({ ...currentUser, name, phoneNumber: phone });
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? { ...u, name, phoneNumber: phone } : u));
        try {
            const ok = await persistProfileUpdate({ name, phone });
            if (!ok) throw new Error('Profile persist failed');
            useToastStore.getState().showToast('Profile updated successfully.', 'info');
            return true;
        } catch (error) {
            console.error('Failed to update user profile:', error);
            setCurrentUser(previous);
            setUsers(prevUsers =>
                prevUsers.map((u) => (u.id === previous.id ? { ...u, name: previous.name, phoneNumber: previous.phoneNumber } : u))
            );
            useToastStore.getState().showToast('Failed to update profile. Please try again.', 'error');
            return false;
        }
    }, [currentUser, setCurrentUser, setUsers, persistProfileUpdate]);

    const handleUpdateCurrentUserAvatar = useCallback((avatarUrl: string) => {
        if (!currentUser) return;
        const previousAvatar = currentUser.avatarUrl;
        // Local UI update immediately. Persist only when clearing or setting a
        // non-data URL (POST /avatar already writes the DB for uploads).
        setCurrentUser({ ...currentUser, avatarUrl });
        setUsers((prevUsers) =>
          prevUsers.map((u) => (u.id === currentUser.id ? { ...u, avatarUrl } : u))
        );
        if (avatarUrl.startsWith('data:')) {
          console.error('Blocked local-only base64 avatar persist; use POST /users/:id/avatar');
          setCurrentUser({ ...currentUser, avatarUrl: previousAvatar });
          setUsers((prevUsers) =>
            prevUsers.map((u) => (u.id === currentUser.id ? { ...u, avatarUrl: previousAvatar } : u))
          );
          useToastStore.getState().showToast('Avatar upload failed. Please try again from Settings.', 'error');
          return;
        }
        void persistProfileUpdate({ avatar_url: avatarUrl || null }).then((ok) => {
          if (ok) return;
          const latest = useAuthStore.getState().currentUser;
          if (latest?.id === currentUser.id) {
            setCurrentUser({ ...latest, avatarUrl: previousAvatar });
          }
          setUsers((prevUsers) =>
            prevUsers.map((u) => (u.id === currentUser.id ? { ...u, avatarUrl: previousAvatar } : u))
          );
          useToastStore.getState().showToast('Failed to update avatar. Please try again.', 'error');
        }).catch((error) => {
          console.error('Failed to update user avatar:', error);
          const latest = useAuthStore.getState().currentUser;
          if (latest?.id === currentUser.id) {
            setCurrentUser({ ...latest, avatarUrl: previousAvatar });
          }
          setUsers((prevUsers) =>
            prevUsers.map((u) => (u.id === currentUser.id ? { ...u, avatarUrl: previousAvatar } : u))
          );
          useToastStore.getState().showToast('Failed to update avatar. Please try again.', 'error');
        });
    }, [currentUser, setCurrentUser, setUsers, persistProfileUpdate]);

    const handleUpdatePassword = useCallback(async (current: string, newPass: string): Promise<boolean> => {
        if (!currentUser?.email) {
            useToastStore.getState().showToast('Unable to change password for this account.', 'error');
            return false;
        }
        try {
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: current,
            });
            if (signInError) {
                useToastStore.getState().showToast('Current password is incorrect.', 'error');
                return false;
            }
            await updateAuthPassword(newPass);

            // A password change must not leave sessions alive on devices the
            // user may no longer control. The global revoke ends this session
            // too, so re-authenticate immediately with the new password —
            // the fresh token is issued after the cutoff and survives it.
            const { revokeOtherSessions } = await import('../services/supabase');
            const revoked = await revokeOtherSessions();
            if (revoked) {
                const { error: reAuthError } = await supabase.auth.signInWithPassword({
                    email: currentUser.email,
                    password: newPass,
                });
                if (reAuthError) {
                    // Sessions are revoked but this device could not refresh —
                    // safest outcome is a clean re-login rather than a zombie tab.
                    useToastStore.getState().showToast(
                        'Password updated. Please sign in again.',
                        'info'
                    );
                    return true;
                }
            }

            useToastStore.getState().showToast(
                revoked
                    ? 'Password updated. You have been signed out on other devices.'
                    : 'Password updated successfully.',
                'info'
            );
            return true;
        } catch (error) {
            console.error('Failed to update password:', error);
            useToastStore.getState().showToast(
                error instanceof Error ? error.message : 'Failed to update password.',
                'error'
            );
            return false;
        }
    }, [currentUser]);

    const handlePauseAccount = useCallback(async () => {
        if (!currentUser) return;
        await deactivateUserAccount(currentUser.id);
        setUsers((prev) => prev.filter((u) => u.id !== currentUser.id));
        // Clear local session even if server logout is blocked for paused accounts.
        try {
            await handleLogout();
        } catch (err) {
            console.warn('Logout after pause failed; clearing local session anyway.', err);
            setCurrentUser(null);
        }
    }, [currentUser, handleLogout, setCurrentUser, setUsers]);

    const handleDeleteAccountImmediate = useCallback(
        async (password: string) => {
            if (!currentUser) return;
            await deleteUserAccountImmediate(currentUser.id, password);
            setUsers((prev) => prev.filter((u) => u.id !== currentUser.id));
            await handleLogout();
        },
        [currentUser, handleLogout]
    );

    const handleReactivateAccount = useCallback(async () => {
        if (!currentUser) return;
        await reactivateUserAccount(currentUser.id);
    }, [currentUser]);

    const handleImportAccount = useCallback(
        async (payload: {
            exportDoc: Record<string, unknown>;
            password: string;
            confirmEmailMismatch: boolean;
        }) => {
            if (!currentUser) return;
            return importUserAccountBackup(currentUser.id, payload);
        },
        [currentUser]
    );

    const handleExportAccount = useCallback(async () => {
        if (!currentUser) return;
        try {
            const data = await exportUserAccountData(currentUser.id);
            if (!data) {
                alert('Export failed. You may only export once every 24 hours.');
                return;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lantern-study-export-${currentUser.id}-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export data. Please try again.');
        }
    }, [currentUser]);

    const handleSavePreset = useCallback((name: string, config: Omit<TestConfig, 'questionIds' | 'groupId'>) => {
        if (!currentUser) return;
        const previousPresets = currentUser.testPresets || [];
        const newPreset: TestPreset = { id: uuidv4(), name, config };
        const updatedPresets = [...previousPresets, newPreset];
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        void persistProfileUpdate({ test_presets: updatedPresets }).then((ok) => {
            if (!ok) {
                const latest = useAuthStore.getState().currentUser;
                if (latest?.id === currentUser.id) {
                    setCurrentUser({ ...latest, testPresets: previousPresets });
                }
                useToastStore.getState().showToast('Failed to save preset. Please try again.', 'error');
                return;
            }
            useToastStore.getState().showToast(`Preset "${name}" saved.`, 'info');
        }).catch((error) => {
            console.error('Failed to save test preset:', error);
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id === currentUser.id) {
                setCurrentUser({ ...latest, testPresets: previousPresets });
            }
            useToastStore.getState().showToast('Failed to save preset. Please try again.', 'error');
        });
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    const handleDeletePreset = useCallback((id: string) => {
        if (!currentUser) return;
        const previousPresets = currentUser.testPresets || [];
        const updatedPresets = previousPresets.filter(p => p.id !== id);
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        void persistProfileUpdate({ test_presets: updatedPresets }).then((ok) => {
            if (ok) return;
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id === currentUser.id) {
                setCurrentUser({ ...latest, testPresets: previousPresets });
            }
            useToastStore.getState().showToast('Failed to delete preset. Please try again.', 'error');
        }).catch((error) => {
            console.error('Failed to delete test preset:', error);
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id === currentUser.id) {
                setCurrentUser({ ...latest, testPresets: previousPresets });
            }
            useToastStore.getState().showToast('Failed to delete preset. Please try again.', 'error');
        });
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    return {
        users,
        setUsers,
        dataLoaded,
        setDataLoaded,
        bootstrapLoad,
        setBootstrapLoad,
        getUserSettings,
        toggleTheme,
        handleLogout,
        handleUpdateSettingsCategory,
        handleUpdateNotificationSettings,
        handleUpdateProfile,
        handleUpdateCurrentUserAvatar,
        handleUpdatePassword,
        handlePauseAccount,
        handleDeleteAccountImmediate,
        handleReactivateAccount,
        handleImportAccount,
        handleExportAccount,
        handleUpdatePrivacySettings,
        handleResetSettings,
        handleSavePreset,
        handleDeletePreset,
    };
}
