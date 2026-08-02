import { NativeModules, Platform } from 'react-native';

/**
 * Best-effort iOS Simulator detection.
 * Expo's `expo-av` cannot record microphone audio on the Simulator (Apple limitation).
 */
export function isIosSimulator(): boolean {
  if (Platform.OS !== 'ios') return false;
  const expoConstants = NativeModules.ExponentConstants as { isDevice?: boolean } | undefined;
  if (typeof expoConstants?.isDevice === 'boolean') {
    return !expoConstants.isDevice;
  }
  return false;
}
