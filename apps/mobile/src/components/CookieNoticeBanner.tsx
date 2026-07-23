import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Linking,
  Modal,
  ScrollView,
  Switch,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COOKIE_CATEGORIES,
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  OPEN_COOKIE_PREFERENCES_EVENT,
  acceptAllCookiePreferences,
  defaultCookiePreferences,
  essentialOnlyCookiePreferences,
  hasRecordedCookieChoice,
  resolveCookiePreferences,
  serializeCookiePreferences,
  type CookieCategoryId,
  type CookiePreferences,
} from '@lantern/shared';
import { notifyProductAnalyticsConsentChange } from '../services/productAnalytics';

/** Body height excluding safe-area padding — keep in sync with banner layout. */
export const COOKIE_NOTICE_BODY_HEIGHT = 110;

type DraftPrefs = Pick<CookiePreferences, 'functional' | 'analytics' | 'advertising'>;

async function persistPrefs(prefs: CookiePreferences) {
  const payload = serializeCookiePreferences({
    ...prefs,
    necessary: true,
    updatedAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(COOKIE_PREFS_STORAGE_KEY, payload);
  await AsyncStorage.setItem(COOKIE_NOTICE_LEGACY_KEY, 'dismissed');
  await notifyProductAnalyticsConsentChange(prefs);
}

async function readStoredPrefs(): Promise<CookiePreferences | null> {
  const prefsRaw = await AsyncStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
  const legacyRaw = await AsyncStorage.getItem(COOKIE_NOTICE_LEGACY_KEY);
  return resolveCookiePreferences(prefsRaw, legacyRaw);
}

export function openCookiePreferenceCenter() {
  DeviceEventEmitter.emit(OPEN_COOKIE_PREFERENCES_EVENT);
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
  const [bannerVisible, setBannerVisible] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [hasChoice, setHasChoice] = useState(true);
  const [expanded, setExpanded] = useState<CookieCategoryId | null>('necessary');
  const [draft, setDraft] = useState<DraftPrefs>({
    functional: false,
    analytics: false,
    advertising: false,
  });

  const syncDraftFromStored = useCallback(async () => {
    const stored = (await readStoredPrefs()) ?? defaultCookiePreferences();
    setDraft({
      functional: stored.functional,
      analytics: stored.analytics,
      advertising: stored.advertising,
    });
  }, []);

  const openCenter = useCallback(() => {
    void syncDraftFromStored().then(() => setCenterOpen(true));
  }, [syncDraftFromStored]);

  useEffect(() => {
    void (async () => {
      const prefsRaw = await AsyncStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
      const legacyRaw = await AsyncStorage.getItem(COOKIE_NOTICE_LEGACY_KEY);
      const choice = hasRecordedCookieChoice(prefsRaw, legacyRaw);
      setHasChoice(choice);
      if (!choice) setBannerVisible(true);
    })();
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(OPEN_COOKIE_PREFERENCES_EVENT, openCenter);
    return () => sub.remove();
  }, [openCenter]);

  const persistAndClose = (prefs: CookiePreferences) => {
    void persistPrefs(prefs).then(() => {
      setHasChoice(true);
      setBannerVisible(false);
      setCenterOpen(false);
    });
  };

  const closeCenterWithoutSaving = () => {
    setCenterOpen(false);
    if (!hasChoice) setBannerVisible(true);
  };

  const confirmChoices = () => {
    persistAndClose({
      ...essentialOnlyCookiePreferences(),
      ...draft,
      necessary: true,
    });
  };

  return (
    <>
      {bannerVisible && !centerOpen && (
        <View
          className="absolute bottom-0 left-0 right-0 z-50 border-t border-lantern-border bg-lantern-surface dark:bg-lantern-background px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Text className="text-xs text-lantern-text leading-snug mb-2">
            Essential on-device storage keeps you signed in. Optional first-party analytics help improve Lantern and stay
            off unless you allow them.{' '}
            <Text
              className="text-lantern-primary underline"
              onPress={() => void Linking.openURL('https://lanternstudy.com/cookies')}
            >
              Cookie Policy
            </Text>
          </Text>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={openCenter}
              className="flex-1 shrink-0 rounded-lg border border-lantern-border px-2 py-2.5 active:opacity-90"
              accessibilityRole="button"
              accessibilityLabel="Manage cookie preferences"
            >
              <Text className="text-sm font-semibold text-lantern-text text-center">Manage</Text>
            </Pressable>
            <Pressable
              onPress={() => persistAndClose(essentialOnlyCookiePreferences())}
              className="flex-1 shrink-0 rounded-lg border border-lantern-border px-2 py-2.5 active:opacity-90"
              accessibilityRole="button"
              accessibilityLabel="Essential storage only"
            >
              <Text className="text-sm font-semibold text-lantern-text text-center">Essential</Text>
            </Pressable>
            <Pressable
              onPress={() => persistAndClose(acceptAllCookiePreferences())}
              className="flex-1 shrink-0 rounded-lg bg-lantern-primary px-2 py-2.5 active:opacity-90"
              accessibilityRole="button"
              accessibilityLabel="Accept all including analytics"
            >
              <Text className="text-sm font-semibold text-white text-center">Accept all</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Modal
        visible={centerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCenterWithoutSaving}
      >
        <View
          className="flex-1 bg-lantern-background"
          style={{ paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="flex-row items-start justify-between px-4 pb-3 border-b border-lantern-border">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-semibold text-lantern-text">Cookie preferences</Text>
              <Text className="text-xs text-lantern-text-secondary mt-1 leading-relaxed">
                Choose optional categories. Strictly necessary storage always stays on. Change this anytime in Settings.
              </Text>
            </View>
            <Pressable
              onPress={closeCenterWithoutSaving}
              accessibilityRole="button"
              accessibilityLabel="Close cookie preferences"
              className="px-2 py-1"
            >
              <Text className="text-2xl leading-none text-lantern-text-secondary">×</Text>
            </Pressable>
          </View>

          <ScrollView className="flex-1 px-4 py-3" contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
            {COOKIE_CATEGORIES.map((category) => {
              const isOpen = expanded === category.id;
              const enabled =
                category.id === 'necessary'
                  ? true
                  : draft[category.id as Exclude<CookieCategoryId, 'necessary'>];

              return (
                <View key={category.id} className="rounded-xl border border-lantern-border overflow-hidden">
                  <View className="flex-row items-center gap-2 px-3 py-3">
                    <Pressable
                      className="flex-1 min-w-0"
                      onPress={() => setExpanded(isOpen ? null : category.id)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isOpen }}
                    >
                      <Text className="text-sm font-medium text-lantern-text">{category.title}</Text>
                      {!category.currentlyDeployed && category.id !== 'necessary' && (
                        <Text className="text-[11px] text-lantern-text-secondary mt-0.5">
                          Choice saved — no cookies of this type are loaded yet
                        </Text>
                      )}
                    </Pressable>
                    {category.required ? (
                      <Text className="text-[11px] font-medium uppercase tracking-wide text-lantern-text-secondary">
                        Always on
                      </Text>
                    ) : (
                      <Switch
                        value={enabled}
                        onValueChange={(val) => {
                          setDraft((prev) => ({
                            ...prev,
                            [category.id]: val,
                          }));
                        }}
                        accessibilityLabel={`${category.title} cookies`}
                      />
                    )}
                  </View>
                  {isOpen && (
                    <View className="px-3 pb-3 border-t border-lantern-border/60 pt-2">
                      <Text className="text-xs text-lantern-text-secondary leading-relaxed">{category.summary}</Text>
                      {category.examples.map((example) => (
                        <Text key={example} className="text-xs text-lantern-text-secondary mt-1">
                          • {example}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View className="px-4 pt-3 border-t border-lantern-border gap-2">
            <Pressable
              onPress={() => persistAndClose(essentialOnlyCookiePreferences())}
              className="rounded-lg border border-lantern-border px-4 py-3 active:opacity-90"
              accessibilityRole="button"
            >
              <Text className="text-sm font-semibold text-lantern-text text-center">Essential only</Text>
            </Pressable>
            <Pressable
              onPress={confirmChoices}
              className="rounded-lg bg-lantern-primary px-4 py-3 active:opacity-90"
              accessibilityRole="button"
            >
              <Text className="text-sm font-semibold text-white text-center">Confirm my choices</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default CookieNoticeBanner;
