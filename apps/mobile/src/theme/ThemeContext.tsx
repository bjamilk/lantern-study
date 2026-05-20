// ===========================================
// Lantern Study Mobile - Theme Context
// Provides dark/light mode theming
// ===========================================

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';

// Theme color definitions
export const lightColors = {
  // Backgrounds
  background: '#f8fafc',
  backgroundSecondary: '#f1f5f9',
  card: '#ffffff',
  cardSecondary: '#f8fafc',
  
  // Text
  text: '#0f172a',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  textInverse: '#ffffff',
  
  // Primary colors
  primary: '#6366f1',
  primaryLight: '#818cf8',
  primaryDark: '#4f46e5',
  primaryBackground: '#eef2ff',
  
  // Accent colors
  success: '#10b981',
  successBackground: '#d1fae5',
  warning: '#f59e0b',
  warningBackground: '#fef3c7',
  error: '#ef4444',
  errorBackground: '#fee2e2',
  info: '#0ea5e9',
  infoBackground: '#e0f2fe',
  
  // Borders
  border: '#e2e8f0',
  borderLight: '#f1f5f9',
  
  // Tab bar
  tabBar: '#ffffff',
  tabBarBorder: '#e2e8f0',
  tabBarActive: '#6366f1',
  tabBarInactive: '#94a3b8',
  
  // Input
  inputBackground: '#f1f5f9',
  inputBorder: '#e2e8f0',
  inputText: '#0f172a',
  inputPlaceholder: '#94a3b8',
  
  // Modal
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#ffffff',
  
  // Switch
  switchTrackOn: '#6366f180',
  switchTrackOff: '#e2e8f0',
  switchThumbOn: '#6366f1',
  switchThumbOff: '#94a3b8',
};

export const darkColors = {
  // Backgrounds
  background: '#0f172a',
  backgroundSecondary: '#1e293b',
  card: '#1e293b',
  cardSecondary: '#334155',
  
  // Text
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  textInverse: '#0f172a',
  
  // Primary colors
  primary: '#6366f1',
  primaryLight: '#818cf8',
  primaryDark: '#4f46e5',
  primaryBackground: '#6366f120',
  
  // Accent colors
  success: '#10b981',
  successBackground: '#10b98120',
  warning: '#f59e0b',
  warningBackground: '#f59e0b20',
  error: '#ef4444',
  errorBackground: '#ef444420',
  info: '#0ea5e9',
  infoBackground: '#0ea5e920',
  
  // Borders
  border: '#334155',
  borderLight: '#1e293b',
  
  // Tab bar
  tabBar: '#1e293b',
  tabBarBorder: '#334155',
  tabBarActive: '#6366f1',
  tabBarInactive: '#64748b',
  
  // Input
  inputBackground: '#0f172a',
  inputBorder: '#334155',
  inputText: '#f8fafc',
  inputPlaceholder: '#64748b',
  
  // Modal
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#1e293b',
  
  // Switch
  switchTrackOn: '#6366f180',
  switchTrackOff: '#334155',
  switchThumbOn: '#6366f1',
  switchThumbOff: '#64748b',
};

export type ThemeColors = typeof darkColors;
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const { settings, updateSingleSetting } = useSettingsStore();
  const themeMode = settings.appearance.theme;
  
  // Determine if we should use dark mode
  const isDark = themeMode === 'system' 
    ? systemColorScheme === 'dark'
    : themeMode === 'dark';
  
  const colors = isDark ? darkColors : lightColors;
  
  const setThemeMode = (mode: ThemeMode) => {
    updateSingleSetting('appearance', 'theme', mode);
  };
  
  return (
    <ThemeContext.Provider value={{ colors, isDark, themeMode, setThemeMode }}>
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
