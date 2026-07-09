// ===========================================
// Lantern Study - Shared Design Tokens
// ===========================================

export const lanternColors = {
  primary: '#4f46e5',
  primaryLight: '#6366f1',
  primaryDark: '#3730a3',
  accent: '#d97706',
  accentLight: '#f59e0b',
  accentDark: '#b45309',
} as const;

const lightBase = {
  background: '#f4f6fb',
  backgroundSecondary: '#e8ecf6',
  surface: '#ffffff',
  surfaceSecondary: '#f8fafc',
  card: '#ffffff',
  cardSecondary: '#f8fafc',
  text: '#0f172a',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  textInverse: '#ffffff',
  primary: lanternColors.primary,
  primaryLight: lanternColors.primaryLight,
  primaryDark: lanternColors.primaryDark,
  primaryBackground: '#eef2ff',
  accent: lanternColors.accent,
  accentBackground: '#fff7ed',
  success: '#059669',
  successBackground: '#d1fae5',
  warning: '#d97706',
  warningBackground: '#fff7ed',
  error: '#dc2626',
  errorBackground: '#fee2e2',
  info: '#0ea5e9',
  infoBackground: '#e0f2fe',
  border: '#d8dee9',
  borderLight: '#f1f5f9',
  tabBar: '#ffffff',
  tabBarBorder: '#d8dee9',
  tabBarActive: lanternColors.primary,
  tabBarInactive: '#94a3b8',
  inputBackground: '#f1f5f9',
  inputBorder: '#d8dee9',
  inputText: '#0f172a',
  inputPlaceholder: '#94a3b8',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#ffffff',
  switchTrackOn: '#4f46e580',
  switchTrackOff: '#d8dee9',
  switchThumbOn: lanternColors.primary,
  switchThumbOff: '#94a3b8',
} as const;

const darkBase = {
  background: '#0b1220',
  backgroundSecondary: '#151e2e',
  surface: '#151e2e',
  surfaceSecondary: '#1e293b',
  card: '#151e2e',
  cardSecondary: '#1e293b',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  textInverse: '#0f172a',
  primary: '#818cf8',
  primaryLight: '#a5b4fc',
  primaryDark: '#6366f1',
  primaryBackground: '#6366f120',
  accent: '#fbbf24',
  accentBackground: '#f59e0b20',
  success: '#10b981',
  successBackground: '#10b98120',
  warning: '#fbbf24',
  warningBackground: '#f59e0b20',
  error: '#ef4444',
  errorBackground: '#ef444420',
  info: '#0ea5e9',
  infoBackground: '#0ea5e920',
  border: '#243044',
  borderLight: '#1e293b',
  tabBar: '#151e2e',
  tabBarBorder: '#243044',
  tabBarActive: '#818cf8',
  tabBarInactive: '#64748b',
  inputBackground: '#0b1220',
  inputBorder: '#243044',
  inputText: '#f8fafc',
  inputPlaceholder: '#64748b',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#151e2e',
  switchTrackOn: '#818cf880',
  switchTrackOff: '#243044',
  switchThumbOn: '#818cf8',
  switchThumbOff: '#64748b',
} as const;

export const lightTheme = lightBase;
export const darkTheme = darkBase;
export type ThemePalette = typeof lightBase;

/** Backwards-compatible exports for mobile ThemeContext */
export const lightColors = lightTheme;
export const darkColors = darkTheme;

/** Feature accent colors for consistent screen identity */
export const featureAccents = {
  dashboard: lanternColors.primary,
  flashcards: '#f43f5e',
  groups: '#10b981',
  marketplace: '#8b5cf6',
  offline: '#f59e0b',
  tests: '#0ea5e9',
  budget: '#14b8a6',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
} as const;

export const typography = {
  display: { size: 28, lineHeight: 34, weight: '700' as const },
  title: { size: 20, lineHeight: 28, weight: '600' as const },
  subtitle: { size: 16, lineHeight: 24, weight: '600' as const },
  body: { size: 14, lineHeight: 20, weight: '400' as const },
  caption: { size: 12, lineHeight: 16, weight: '400' as const },
  label: { size: 11, lineHeight: 14, weight: '500' as const },
} as const;

export const fontStacks = {
  full: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
  display: "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  lowData: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

/** CSS custom property names for web */
export const cssVarNames = {
  background: '--color-background',
  backgroundSecondary: '--color-background-secondary',
  surface: '--color-surface',
  surfaceSecondary: '--color-surface-secondary',
  text: '--color-text',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  primary: '--color-primary',
  primaryLight: '--color-primary-light',
  primaryDark: '--color-primary-dark',
  primaryBackground: '--color-primary-background',
  accent: '--color-accent',
  accentBackground: '--color-accent-background',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
  border: '--color-border',
  radiusLg: '--radius-lg',
  radiusXl: '--radius-xl',
  fontSans: '--font-sans',
} as const;

export function paletteToCssVars(palette: ThemePalette): Record<string, string> {
  return {
    [cssVarNames.background]: palette.background,
    [cssVarNames.backgroundSecondary]: palette.backgroundSecondary,
    [cssVarNames.surface]: palette.surface,
    [cssVarNames.surfaceSecondary]: palette.surfaceSecondary,
    [cssVarNames.text]: palette.text,
    [cssVarNames.textSecondary]: palette.textSecondary,
    [cssVarNames.textTertiary]: palette.textTertiary,
    [cssVarNames.primary]: palette.primary,
    [cssVarNames.primaryLight]: palette.primaryLight,
    [cssVarNames.primaryDark]: palette.primaryDark,
    [cssVarNames.primaryBackground]: palette.primaryBackground,
    [cssVarNames.accent]: palette.accent,
    [cssVarNames.accentBackground]: palette.accentBackground,
    [cssVarNames.success]: palette.success,
    [cssVarNames.warning]: palette.warning,
    [cssVarNames.error]: palette.error,
    [cssVarNames.border]: palette.border,
    [cssVarNames.radiusLg]: `${radius.lg}px`,
    [cssVarNames.radiusXl]: `${radius.xl}px`,
  };
}
