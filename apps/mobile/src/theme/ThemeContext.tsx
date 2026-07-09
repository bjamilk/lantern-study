// ===========================================
// Lantern Study Mobile - Theme Context
// Provides dark/light mode theming
// ===========================================

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';
import {
  applyAccentToColors,
  applyHighContrastToColors,
  getAppearanceEffectFlags,
  type AppearanceEffectFlags,
} from '@lantern/shared/settings';

// Theme color definitions
export const lightColors = {
  // Backgrounds
  background: '#f4f6fb',
  backgroundSecondary: '#e8ecf6',
  card: '#ffffff',
  cardSecondary: '#f8fafc',
  
  // Text
  text: '#0f172a',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  textInverse: '#ffffff',
  
  // Primary colors
  primary: '#4f46e5',
  primaryLight: '#6366f1',
  primaryDark: '#3730a3',
  primaryBackground: '#eef2ff',
  
  // Accent colors
  success: '#059669',
  successBackground: '#d1fae5',
  warning: '#d97706',
  warningBackground: '#fff7ed',
  error: '#dc2626',
  errorBackground: '#fee2e2',
  info: '#0ea5e9',
  infoBackground: '#e0f2fe',
  
  // Borders
  border: '#d8dee9',
  borderLight: '#f1f5f9',
  
  // Tab bar
  tabBar: '#ffffff',
  tabBarBorder: '#d8dee9',
  tabBarActive: '#4f46e5',
  tabBarInactive: '#94a3b8',
  
  // Input
  inputBackground: '#f1f5f9',
  inputBorder: '#d8dee9',
  inputText: '#0f172a',
  inputPlaceholder: '#94a3b8',
  
  // Modal
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#ffffff',
  
  // Switch
  switchTrackOn: '#4f46e580',
  switchTrackOff: '#d8dee9',
  switchThumbOn: '#4f46e5',
  switchThumbOff: '#94a3b8',
};

export const darkColors = {
  // Backgrounds
  background: '#0b1220',
  backgroundSecondary: '#151e2e',
  card: '#151e2e',
  cardSecondary: '#1e293b',
  
  // Text
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  textInverse: '#0f172a',
  
  // Primary colors
  primary: '#818cf8',
  primaryLight: '#a5b4fc',
  primaryDark: '#6366f1',
  primaryBackground: '#6366f120',
  
  // Accent colors
  success: '#10b981',
  successBackground: '#10b98120',
  warning: '#fbbf24',
  warningBackground: '#f59e0b20',
  error: '#ef4444',
  errorBackground: '#ef444420',
  info: '#0ea5e9',
  infoBackground: '#0ea5e920',
  
  // Borders
  border: '#243044',
  borderLight: '#1e293b',
  
  // Tab bar
  tabBar: '#151e2e',
  tabBarBorder: '#243044',
  tabBarActive: '#818cf8',
  tabBarInactive: '#64748b',
  
  // Input
  inputBackground: '#0b1220',
  inputBorder: '#243044',
  inputText: '#f8fafc',
  inputPlaceholder: '#64748b',
  
  // Modal
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#151e2e',
  
  // Switch
  switchTrackOn: '#818cf880',
  switchTrackOff: '#243044',
  switchThumbOn: '#818cf8',
  switchThumbOff: '#64748b',
};

export type ThemeColors = typeof darkColors;
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  effects: AppearanceEffectFlags;
  fontScale: number;
  compactMode: boolean;
  reduceMotion: boolean;
  screenReaderOptimized: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ColorsThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const { settings, updateSingleSetting } = useSettingsStore();
  const themeMode = settings.appearance.theme;
  
  // Determine if we should use dark mode
  const isDark = themeMode === 'system' 
    ? systemColorScheme === 'dark'
    : themeMode === 'dark';

  const effects = useMemo(() => getAppearanceEffectFlags(settings), [settings]);

  const colors = useMemo(() => {
    const base = isDark ? darkColors : lightColors;
    let resolved = applyAccentToColors(base, effects.accentColor);
    if (effects.highContrast) {
      resolved = applyHighContrastToColors(resolved);
    }
    return resolved;
  }, [isDark, effects.accentColor, effects.highContrast]);
  
  const setThemeMode = (mode: ThemeMode) => {
    updateSingleSetting('appearance', 'theme', mode);
  };
  
  return (
    <ThemeContext.Provider
      value={{
        colors,
        isDark,
        themeMode,
        setThemeMode,
        effects,
        fontScale: effects.fontScale,
        compactMode: effects.compactMode,
        reduceMotion: effects.reduceMotion,
        screenReaderOptimized: effects.screenReaderOptimized,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Convenience hook for just the colors
export const useColors = (): ThemeColors => {
  const { colors } = useTheme();
  return colors;
};

// Export default dark colors for backwards compatibility during migration
export const colors = darkColors;
