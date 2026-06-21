import React, { useEffect } from 'react';
import { View, useColorScheme as useDeviceScheme } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSettingsStore } from '../stores/settingsStore';
import { ColorsThemeProvider } from './ThemeContext';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const deviceScheme = useDeviceScheme();
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    if (themePref === 'system') {
      setColorScheme(deviceScheme === 'dark' ? 'dark' : 'light');
    } else {
      setColorScheme(themePref);
    }
  }, [themePref, deviceScheme, setColorScheme]);

  const isDark =
    themePref === 'dark' || (themePref === 'system' && deviceScheme === 'dark');

  return (
    <ColorsThemeProvider>
      <View className={`flex-1 ${isDark ? 'dark' : ''} bg-lantern-background dark:bg-slate-900`}>
        {children}
      </View>
    </ColorsThemeProvider>
  );
}

export function useAppTheme(): 'light' | 'dark' {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const deviceScheme = useDeviceScheme();
  if (themePref === 'system') return deviceScheme === 'dark' ? 'dark' : 'light';
  return themePref;
}
