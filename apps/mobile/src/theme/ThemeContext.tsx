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
import { lightTheme, darkTheme, type ThemePalette } from '@lantern/shared/design';

export type ThemeColors = ThemePalette & {
  card: string;
  cardSecondary: string;
};

function toMobileThemeColors(palette: ThemePalette): ThemeColors {
  return {
    ...palette,
    card: palette.surface,
    cardSecondary: palette.surfaceSecondary,
  };
}

export const lightColors = toMobileThemeColors(lightTheme);
export const darkColors = toMobileThemeColors(darkTheme);

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

  const isDark =
    themeMode === 'system' ? systemColorScheme === 'dark' : themeMode === 'dark';

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

export const useColors = (): ThemeColors => {
  const { colors } = useTheme();
  return colors;
};

export const colors = darkColors;
