import { useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { saveUserPreferences } from '../services/supabase';

/**
 * Returns the current lowDataMode value and a toggle function that persists
 * the preference to the backend so it is per-user rather than shared across
 * every account on the same device.
 */
export function useLowDataModeToggle() {
    const { lowDataMode, setLowDataMode, theme } = useUIStore();
    const { currentUser } = useAuthStore();

    const toggleLowDataMode = useCallback(async () => {
        const newValue = !lowDataMode;
        setLowDataMode(newValue);
        if (currentUser) {
            try {
                await saveUserPreferences(currentUser.id, {
                    theme: (currentUser.settings?.theme as 'light' | 'dark') || theme,
                    lowDataMode: newValue,
                });
            } catch (error) {
                console.error('Failed to save low-data mode preference:', error);
            }
        }
    }, [lowDataMode, currentUser, theme, setLowDataMode]);

    return { lowDataMode, toggleLowDataMode };
}
