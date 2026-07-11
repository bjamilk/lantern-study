import {
  darkTheme,
  featureAccents,
  fontStacks,
  lightTheme,
  paletteToCssVars,
  type ThemePalette,
} from '@lantern/shared/design';

const FEATURE_VAR_MAP: Record<keyof typeof featureAccents, string> = {
  dashboard: '--color-feature-dashboard',
  library: '--color-feature-library',
  admin: '--color-feature-admin',
  flashcards: '--color-feature-flashcards',
  groups: '--color-feature-groups',
  marketplace: '--color-feature-marketplace',
  offline: '--color-feature-offline',
  tests: '--color-feature-tests',
  budget: '--color-feature-budget',
};

export function featureAccentsToCssVars(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(featureAccents).map(([key, value]) => [FEATURE_VAR_MAP[key as keyof typeof featureAccents], value])
  );
}

export function applyDesignTokensToDom(
  theme: 'light' | 'dark',
  opts?: { accentColor?: string }
): void {
  if (typeof document === 'undefined') return;
  const palette: ThemePalette = theme === 'dark' ? darkTheme : lightTheme;
  const root = document.documentElement;
  const vars = {
    ...paletteToCssVars(palette),
    ...featureAccentsToCssVars(),
    '--font-sans': fontStacks.full,
    '--font-display': fontStacks.display,
  };

  Object.entries(vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });

  if (opts?.accentColor) {
    root.style.setProperty('--lantern-accent', opts.accentColor);
    root.style.setProperty('--color-primary', opts.accentColor);
  }
}
