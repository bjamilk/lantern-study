import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Appearance,
  PixelRatio,
  View,
  useColorScheme as useDeviceScheme,
} from 'react-native';
import { useColorScheme } from 'nativewind';
import { getFontScale } from '@lantern/shared/settings';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { ColorsThemeProvider } from './ThemeContext';
import { darkLanternVars, lightLanternVars } from './lanternCssVars';
import { setFontScale } from './installFontScale';

/** Upper bound on the OS Dynamic Type contribution alone. */
const MAX_OS_FONT_SCALE = 1.6;
/** Upper bound on the combined app-setting x OS scale. */
const MAX_FONT_SCALE = 1.8;
const MIN_FONT_SCALE = 0.85;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, value));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePref = useSettingsStore(s => s.settings.appearance.theme);
  const fontSize = useSettingsStore(s => s.settings.appearance.fontSize);
  const deviceScheme = useDeviceScheme();
  const { setColorScheme } = useColorScheme();
  const user = useAuthStore(s => s.user);
  const [fontRevision, setFontRevision] = useState(0);
  // Seeded with the module's initial scale (installFontScale starts at 1) so a
  // default-sized boot does not remount the tree before it has even rendered.
  const appliedFontScale = useRef(1);
  const effectivePref = user ? themePref : 'light';

  const isDark =
    Boolean(user) &&
    (effectivePref === 'dark' || (effectivePref === 'system' && deviceScheme === 'dark'));

  useEffect(() => {
    const scheme = isDark ? 'dark' : 'light';
    setColorScheme(scheme);
    Appearance.setColorScheme(scheme);
  }, [isDark, setColorScheme]);

  useEffect(() => {
    // Text is rendered with allowFontScaling={false} (see installFontScale), so
    // OS Dynamic Type was ignored outright — the in-app small/medium/large
    // setting was the only lever a user had. Fold the OS scale in here instead.
    //
    // Both factors are clamped: iOS accessibility sizes reach ~3.1x, which on
    // top of the app's own 1.15 would be 3.5x and shred every fixed-height row.
    const applyScale = () => {
      const osScale = clamp(PixelRatio.getFontScale(), 1, MAX_OS_FONT_SCALE);
      const nextScale = clamp(
        getFontScale(fontSize) * osScale,
        MIN_FONT_SCALE,
        MAX_FONT_SCALE
      );
      // Bumping fontRevision re-keys the View wrapping the whole app, which
      // remounts everything below it — NavigationContainer included. That is the
      // only way patched Text picks up a new scale (setFontScale mutates a
      // module-level value read at render time), but it must stay rare.
      //
      // This ran unconditionally on every foreground, so returning from the mic
      // permission dialog — or any app switch — tore down the tree: the boot
      // screen flashed and every tab reset to its initial route, dropping the
      // user on Home instead of the note they were recording into. Only remount
      // when the scale genuinely changed.
      if (appliedFontScale.current === nextScale) return;
      appliedFontScale.current = nextScale;
      setFontScale(nextScale);
      setFontRevision((revision) => revision + 1);
    };
    applyScale();

    // RN emits no font-scale change event; the setting is changed in OS
    // Settings, so re-read whenever we come back to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyScale();
    });
    return () => sub.remove();
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
