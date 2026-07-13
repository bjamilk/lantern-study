import React, { useEffect, useMemo } from 'react';
import { Appearance, View, useColorScheme as useDeviceScheme } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { ColorsThemeProvider } from './ThemeContext';
import { darkLanternVars, lightLanternVars } from './lanternCssVars';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const deviceScheme = useDeviceScheme();
  const { setColorScheme } = useColorScheme();
  const user = useAuthStore(s => s.user);
  const effectivePref = user ? themePref : 'light';

  const isDark =
    Boolean(user) &&
    (effectivePref === 'dark' || (effectivePref === 'system' && deviceScheme === 'dark'));

  useEffect(() => {
    const scheme = isDark ? 'dark' : 'light';
    setColorScheme(scheme);
    Appearance.setColorScheme(scheme);
  }, [isDark, setColorScheme]);

  const lanternVars = useMemo(() => (isDark ? darkLanternVars : lightLanternVars), [isDark]);

  return (
    <ColorsThemeProvider>
      <View
        style={[lanternVars, { flex: 1 }]}
        className={`flex-1 ${isDark ? 'dark' : ''} bg-lantern-background`}
      >
        {children}
      </View>
    </ColorsThemeProvider>
  );
}

export function useAppTheme(): 'light' | 'dark' {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const deviceScheme = useDeviceScheme();
  const user = useAuthStore(s => s.user);
  if (!user) return 'light';
  if (themePref === 'system') return deviceScheme === 'dark' ? 'dark' : 'light';
  return themePref;
}
