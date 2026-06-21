import type { UserSettings } from '@lantern/shared/settings';

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
    opts.setLowDataMode(settings.appearance.lowDataMode);

    const reduceMotion =
        settings.accessibility.reduceMotion || !settings.appearance.showAnimations;
    root.classList.toggle('reduce-motion', reduceMotion);
    root.classList.toggle('high-contrast', settings.accessibility.highContrast);
    root.classList.toggle('no-animations', !settings.appearance.showAnimations);
    root.classList.toggle('font-size-small', settings.appearance.fontSize === 'small');
    root.classList.toggle('font-size-large', settings.appearance.fontSize === 'large');
    root.classList.toggle('compact-mode', settings.appearance.compactMode);
    root.classList.toggle('screen-reader-optimized', settings.accessibility.screenReaderOptimized);
    root.style.setProperty('--lantern-accent', settings.appearance.accentColor || '#6366f1');
    root.style.setProperty('--color-primary', settings.appearance.accentColor || '#6366f1');
}
