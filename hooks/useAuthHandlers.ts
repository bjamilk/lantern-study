import { useState, useCallback } from 'react';
import { User, TestPreset, TestConfig } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useStudyGoalsStore } from '../stores/studyGoalsStore';
import { MOCK_USERS } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import {
    updateUserProfile,
    saveUserPreferences,
    saveUserSettings,
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
import { applyUserSettingsToDom } from '../utils/applyUserSettingsToDom';

export function useAuthHandlers() {
    const { currentUser, setCurrentUser, setAuthLoading } = useAuthStore();
    const { setGroups, setAllMessages, setDmThreads, setAllDirectMessages } = useGroupStore();
    const { theme, setTheme, setSelectedChat, setLowDataMode, lowDataMode } = useUIStore();

    const [users, setUsers] = useState<User[]>(MOCK_USERS);
    const [dataLoaded, setDataLoaded] = useState(false);

    const getUserSettings = useCallback((): UserSettings => {
        return normalizeUserSettings(currentUser?.settings);
    }, [currentUser?.settings]);

    const persistUserSettings = useCallback(async (settings: UserSettings) => {
        if (!currentUser) return false;
        if (!(await hasValidSession())) {
            console.warn('Skipping settings update because no valid session is available.');
            return false;
        }
        const saved = await saveUserSettings(currentUser.id, settings);
        if (saved) {
            await updateUserProfile(currentUser.id, { settings }).catch(() => undefined);
        }
        return saved;
    }, [currentUser]);

    const persistProfileUpdate = useCallback(async (updates: {
        name?: string;
        avatar_url?: string;
        phone?: string;
        settings?: UserSettings;
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
        const current = getUserSettings();
        const next = mergeSettingsCategory(current, category, updates);
        setCurrentUser({ ...currentUser, settings: next });
        void persistUserSettings(next);
        if (category === 'appearance' || category === 'accessibility') {
            applySettingsToUi(next);
        }
        if (category === 'appearance') {
            const themeForPrefs = next.appearance.theme === 'system' ? theme : next.appearance.theme;
            void saveUserPreferences(currentUser.id, {
                theme: themeForPrefs === 'dark' ? 'dark' : 'light',
                lowDataMode: next.appearance.lowDataMode,
            });
        }
    }, [currentUser, getUserSettings, persistUserSettings, applySettingsToUi, setCurrentUser, theme]);

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
        const reset = {
            ...DEFAULT_USER_SETTINGS,
            updatedAt: new Date().toISOString(),
        };
        setCurrentUser({ ...currentUser, settings: reset });
        await persistUserSettings(reset);
        applySettingsToUi(reset);
        alert('Settings have been reset to defaults.');
    }, [currentUser, persistUserSettings, applySettingsToUi, setCurrentUser]);

    const toggleTheme = useCallback(async () => {
        const current = getUserSettings();
        const resolvedTheme = current.appearance.theme === 'system'
            ? theme
            : current.appearance.theme;
        const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        handleUpdateSettingsCategory('appearance', { theme: newTheme });
    }, [getUserSettings, theme, handleUpdateSettingsCategory]);

    const handleLogout = useCallback(async () => {
        await apiLogoutSession();

        setCurrentUser(null);
        setGroups([]);
        setAllMessages({});
        setSelectedChat(null);
        setDmThreads([]);
        setAllDirectMessages({});
        setDataLoaded(false);
        useBudgetStore.getState().reset();
        useStudyGoalsStore.getState().reset();
    }, [setCurrentUser, setGroups, setAllMessages, setSelectedChat, setDmThreads, setAllDirectMessages]);

    const handleUpdateProfile = useCallback((name: string, phone: string) => {
        if (!currentUser) return;
        setCurrentUser({ ...currentUser, name, phoneNumber: phone });
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? { ...u, name, phoneNumber: phone } : u));
        persistProfileUpdate({ name, phone }).catch(error => console.error('Failed to update user profile:', error));
        alert("Profile updated successfully!");
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    const handleUpdateCurrentUserAvatar = useCallback((avatarUrl: string) => {
        if (!currentUser) return;
        setCurrentUser({ ...currentUser, avatarUrl });
        persistProfileUpdate({ avatar_url: avatarUrl }).catch(error => console.error('Failed to update user avatar:', error));
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    const handleUpdatePassword = useCallback((current: string, newPass: string): boolean => {
        if (!currentUser) return false;
        if (currentUser.password !== current) {
            alert("Current password does not match.");
            return false;
        }
        const updatedUser = { ...currentUser, password: newPass };
        setCurrentUser(updatedUser);
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? updatedUser : u));
        alert("Password updated successfully!");
        return true;
    }, [currentUser, setCurrentUser]);

    const handlePauseAccount = useCallback(async () => {
        if (!currentUser) return;
        await deactivateUserAccount(currentUser.id);
        setUsers((prev) => prev.filter((u) => u.id !== currentUser.id));
        await handleLogout();
    }, [currentUser, handleLogout]);

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
        const newPreset: TestPreset = { id: uuidv4(), name, config };
        const updatedPresets = [...(currentUser.testPresets || []), newPreset];
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        persistProfileUpdate({ test_presets: updatedPresets }).catch(error => console.error('Failed to save test preset:', error));
        alert(`Preset "${name}" saved!`);
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    const handleDeletePreset = useCallback((id: string) => {
        if (!currentUser) return;
        const updatedPresets = (currentUser.testPresets || []).filter(p => p.id !== id);
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        persistProfileUpdate({ test_presets: updatedPresets }).catch(error => console.error('Failed to delete test preset:', error));
    }, [currentUser, setCurrentUser, persistProfileUpdate]);

    return {
        users,
        setUsers,
        dataLoaded,
        setDataLoaded,
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
