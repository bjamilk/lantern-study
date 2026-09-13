import React from 'react';
import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';

/**
 * The SAME asset the native splash draws, so the mark does not change shape or
 * size at the hand-off. It is the dark-ink ROUNDED SQUARE (launcher geometry,
 * ~22% corner radius) with the white flame, already baked into the PNG on a
 * transparent canvas — not a square image rounded at render time, which relied
 * on RN's `borderRadius` clipping and read as a circle on the native side.
 */
const markSource = require('../../assets/splash-icon.png');

/**
 * Matches `imageWidth: 280` in the app.config.ts splash block — keep the two in
 * lockstep or the mark jumps size at the native → JS hand-off. The asset's
 * square is 440 px on its 1024 canvas (inscribed in Android 12's circular
 * splash mask), so a 280 dp box draws a ~120 dp square.
 */
const MARK_SIZE = 280;

/**
 * Matches the native Expo splash background in app.config.ts — keep the two
 * literals in lockstep or the JS boot screen flashes a different ground the
 * instant the native splash hands over.
 *
 * Round 2 pivot: was the indigo `#6569EE`. The splash is now the app's own
 * CREAM paper ground with the dark-ink lantern mark on it, rather than a
 * full-bleed brand colour — so the first frame of the app is the same ground
 * the app actually has, and the mark is the same one Android draws on the
 * home screen.
 *
 * NOT a `brand.*` getter: this is read by `StyleSheet.create` at module scope,
 * which evaluates once at import time and would freeze to whichever theme was
 * current then. See theme/brand.ts.
 */
const SPLASH_BACKGROUND_COLOR = '#F7F6EF';
/** The ink on that cream, and the mark's own ground. */
const SPLASH_INK = '#191919';

export function BootLoadingScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={markSource}
        style={styles.mark}
        resizeMode="contain"
        accessibilityLabel="Lantern Study"
      />
      <ActivityIndicator size="large" color={SPLASH_INK} style={styles.spinner} />
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
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
  spinner: {
    marginTop: 32,
  },
});
