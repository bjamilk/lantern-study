/**
 * Account-level handler barrel for the web app: user settings, profile, password,
 * account lifecycle (pause/delete/reactivate/export/import) and test presets.
 *
 * Exports:
 *  - useAuthHandlers() — the handler bundle consumed by App.tsx and the Settings screens
 *  - BootstrapDomain / BootstrapDomainStatus / BootstrapLoadState / INITIAL_BOOTSTRAP_LOAD_STATE —
 *    the per-domain bootstrap progress map that useAppEffects fills in during sign-in load
 * Touches: authStore (currentUser), groupStore (groups/messages/DM caches), uiStore
 *  (theme, selectedChat, lowDataMode), stores/userScopedStoreReset (the sign-out registry,
 *  run inside apiLogoutSession),
 *  services/supabase (updateUserProfile, saveUserSettingsDetailed, saveUserPreferences,
 *  updateAuthPassword, revokeOtherSessions, apiLogoutSession, deactivate/delete/reactivate/
 *  export/import account, hasValidSession), toastStore, confirmStore, and the DOM via
 *  applyUserSettingsToDom.
 * Gotchas:
 *  - Every settings write is optimistic and guarded by the module-level
 *    `settingsMutationGeneration`; a rollback must only fire when it is still the newest
 *    mutation, and must re-read `useAuthStore.getState().currentUser` (the closed-over
 *    `currentUser` is stale once a newer save lands, or after a user switch).
 *  - Saves send a CATEGORY PATCH, not the whole settings object; the server deep-merges onto
 *    the latest CAS row. Sending a full object would clobber concurrent device edits.
 *  - Appearance/accessibility changes must also be applied to the DOM, and only via
 *    applyUserSettingsToDom — colour tokens live in index.css :root/.dark, never in JS here.
 *  - handleLogout resets only React state it owns; every user-scoped STORE is reset by
 *    the registry in stores/userScopedStoreReset.ts, which `apiLogoutSession()` runs.
 *    The offline queue and pending test results are still deliberately left alone, so
 *    unsynced work survives a sign-out (FIXED (F1) [E3 H14]).
 */
import { useState, useCallback } from 'react';
import { User, TestPreset, TestConfig } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
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
import { confirmDialog } from '../stores/confirmStore';
import { planResetSettingsConfirm } from '../utils/destructiveConfirm';

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

// Bootstrap progress model: useAppEffects marks each domain 'loaded'/'error' as its sign-in
// fetch settles, so the UI can show partial data instead of one all-or-nothing spinner.
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

    // ── Settings: read, persist, apply ────────────────────────────────────────
    // Normalises whatever shape the profile row carries into the full settings object;
    // recomputed only when currentUser.settings changes identity.
    const getUserSettings = useCallback((): UserSettings => {
        return normalizeUserSettings(currentUser?.settings);
    }, [currentUser?.settings]);

    // Single write path for profile-row columns. Returns false (no throw) when there is no
    // valid session, so callers treat "signed out / cookie session gone" as a soft failure
    // and roll their optimistic update back instead of surfacing an auth error.
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

    // Core settings mutation: optimistic store write + DOM apply, then a fire-and-forget
    // category patch. Three outcomes — no session / !result.ok / ok — and each one re-reads
    // the store before touching currentUser so a user switch mid-flight cannot resurrect the
    // previous account's settings. A conflict (CAS lost) reports "updated on another device"
    // and rolls forward onto the server's returned settings rather than the local previous.
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
            // Appearance is mirrored into the legacy preferences columns so other surfaces
            // (mobile, server-rendered pages) still see theme/lowDataMode. 'system' is
            // resolved against the currently applied `theme` before it is stored.
            // Failures are swallowed: the authoritative copy is the settings row above.
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

    // Thin category-specific wrappers; all the optimistic/rollback logic lives above.
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

    // Reset-to-defaults: confirm first, then write the WHOLE settings object (not a patch,
    // because the point is to drop every stored override) and re-apply to the DOM.
    // FIXED (F9): both rollbacks here restored the closed-over `previous` user
    // without re-reading the store, and the no-session branch ignored
    // `mutationId` entirely — so a reset that failed while a NEWER settings
    // save was in flight rolled that newer save back, and a reset that failed
    // after a user switch wrote the previous account's settings onto the new
    // one. Both branches now run the same two guards
    // `handleUpdateSettingsCategory` above uses: only the latest mutation may
    // roll back, and only onto the user it started on.
    const handleResetSettings = useCallback(async () => {
        if (!currentUser) return;
        if (!(await confirmDialog(planResetSettingsConfirm()))) {
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
        const rollback = () => {
            if (mutationId !== settingsMutationGeneration) return;
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id !== previous.id) return;
            const previousSettings = normalizeUserSettings(previous.settings);
            setCurrentUser({ ...latest, settings: previousSettings });
            applySettingsToUi(previousSettings);
        };
        if (!(await hasValidSession())) {
            rollback();
            useToastStore.getState().showToast('Failed to reset settings. Please try again.', 'error');
            return;
        }
        const result = await saveUserSettingsDetailed(currentUser.id, reset);
        if (!result.ok) {
            rollback();
            useToastStore.getState().showToast('Failed to reset settings. Please try again.', 'error');
            return;
        }
        if (result.settings && mutationId === settingsMutationGeneration) {
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id === currentUser.id) {
                const authoritative = normalizeUserSettings(result.settings);
                setCurrentUser({ ...latest, settings: authoritative });
                applySettingsToUi(authoritative);
            }
        }
        useToastStore.getState().showToast('Settings have been reset to defaults.', 'info');
    }, [currentUser, applySettingsToUi, setCurrentUser]);

    // Light/dark toggle. 'system' is resolved against the theme currently applied before
    // flipping, so the first toggle from system always moves away from what is on screen.
    const toggleTheme = useCallback(async () => {
        const current = getUserSettings();
        const resolvedTheme = current.appearance.theme === 'system'
            ? theme
            : current.appearance.theme;
        const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        handleUpdateSettingsCategory('appearance', { theme: newTheme });
    }, [getUserSettings, theme, handleUpdateSettingsCategory]);

    // ── Session / account lifecycle ───────────────────────────────────────────
    // Explicit user sign-out: revoke the server session first, then tear down the in-memory
    // caches for this account. Only server-backed stores are reset — the offline queue and
    // pending test results are intentionally left alone so unsynced work is not destroyed.
    // This path is user-initiated only; a transient auth failure must never call it.
    // Sign-out: revoke the session, then tear down the in-memory copies of this
    // account's data.
    // FIXED (F1) [E3 H14, high]: the four hand-listed store resets that used to sit at
    // the bottom of this function are gone. Every user-scoped store — including the
    // testStore, flashcardStore, notesStore and aiJobStore this list had drifted past —
    // is now reset from the ONE registry in stores/userScopedStoreReset.ts, invoked
    // inside `apiLogoutSession()`. That is deliberate: apiLogoutSession is the single
    // path BOTH this handler and App.tsx's session-expired handler go through, so a
    // sign-out route can no longer miss the teardown. Before the fix, an SPA logout on a
    // shared browser left A's decks, flashcards, notes and test results hydrated and
    // rendered for B until each server fetch replaced them.
    // What stays here is only what the registry cannot own: the React state owned by
    // this hook's callers (user, chat selection, bootstrap gates).
    const handleLogout = useCallback(async () => {
        await apiLogoutSession(); // also clears lastKnownSettingsVersion and resets every user-scoped store

        setCurrentUser(null);
        setGroups([]);
        setAllMessages({});
        setSelectedChat(null);
        setDmThreads([]);
        setAllDirectMessages({});
        setDataLoaded(false);
        setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
    }, [setCurrentUser, setGroups, setAllMessages, setSelectedChat, setDmThreads, setAllDirectMessages]);

    // ── Profile ───────────────────────────────────────────────────────────────
    // Optimistic name/phone edit across both currentUser and the local `users` roster;
    // a soft failure (no session) and a thrown error take the same rollback branch.
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

    // Avatar: the upload endpoint already writes the DB, so this only mirrors the URL into
    // local state and persists the column for clear/remote-URL cases. A `data:` URL means
    // the upload never reached the server — it is rejected and rolled back rather than
    // stored, because a base64 blob in the profile row breaks every other client.
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

    // Password change, four steps: re-auth with the CURRENT password (this is the only
    // verification of the old password), update the password, revoke every other session,
    // then immediately re-auth with the NEW password because the global revoke also kills
    // this tab's session. If that last re-auth fails we still report success and ask for a
    // fresh sign-in — the password really did change.
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

    // Pause (soft-deactivate). The server may refuse logout for an already-paused account,
    // so the local session is cleared regardless of what the logout call does.
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

    // Hard delete (password-confirmed), reactivate, and the backup import/export pair.
    // None of these catch server errors except export — callers surface the rejection.
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

    // Export builds the JSON entirely client-side from the server payload and triggers a
    // blob download. A null payload means the 24h server-side rate limit rejected it.
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

    // ── Test presets ──────────────────────────────────────────────────────────
    // Presets live in the `test_presets` profile column, so save/delete are whole-array
    // rewrites: build the next array, write it optimistically, and on failure restore
    // `previousPresets` onto the LATEST store user (guarded by an id check) so a preset
    // edit cannot write back onto a different account.
    // Note the stored config carries `timerDuration` in SECONDS, matching TestConfig.
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
