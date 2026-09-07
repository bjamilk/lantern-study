/**
 * Android foreground service for lecture recording — the JS side.
 *
 * WHY A LOCAL NATIVE MODULE, and not a library:
 *
 * Nothing in the Expo SDK starts a foreground service. `expo-av` opens the
 * microphone and `setAudioModeAsync({ staysActiveInBackground: true })` keeps
 * it open while the app is merely backgrounded — but once the screen goes off,
 * Android suspends the process and the recording stops, silently, mid-lecture.
 * The only thing that prevents that is a running foreground service whose type
 * is `microphone` (Android 10+ requires the type; Android 14+ requires the
 * matching FOREGROUND_SERVICE_MICROPHONE permission).
 *
 * `expo-audio` — the SDK 54 successor to `expo-av` — does not change this: it
 * has no foreground-service of its own either, so switching to it would have
 * cost a rewrite of the recorder and bought nothing for the actual problem.
 * `expo-av` stays; this module is added beside it.
 *
 * It is a LOCAL module (`apps/mobile/modules/**`, autolinked by Expo) rather
 * than an npm dependency, so the EAS slim lockfile does not need regenerating
 * for it. It needs a full native rebuild, which the founder approved.
 *
 * Everything here degrades to a no-op when the native side is absent — Expo
 * Go, iOS, and any build made before this commit — because the recorder must
 * keep working there, just without the screen-off guarantee.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

interface LectureRecordingServiceNativeModule {
  startService: (title: string, body: string) => boolean;
  stopService: () => boolean;
}

const native = requireOptionalNativeModule<LectureRecordingServiceNativeModule>(
  'LectureRecordingService'
);

/**
 * True when a screen-off recording will actually survive. The pre-flight card
 * reads this so it can promise the guarantee only where it exists.
 */
export const hasLectureForegroundService = Platform.OS === 'android' && native != null;

/** Show the ongoing notification and hold the microphone. Safe to call twice. */
export function startLectureForegroundService(title: string, body: string): boolean {
  if (!native) return false;
  try {
    return native.startService(title, body) !== false;
  } catch {
    // A recording that cannot get a service is still a recording. It just
    // stops when the screen does, which is what the card already says.
    return false;
  }
}

/** Take the notification down. Must run on EVERY path out of `recording`. */
export function stopLectureForegroundService(): boolean {
  if (!native) return false;
  try {
    return native.stopService() !== false;
  } catch {
    return false;
  }
}
