import {
  darkTheme,
  featureAccents,
  lightTheme,
  paletteToCssVars,
} from '@lantern/shared/design';
import { hexToRgbChannels } from '@lantern/shared/design';
import { DEFAULT_USER_SETTINGS } from '@lantern/shared/settings';

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

/**
 * Every var this module (or older versions of it) ever inlined on <html>.
 * Inline custom properties outrank the stylesheet, so anything left here
 * permanently pins one theme's value and breaks the `.dark` overrides.
 */
const LEGACY_INLINE_VARS = [
  ...Object.keys(paletteToCssVars(lightTheme)),
  ...Object.keys(paletteToCssVars(darkTheme)),
  ...Object.values(FEATURE_VAR_MAP),
  '--font-sans',
  '--font-display',
];

/**
 * Theme palettes live ONLY in index.css (`:root` + `.dark`), so toggling the
 * `dark` class is the complete theme switch. This function no longer inlines
 * the palette — it removes any inlined tokens (which used to freeze the app
 * in one theme) and applies just the user's custom accent, if any.
 *
 * The `theme` argument is kept for call-site compatibility; the palette now
 * follows the `dark` class, not this value. Fonts are owned by useFontMode.
 */
export function applyDesignTokensToDom(
  _theme: 'light' | 'dark',
  opts?: { accentColor?: string }
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  for (const name of LEGACY_INLINE_VARS) {
    root.style.removeProperty(name);
  }

  const accent = opts?.accentColor?.trim().toLowerCase();
  const defaultAccent = DEFAULT_USER_SETTINGS.appearance.accentColor.toLowerCase();
  if (accent && accent !== defaultAccent) {
    // An explicit custom accent applies to both themes (the user's choice).
    // --lantern-accent keeps the whole colour (it is used as one); but
    // --color-primary is consumed as `rgb(var(--color-primary) / <alpha>)`,
    // so it MUST be channels. Writing a hex here would compute to transparent
    // and blank out every primary background, border and ring app-wide.
    root.style.setProperty('--lantern-accent', accent);
    const channels = hexToRgbChannels(accent);
    if (channels) {
      root.style.setProperty('--color-primary', channels);
    } else {
      // Unparseable accent: fall back to the designed primary rather than
      // poisoning the variable.
      root.style.removeProperty('--color-primary');
    }
  } else {
    // Default accent = no override: each theme keeps its designed primary
    // (#4f46e5 light / #818cf8 dark), which also fixes primary contrast in dark.
    root.style.removeProperty('--lantern-accent');
    root.style.removeProperty('--color-primary');
  }
}
