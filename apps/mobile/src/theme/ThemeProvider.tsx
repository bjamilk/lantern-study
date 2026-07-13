import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, View, useColorScheme as useDeviceScheme } from 'react-native';
import { useColorScheme } from 'nativewind';
import { getFontScale } from '@lantern/shared/settings';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { ColorsThemeProvider } from './ThemeContext';
import { darkLanternVars, lightLanternVars } from './lanternCssVars';
import { setFontScale } from './installFontScale';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const fontSize = useSettingsStore(s => s.settings.appearance.fontSize);
  const deviceScheme = useDeviceScheme();
  const { setColorScheme } = useColorScheme();
  const user = useAuthStore(s => s.user);
  const [fontRevision, setFontRevision] = useState(0);
  const hasMountedFontEffect = useRef(false);
  const effectivePref = user ? themePref : 'light';

  // Apply before children paint so the Text patch is correct without remounting the tree.
  setFontScale(getFontScale(fontSize));

  const isDark =
    Boolean(user) &&
    (effectivePref === 'dark' || (effectivePref === 'system' && deviceScheme === 'dark'));

  useEffect(() => {
    const scheme = isDark ? 'dark' : 'light';
    setColorScheme(scheme);
    Appearance.setColorScheme(scheme);
  }, [isDark, setColorScheme]);

  useEffect(() => {
    setFontScale(getFontScale(fontSize));
    // Remount only when the user changes font size after launch — remounting on
    // first mount remounts navigation/auth and has caused instant close on Android.
    if (!hasMountedFontEffect.current) {
      hasMountedFontEffect.current = true;
      return;
    }
    setFontRevision((revision) => revision + 1);
  }, [fontSize]);

  const lanternVars = useMemo(() => (isDark ? darkLanternVars : lightLanternVars), [isDark]);

  return (
    <ColorsThemeProvider>
      <View
        key={`font-${fontRevision}`}
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
