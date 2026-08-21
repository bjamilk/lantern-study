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

export function applyAccentToColors<T extends Record<string, string>>(
  colors: T,
  accentColor: string
): T {
  return {
    ...colors,
    primary: accentColor,
    tabBarActive: accentColor,
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
