import { vars } from 'nativewind';
import {
  lightTheme,
  darkTheme,
  hexToRgbChannels,
  type ThemePalette,
} from '@lantern/shared/design';

/**
 * Colours reach Tailwind as `rgb(var(--x) / <alpha-value>)`, so the variables
 * must hold the three CHANNELS on their own ("79 70 229"). Holding a whole
 * colour is what silently killed every `/opacity` class — and, worse, a hex
 * left inside that rgb() makes NativeWind's runtime return undefined, which
 * would kill the plain classes too. Keep this in lockstep with the colour
 * declarations in tailwind.config.js.
 */
function channels(hex: string): string {
  return hexToRgbChannels(hex) ?? hex;
}

function paletteToLanternVars(palette: ThemePalette) {
  return vars({
    '--color-lantern-background': channels(palette.background),
    '--color-lantern-background-secondary': channels(palette.backgroundSecondary),
    '--color-lantern-surface': channels(palette.surface),
    '--color-lantern-surface-secondary': channels(palette.surfaceSecondary),
    '--color-lantern-text': channels(palette.text),
    '--color-lantern-text-secondary': channels(palette.textSecondary),
    '--color-lantern-text-tertiary': channels(palette.textTertiary),
    '--color-lantern-primary': channels(palette.primary),
    '--color-lantern-primary-light': channels(palette.primaryLight),
    '--color-lantern-primary-dark': channels(palette.primaryDark),
    // Dark's value carries its own alpha (#6366f120); it therefore stays a
    // whole colour and is declared in Tailwind without <alpha-value>.
    '--color-lantern-primary-background': palette.primaryBackground,
    '--color-lantern-accent': channels(palette.accent),
    // Same: dark is #f59e0b20.
    '--color-lantern-accent-background': palette.accentBackground,
    '--color-lantern-success': channels(palette.success),
    '--color-lantern-warning': channels(palette.warning),
    '--color-lantern-error': channels(palette.error),
    '--color-lantern-border': channels(palette.border),
  });
}

export const lightLanternVars = paletteToLanternVars(lightTheme);
export const darkLanternVars = paletteToLanternVars(darkTheme);
