import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { LanternLogo } from './LanternLogo';

/** Matches native Expo splash background in app.config.ts */
const SPLASH_BACKGROUND_COLOR = '#4f46e5';

export function BootLoadingScreen() {
  return (
    <View style={styles.container}>
      <LanternLogo size={260} />
      <ActivityIndicator size="large" color="#ffffff" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginTop: 32,
  },
});
