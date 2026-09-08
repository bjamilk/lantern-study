import './global.css';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from './src/navigation';
import { ThemeProvider, useAppTheme } from './src/theme';
import CookieNoticeBanner from './src/components/CookieNoticeBanner';
import { AppDialogHost } from './src/components/ui/AppDialogHost';
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
      {/* The app's own dialog, mounted ONCE for the whole app. `appAlert`
          (src/components/ui/appDialog) queues into it from anywhere — a
          screen, a store, a service — with react-native's `Alert.alert`
          signature. It lives HERE rather than beside ToastHost, which is
          rendered inside the signed-in tab bar: the auth screens raise
          prompts too, and a dialog host that unmounts with the tab bar would
          drop them. */}
      <AppDialogHost />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Seeded with the metrics the native side already knows at load, so the
          first frame of every screen paints with the real insets instead of 0
          and then jumping once measurement lands. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <AppInner />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
