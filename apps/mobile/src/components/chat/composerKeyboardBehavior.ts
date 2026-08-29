import { Platform } from 'react-native';

/**
 * Android 15 (API 35) stopped honouring `android:windowSoftInputMode=
 * "adjustResize"` for apps targeting SDK 35+ — and this app targets 36 — so
 * KeyboardAvoidingView with no `behavior` does nothing there and the keyboard
 * covers the composer. Below API 35 the window still resizes on its own, and
 * padding on top of that would lift the composer twice as far.
 * (Same reasoning as AICompanionPanel's constant; kept here for chat screens.)
 */
export const COMPOSER_KEYBOARD_BEHAVIOR: 'padding' | undefined =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 35)
    ? 'padding'
    : undefined;
