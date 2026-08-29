import { useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { saveUserPreferences, saveUserSettingsDetailed } from '../services/supabase';
import { normalizeUserSettings } from '@lantern/shared/settings';

/**
 * The ONE write path for low-data mode. It must update BOTH stores that
 * carry the flag, or the mode reactivates itself: applyUserSettingsToDom
 * re-applies `settings.appearance.lowDataMode` on every settings sync or
 * appearance change, so a toggle that only wrote the ui store + slim
 * user_preferences was overridden by the stale canonical value moments
 * later (founder report 2026-08-29: "when I deactivate the low data mode,
 * it keeps reactivating").
 */
export function useLowDataModeToggle() {
    const { lowDataMode, setLowDataMode, theme } = useUIStore();
    const { currentUser } = useAuthStore();

    const toggleLowDataMode = useCallback(async () => {
        const newValue = !lowDataMode;
        setLowDataMode(newValue);
        if (!currentUser) return;

        // Mirror into the canonical settings object immediately so the
        // appearance DOM-sync effect re-applies the NEW value, not the old.
        const previousSettings = normalizeUserSettings(currentUser.settings);
        const optimisticSettings = {
            ...previousSettings,
            appearance: { ...previousSettings.appearance, lowDataMode: newValue },
        };
        useAuthStore.getState().setCurrentUser({ ...currentUser, settings: optimisticSettings });

        try {
            // Server deep-merges the category patch onto the latest CAS row.
            const result = await saveUserSettingsDetailed(currentUser.id, {
                appearance: { lowDataMode: newValue },
            });
            if (!result.ok) throw new Error('settings save rejected');
            if (result.settings) {
                const latest = useAuthStore.getState().currentUser;
                if (latest?.id === currentUser.id) {
                    useAuthStore.getState().setCurrentUser({
                        ...latest,
                        settings: normalizeUserSettings(result.settings),
                    });
                }
            }
            // Keep the slim per-user preferences row (read at boot) in step.
            const appearanceTheme = previousSettings.appearance.theme;
            await saveUserPreferences(currentUser.id, {
                theme: appearanceTheme === 'system' ? theme : appearanceTheme,
                lowDataMode: newValue,
            });
        } catch (error) {
            console.error('Failed to save low-data mode preference:', error);
            const latest = useAuthStore.getState().currentUser;
            if (latest?.id === currentUser.id) {
                useAuthStore.getState().setCurrentUser({ ...latest, settings: previousSettings });
            }
            setLowDataMode(!newValue);
            useToastStore.getState().showToast('Could not save the Low-Data Mode change.', 'error');
        }
    }, [lowDataMode, currentUser, theme, setLowDataMode]);

    return { lowDataMode, toggleLowDataMode };
}
