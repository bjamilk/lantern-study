import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  serializeCookiePreferences,
} from '@lantern/shared';

/** Body height excluding safe-area padding — keep in sync with banner layout. */
export const COOKIE_NOTICE_BODY_HEIGHT = 88;

async function persistEssentialOnly() {
  const prefs = serializeCookiePreferences(essentialOnlyCookiePreferences());
  await AsyncStorage.setItem(COOKIE_PREFS_STORAGE_KEY, prefs);
  await AsyncStorage.setItem(COOKIE_NOTICE_LEGACY_KEY, 'dismissed');
}

export function useCookieNoticeBottomInset(): number {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const prefsRaw = await AsyncStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
      const legacyRaw = await AsyncStorage.getItem(COOKIE_NOTICE_LEGACY_KEY);
      if (!hasRecordedCookieChoice(prefsRaw, legacyRaw)) setVisible(true);
    })();
  }, []);

  if (!visible) return 0;
  return COOKIE_NOTICE_BODY_HEIGHT + Math.max(insets.bottom, 12);
}

export function CookieNoticeBanner() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const prefsRaw = await AsyncStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
      const legacyRaw = await AsyncStorage.getItem(COOKIE_NOTICE_LEGACY_KEY);
      if (!hasRecordedCookieChoice(prefsRaw, legacyRaw)) setVisible(true);
    })();
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    void persistEssentialOnly().then(() => setVisible(false));
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-50 border-t border-lantern-border bg-lantern-surface dark:bg-lantern-background px-4 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-xs text-lantern-text leading-snug">
          Essential on-device storage only (sign-in, theme, preferences). Optional analytics and advertising are off and
          not used in the app today.{' '}
          <Text
            className="text-lantern-primary underline"
            onPress={() => void Linking.openURL('https://lanternstudy.com/cookies')}
          >
            Cookie Policy
          </Text>
        </Text>
        <Pressable
          onPress={dismiss}
          className="shrink-0 rounded-lg bg-lantern-primary px-3 py-2.5 active:opacity-90"
          accessibilityRole="button"
          accessibilityLabel="Accept essential storage only"
        >
          <Text className="text-sm font-semibold text-white">Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default CookieNoticeBanner;
