import type { UserSettings } from '@lantern/shared/settings';
import { applyDesignTokensToDom } from './applyDesignTokens';

export function applyUserSettingsToDom(
    settings: UserSettings,
    opts: {
        setTheme: (theme: 'light' | 'dark') => void;
        setLowDataMode: (enabled: boolean) => void;
    }
): void {
    const root = document.documentElement;
    const themePref =
        settings.appearance.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
            : settings.appearance.theme;

    opts.setTheme(themePref);
    localStorage.setItem('theme', themePref);
    root.classList.toggle('dark', themePref === 'dark');
    applyDesignTokensToDom(themePref, { accentColor: settings.appearance.accentColor });
    opts.setLowDataMode(settings.appearance.lowDataMode);

    // Motion is governed solely by the Reduce Motion accessibility setting.
    // (The legacy standalone "Show Animations" toggle was removed as a duplicate.)
    const reduceMotion = settings.accessibility.reduceMotion;
    root.classList.toggle('reduce-motion', reduceMotion);
    root.classList.toggle('high-contrast', settings.accessibility.highContrast);
    root.classList.toggle('no-animations', reduceMotion);
    root.classList.toggle('font-size-small', settings.appearance.fontSize === 'small');
    root.classList.toggle('font-size-large', settings.appearance.fontSize === 'large');
    root.classList.toggle('screen-reader-optimized', settings.accessibility.screenReaderOptimized);
}
