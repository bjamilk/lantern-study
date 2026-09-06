import { vars } from 'nativewind';
import {
  lightTheme,
  darkTheme,
  hexToRgbChannels,
  FEATURE_KEYS,
  featureAccentsLight,
  featureAccentsDark,
  type FeatureAccentPair,
  type FeatureKey,
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

/**
 * Spec v3 §5.6 / Wave 0, third hop: the eight `{ink, tint}` feature pairs as
 * `--color-lantern-feature-<key>-ink/-tint`, per theme, so `text-lantern-
 * feature-notes-ink` and `bg-lantern-feature-notes-tint` follow dark mode the
 * same way they do on web. The nine pre-wave keys stay as aliases of the ink
 * that now carries their meaning (same mapping as `featureAccents` in
 * tokens.ts and as index.css) for one release.
 */
const LEGACY_FEATURE_ALIAS: Record<string, FeatureKey> = {
  dashboard: 'ai',
  library: 'notes',
  admin: 'campus',
  flashcards: 'flashcards',
  groups: 'groups',
  marketplace: 'campus',
  offline: 'budget',
  tests: 'tests',
  budget: 'budget',
};

function featurePairsToLanternVars(pairs: Record<FeatureKey, FeatureAccentPair>) {
  const out: Record<string, string> = {};
  for (const key of FEATURE_KEYS) {
    out[`--color-lantern-feature-${key}-ink`] = channels(pairs[key].ink);
    out[`--color-lantern-feature-${key}-tint`] = channels(pairs[key].tint);
  }
  for (const [legacy, key] of Object.entries(LEGACY_FEATURE_ALIAS)) {
    out[`--color-lantern-feature-${legacy}`] = channels(pairs[key].ink);
  }
  return out;
}

function paletteToLanternVars(palette: ThemePalette, pairs: Record<FeatureKey, FeatureAccentPair>) {
  return vars({
    ...featurePairsToLanternVars(pairs),
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
    // Build 153: one `primary` was serving BOTH a fill under white text and
    // text on a tint, and no single value can do both. `-fill` is the ground
    // (white on it >= 4.5); `-text` is the ink (>= 4.5 on surface, card, page
    // and the composited tint). Keep in lockstep with index.css.
    '--color-lantern-primary-fill': channels(palette.primaryFill),
    '--color-lantern-primary-text': channels(palette.primaryText),
    '--color-lantern-accent': channels(palette.accent),
    // Same: dark is #f59e0b20.
    '--color-lantern-accent-background': palette.accentBackground,
    '--color-lantern-success': channels(palette.success),
    '--color-lantern-warning': channels(palette.warning),
    '--color-lantern-error': channels(palette.error),
    '--color-lantern-info': channels(palette.info),
    '--color-lantern-border': channels(palette.border),
  });
}

export const lightLanternVars = paletteToLanternVars(lightTheme, featureAccentsLight);
export const darkLanternVars = paletteToLanternVars(darkTheme, featureAccentsDark);
