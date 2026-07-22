import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  acceptAllCookiePreferences,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  serializeCookiePreferences,
  type CookiePreferences,
} from '@lantern/shared';
import { notifyProductAnalyticsConsentChange } from '../services/productAnalytics';

/** Body height excluding safe-area padding — keep in sync with banner layout. */
export const COOKIE_NOTICE_BODY_HEIGHT = 110;

async function persistPrefs(prefs: CookiePreferences) {
  const payload = serializeCookiePreferences(prefs);
  await AsyncStorage.setItem(COOKIE_PREFS_STORAGE_KEY, payload);
  await AsyncStorage.setItem(COOKIE_NOTICE_LEGACY_KEY, 'dismissed');
  await notifyProductAnalyticsConsentChange(prefs);
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

  const chooseEssential = () => {
    void persistPrefs(essentialOnlyCookiePreferences()).then(() => setVisible(false));
  };

  const chooseAcceptAll = () => {
    void persistPrefs(acceptAllCookiePreferences()).then(() => setVisible(false));
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-50 border-t border-lantern-border bg-lantern-surface dark:bg-lantern-background px-4 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <Text className="text-xs text-lantern-text leading-snug mb-2">
        Essential on-device storage keeps you signed in. Optional first-party analytics help improve Lantern and stay off
        unless you allow them.{' '}
        <Text
          className="text-lantern-primary underline"
          onPress={() => void Linking.openURL('https://lanternstudy.com/cookies')}
        >
          Cookie Policy
        </Text>
      </Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={chooseEssential}
          className="flex-1 shrink-0 rounded-lg border border-lantern-border px-3 py-2.5 active:opacity-90"
          accessibilityRole="button"
          accessibilityLabel="Essential storage only"
        >
          <Text className="text-sm font-semibold text-lantern-text text-center">Essential only</Text>
        </Pressable>
        <Pressable
          onPress={chooseAcceptAll}
          className="flex-1 shrink-0 rounded-lg bg-lantern-primary px-3 py-2.5 active:opacity-90"
          accessibilityRole="button"
          accessibilityLabel="Accept all including analytics"
        >
          <Text className="text-sm font-semibold text-white text-center">Accept all</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default CookieNoticeBanner;
