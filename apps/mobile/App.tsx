import './global.css';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from './src/navigation';
import { ThemeProvider, useAppTheme } from './src/theme';
import CookieNoticeBanner from './src/components/CookieNoticeBanner';
import { checkAndApplyOtaUpdate } from './src/services/otaUpdates';
import { hydrateProductAnalyticsPrefs } from './src/services/productAnalytics';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function AppInner() {
  const theme = useAppTheme();

  useEffect(() => {
    void hydrateProductAnalyticsPrefs();
    // Native ON_LOAD may only download; apply immediately once JS is up.
    void checkAndApplyOtaUpdate().then((result) => {
      if (result.reason && result.reason !== 'up-to-date') {
        console.log('[OTA]', result.reason, {
          enabled: result.isEnabled,
          channel: result.channel,
          updateId: result.updateId,
        });
      }
    });
  }, []);

  return (
    <>
      <RootNavigator />
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <CookieNoticeBanner />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppInner />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
