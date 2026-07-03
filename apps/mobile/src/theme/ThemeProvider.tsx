import React, { useEffect } from 'react';
import { View, useColorScheme as useDeviceScheme } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { ColorsThemeProvider } from './ThemeContext';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const deviceScheme = useDeviceScheme();
  const { setColorScheme } = useColorScheme();
  const currentUser = useAuthStore(s => s.currentUser);
  const effectivePref = currentUser ? themePref : 'light';

  useEffect(() => {
    if (effectivePref === 'system') {
      setColorScheme(deviceScheme === 'dark' ? 'dark' : 'light');
    } else {
      setColorScheme(effectivePref);
    }
  }, [effectivePref, deviceScheme, setColorScheme]);

  const isDark =
    Boolean(currentUser) &&
    (themePref === 'dark' || (themePref === 'system' && deviceScheme === 'dark'));

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
  const currentUser = useAuthStore(s => s.currentUser);
  if (!currentUser) return 'light';
  if (themePref === 'system') return deviceScheme === 'dark' ? 'dark' : 'light';
  return themePref;
}
