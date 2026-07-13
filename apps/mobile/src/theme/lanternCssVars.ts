import { vars } from 'nativewind';
import { lightTheme, darkTheme, type ThemePalette } from '@lantern/shared/design';

function paletteToLanternVars(palette: ThemePalette) {
  return vars({
    '--color-lantern-background': palette.background,
    '--color-lantern-background-secondary': palette.backgroundSecondary,
    '--color-lantern-surface': palette.surface,
    '--color-lantern-surface-secondary': palette.surfaceSecondary,
    '--color-lantern-text': palette.text,
    '--color-lantern-text-secondary': palette.textSecondary,
    '--color-lantern-text-tertiary': palette.textTertiary,
    '--color-lantern-primary': palette.primary,
    '--color-lantern-primary-light': palette.primaryLight,
    '--color-lantern-primary-dark': palette.primaryDark,
    '--color-lantern-primary-background': palette.primaryBackground,
    '--color-lantern-accent': palette.accent,
    '--color-lantern-accent-background': palette.accentBackground,
    '--color-lantern-success': palette.success,
    '--color-lantern-warning': palette.warning,
    '--color-lantern-error': palette.error,
    '--color-lantern-border': palette.border,
  });
}

export const lightLanternVars = paletteToLanternVars(lightTheme);
export const darkLanternVars = paletteToLanternVars(darkTheme);
