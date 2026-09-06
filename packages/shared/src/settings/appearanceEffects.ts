import {
  AA_LARGE,
  ensureFillContrast,
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
    accentColor: settings.appearance.accentColor || '#6366f1',
  };
}

export function applyHighContrastToColors<T extends Record<string, string>>(colors: T): T {
  return {
    ...colors,
    text: colors.text === '#f8fafc' ? '#ffffff' : '#000000',
    textSecondary: colors.text === '#f8fafc' ? '#e2e8f0' : '#1e293b',
    border: colors.text === '#f8fafc' ? '#64748b' : '#334155',
  } as T;
}

/** The shipped default accent. Choosing it means "no override": the palette's own
 * primaryFill/primaryText/tabBarActive win, so the brand fill is one value
 * (#4f46e5) everywhere instead of the accent-derived #5e61e5 beside it (build 154). */
export const DEFAULT_ACCENT_COLOR = '#6366f1';

export function applyAccentToColors<T extends Record<string, string>>(
  colors: T,
  accentColor: string
): T {
  if (!accentColor || accentColor.toLowerCase() === DEFAULT_ACCENT_COLOR) {
    return colors;
  }
  // ONE accent, TWO derived roles — the build-153 split.
  //
  //   primaryFill  the accent darkened just enough that a WHITE label on it
  //                reaches AA. The default accent #6366f1 is 4.47:1 under
  //                white, so even the default needed one step.
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

  const primaryFill = ensureFillContrast(accentColor, '#ffffff');
  const primaryText = ensureTextContrastOn(accentColor, [ground, tint]);

  return {
    ...colors,
    primaryFill,
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
