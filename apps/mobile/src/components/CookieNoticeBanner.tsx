import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'lantern_cookie_notice_v1';

export function CookieNoticeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (!value) setVisible(true);
    });
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    void AsyncStorage.setItem(STORAGE_KEY, 'dismissed');
    setVisible(false);
  };

  return (
    <View className="absolute bottom-0 left-0 right-0 z-50 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 py-3">
      <Text className="text-sm text-slate-700 dark:text-slate-200 mb-3 leading-relaxed">
        Lantern Study uses only essential on-device storage (sign-in session, theme, and preferences).
        We do not use analytics or advertising cookies.{' '}
        <Text
          className="text-indigo-600 dark:text-indigo-400 underline"
          onPress={() => void Linking.openURL('https://lanternstudy.com/cookies')}
        >
          Cookie Notice
        </Text>
      </Text>
      <Pressable
        onPress={dismiss}
        className="self-start rounded-lg bg-indigo-600 px-4 py-2 active:opacity-90"
      >
        <Text className="text-sm font-medium text-white">Got it</Text>
      </Pressable>
    </View>
  );
}

export default CookieNoticeBanner;
