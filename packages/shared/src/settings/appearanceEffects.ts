import {
  AA_LARGE,
  ensureAaPair,
  ensureTextContrastOn,
  relativeLuminance,
} from '../design/contrast';
import type { AccessibilitySettings, AppearanceSettings, UserSettings } from './userSettings';

export interface AppearanceEffectFlags {
  reduceMotion: boolean;
  highContrast: boolean;
  screenReaderOptimized: boolean;
  compactMode: boolean;
  showAnimations: boolean;
  fontScale: number;
  accentColor: string;
}

/**
 * The shipped default accent, and the one it replaced.
 *
 * Both values are SENTINELS, not colours the pivot can retint: choosing either
 * means "no override", so the palette's own primaryFill/primaryText/tabBarActive
 * win and the brand fill is the theme's INK everywhere (the 2026-09-12 pivot,
 * build 154). The ink reaches the UI through `lanternColors.primary`, never
 * through these constants.
 *
 * `LEGACY_DEFAULT_ACCENT_COLOR` is the retired indigo. It is still persisted in
 * `appearance.accentColor` for every account created before the pivot, and
 * migrating those rows is neither needed nor wanted — `isDefaultAccentColor`
 * treats it as "default" forever. Drop it and every one of those accounts would
 * read as a deliberate indigo override and repaint the app in the retired hue,
 * the exact opposite of the pivot.
 *
 * `DEFAULT_ACCENT_COLOR` is the ink. It is what a fresh account persists
 * (`DEFAULT_USER_SETTINGS.appearance.accentColor`) and what the first,
 * "Default"-labelled swatch of the accent palette stores (`ACCENT_PRESETS[0]`);
 * those three must stay byte-identical. Never compare an accent to either
 * constant directly — call `isDefaultAccentColor`, so both keep working.
 */
export const LEGACY_DEFAULT_ACCENT_COLOR = '#6366f1';
export const DEFAULT_ACCENT_COLOR = '#191919';

/**
 * The accent swatches a student can pick, in swatch order — the canonical list.
 *
 * It lives here, beside the sentinels, so the contrast gates and the mobile
 * settings grid (`apps/mobile/src/screens/settings/accentPresets.ts`) cannot
 * disagree about WHICH hues ship: a preset added there but not gated here is
 * exactly how the dark-mode AA shortfall reached five presets unnoticed.
 * These are stored values — never retint one to fix contrast; derive the fill
 * and its ink instead (`applyAccentToColors`).
 */
export const ACCENT_PRESET_HEXES: readonly string[] = [
  DEFAULT_ACCENT_COLOR,
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
];

/**
 * True when the stored accent means "leave the palette alone" — the ink default,
 * the legacy indigo default, or nothing stored at all.
 */
export function isDefaultAccentColor(accentColor: string | null | undefined): boolean {
  if (!accentColor) return true;
  const hex = accentColor.toLowerCase();
  return hex === DEFAULT_ACCENT_COLOR || hex === LEGACY_DEFAULT_ACCENT_COLOR;
}

export function getFontScale(fontSize: AppearanceSettings['fontSize']): number {
  switch (fontSize) {
    case 'small':
      return 0.9;
    case 'large':
      return 1.15;
    default:
      return 1;
  }
}

export function getAppearanceEffectFlags(settings: UserSettings): AppearanceEffectFlags {
  // Motion is governed solely by the Reduce Motion accessibility setting.
  // (The legacy standalone "Show Animations" toggle was removed as a duplicate.)
  const reduceMotion = settings.accessibility.reduceMotion;

  return {
    reduceMotion,
    highContrast: settings.accessibility.highContrast,
    screenReaderOptimized: settings.accessibility.screenReaderOptimized,
    compactMode: settings.appearance.compactMode,
    showAnimations: settings.appearance.showAnimations,
    fontScale: getFontScale(settings.appearance.fontSize),
    accentColor: settings.appearance.accentColor || DEFAULT_ACCENT_COLOR,
  };
}

/**
 * High contrast pushes the ink to the ends of its own ramp.
 *
 * Which end depends on the THEME, and that used to be decided by
 * `colors.text === '#f8fafc'` — a literal comparison against dark's ink of
 * the day. The moment that token changed (dark's ink is `#f5f5f5` now, the
 * neutral twin of light's, not slate-50), every dark palette failed the test
 * and was treated as light: black title and near-black body painted onto the
 * near-black card, 1.12:1. A setting whose entire purpose is legibility made
 * the dialog unreadable, silently, with no other edit anywhere near it.
 *
 * So ask the ink how light it is, not what it equals. The inks below are the
 * neutral ends of the same ramp the palettes use — never slate.
 */
export function applyHighContrastToColors<T extends Record<string, string>>(colors: T): T {
  const isDarkTheme = relativeLuminance(colors.text || '#000000') > 0.5;
  return {
    ...colors,
    text: isDarkTheme ? '#ffffff' : '#000000',
    textSecondary: isDarkTheme ? '#e6e6e6' : '#1a1a1a',
    border: isDarkTheme ? '#8c8c8c' : '#333333',
  } as T;
}


export function applyAccentToColors<T extends Record<string, string>>(
  colors: T,
  accentColor: string
): T {
  if (isDefaultAccentColor(accentColor)) {
    return colors;
  }
  // ONE accent, TWO derived roles — the build-153 split.
  //
  //   primaryFill  the accent paired with the label ink actually painted on
  //                it (`textInverse`), moved only if that ink cannot read on
  //                the raw hue. See `ensureAaPair`.
  //   primaryText  the accent adjusted until it clears AA on the surface AND
  //                on the `primaryBackground` tint composited over it. Only
  //                the surface used to be checked, which is why dark's
  //                "Try Again" (#6b6ef2) passed at 4.59 on the card and
  //                failed at 4.07 on its own tint.
  //
  // `primary` is the deprecated dual-role token and keeps each theme's
  // dominant role — fill on light, text on dark — exactly as the static
  // palettes do, so no un-migrated call site shifts.
  const ground = colors.surface || colors.card || colors.background || '#ffffff';
  const tint = colors.primaryBackground || ground;
  const isDarkGround = relativeLuminance(ground) < 0.5;

  // The label on the fill is `textInverse`, which INVERTS with the theme:
  // white in light, #191919 in dark. Deriving the fill against a hardcoded
  // white therefore darkened every custom accent in DARK mode for a label that
  // is near-black — 3.65-3.79:1 for every primary button, the lit tab word and
  // the active pills (recorded 2026-09-13 in the mobile tabPillContrast test).
  //
  // So derive the pair, not the fill: the theme's own inverse ink is preferred
  // and the fill moves only as far as that ink needs, with the opposite
  // canonical ink as the fallback if the hue would have to collapse. In dark
  // every shipped preset already holds #191919 on its RAW hue, so the fill
  // stops being darkened at all and the student gets the colour they picked;
  // light is unchanged, its white label still setting the fill.
  const { fill: primaryFill, ink: primaryFillInk } = ensureAaPair(accentColor, [
    colors.textInverse || '#ffffff',
    relativeLuminance(colors.textInverse || '#ffffff') > 0.5 ? '#191919' : '#f5f5f5',
  ]);
  const primaryText = ensureTextContrastOn(accentColor, [ground, tint]);

  return {
    ...colors,
    primaryFill,
    // Paired with the fill above. Every call site that paints a label on a
    // filled control reads this token, so one rewrite reaches all of them.
    textInverse: primaryFillInk,
    primaryText,
    primary: isDarkGround ? primaryText : primaryFill,
    // Chrome, not text: the tab bar's active icon+label is always paired with
    // a filled indicator and a label, so 3:1 is the right bar (WCAG 1.4.11).
    tabBarActive: ensureTextContrastOn(
      accentColor,
      [colors.tabBar || ground],
      AA_LARGE
    ),
    switchThumbOn: accentColor,
  } as T;
}

export function scaleFontSize(baseSize: number, settings: Pick<UserSettings, 'appearance'>): number {
  return Math.round(baseSize * getFontScale(settings.appearance.fontSize));
}

export function shouldUseHaptics(
  accessibility: Pick<AccessibilitySettings, 'hapticFeedback'>
): boolean {
  return accessibility.hapticFeedback !== false;
}
