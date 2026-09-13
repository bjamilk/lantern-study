import {
  darkTheme,
  ensureFillContrast,
  ensureTextContrastOn,
  featureAccents,
  lightTheme,
  paletteToCssVars,
  relativeLuminance,
} from '@lantern/shared/design';
import { hexToRgbChannels } from '@lantern/shared/design';
import { isDefaultAccentColor } from '@lantern/shared/settings';

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
 * The palette follows the `dark` class, not `theme`; `theme` only picks which
 * palette a custom accent is derived against (see `deriveAccentRoles`).
 * Fonts are owned by useFontMode.
 */
export function applyDesignTokensToDom(
  theme: 'light' | 'dark',
  opts?: { accentColor?: string }
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  for (const name of LEGACY_INLINE_VARS) {
    root.style.removeProperty(name);
  }

  const accent = opts?.accentColor?.trim().toLowerCase();
  // Both the ink default and the retired indigo mean "no override" — see
  // `isDefaultAccentColor`. Comparing against a single constant would repaint
  // every pre-pivot account in the retired hue.
  if (accent && !isDefaultAccentColor(accent)) {
    // An explicit custom accent applies to both themes (the user's choice).
    // --lantern-accent keeps the whole colour (it is used as one); but
    // --color-primary is consumed as `rgb(var(--color-primary) / <alpha>)`,
    // so it MUST be channels. Writing a hex here would compute to transparent
    // and blank out every primary background, border and ring app-wide.
    root.style.setProperty('--lantern-accent', accent);
    const roles = deriveAccentRoles(accent, theme);
    if (roles) {
      root.style.setProperty('--color-primary', roles.primary);
      root.style.setProperty('--color-primary-fill', roles.primaryFill);
      root.style.setProperty('--color-primary-text', roles.primaryText);
    } else {
      // Unparseable accent: fall back to the designed primary rather than
      // poisoning the variables.
      for (const name of ACCENT_VARS) root.style.removeProperty(name);
    }
  } else {
    // Default accent (ink, retired indigo, or nothing) = no override: each
    // theme keeps its designed primary (#191919 light / #f5f5f5 dark, since
    // the 2026-09-12 pivot).
    root.style.removeProperty('--lantern-accent');
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
  }
}

const ACCENT_VARS = ['--color-primary', '--color-primary-fill', '--color-primary-text'] as const;

/**
 * The same split `applyAccentToColors` makes on mobile, for the web vars —
 * kept in lockstep so a custom accent renders the same roles on both.
 *
 *   --color-primary-fill  the accent darkened until a WHITE label clears AA
 *                         (a mid-tone accent typically needs one step).
 *   --color-primary-text  the accent adjusted until it clears AA on the
 *                         theme's surface AND on `primaryBackground`
 *                         composited over it — the tint is where the accent
 *                         ink used to fail (4.07 dark / 4.35 light).
 *   --color-primary       the deprecated dual-role var: the fill on a light
 *                         ground, the text ink on a dark one, exactly as the
 *                         static `:root` / `.dark` values are.
 *
 * Runs per theme because `applyUserSettingsToDom` re-applies on every theme
 * change, so the inline var always matches the class on <html>. Before this
 * a custom accent wrote only `--color-primary`, so the migrated
 * `bg-lantern-primary-fill` / `text-lantern-primary-text` call sites kept
 * the static indigo while everything else took the accent.
 *
 * Returns RGB channel strings, or null when the accent does not parse.
 */
export function deriveAccentRoles(
  accent: string,
  theme: 'light' | 'dark'
): { primary: string; primaryFill: string; primaryText: string } | null {
  if (!hexToRgbChannels(accent)) return null;
  const palette = theme === 'dark' ? darkTheme : lightTheme;
  let primaryFill: string;
  let primaryText: string;
  try {
    primaryFill = ensureFillContrast(accent, '#ffffff');
    primaryText = ensureTextContrastOn(accent, [palette.surface, palette.primaryBackground]);
  } catch {
    return null;
  }
  const isDarkGround = relativeLuminance(palette.surface) < 0.5;
  const fill = hexToRgbChannels(primaryFill);
  const text = hexToRgbChannels(primaryText);
  if (!fill || !text) return null;
  return { primary: isDarkGround ? text : fill, primaryFill: fill, primaryText: text };
}
