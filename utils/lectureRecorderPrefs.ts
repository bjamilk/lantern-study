/**
 * What the lecture recorder remembers between lectures.
 *
 * Two different kinds of memory, deliberately kept apart:
 *
 *  - The two LANGUAGE choices are an account preference. A student who
 *    lectures in Yoruba lectures in Yoruba on the phone as well, so they ride
 *    in `UserSettings.lecture` and sync. Written the same way the tutor-style
 *    picker writes (`utils/tutorStyle.ts`): write-through to the profile in
 *    memory, then a category-only patch that the server deep-merges, so a
 *    concurrent theme or checklist save is not clobbered.
 *  - The MIC DEVICE is a fact about this laptop and nothing else. A
 *    `deviceId` from one machine means nothing on another, so it lives in
 *    `localStorage` and never syncs.
 *
 * Gotchas:
 *  - Signed out, `setLectureLanguages` does nothing rather than throwing: the
 *    recorder can render before the profile lands.
 *  - Every read goes through the shared allowlists, so a stored value from a
 *    newer build resolves to the default instead of reaching Whisper.
 *  - `localStorage` throws in a private window with site data blocked. Both
 *    accessors swallow it — a forgotten microphone is not an error worth
 *    telling a student about, the browser just picks the default input.
 */
import {
  DEFAULT_LECTURE_SPOKEN_LANGUAGE,
  DEFAULT_LECTURE_TRANSCRIBE_TARGET,
  normalizeLectureSpokenLanguage,
  normalizeLectureTranscribeTarget,
  type LectureSpokenLanguageId,
  type LectureTranscribeTarget,
} from '@lantern/shared/utils/lectureAudio';
import { saveUserSettingsDetailed } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

export interface LectureLanguagePrefs {
  spokenLanguage: LectureSpokenLanguageId;
  transcribeTo: LectureTranscribeTarget;
}

export const DEFAULT_LECTURE_LANGUAGE_PREFS: LectureLanguagePrefs = {
  spokenLanguage: DEFAULT_LECTURE_SPOKEN_LANGUAGE,
  transcribeTo: DEFAULT_LECTURE_TRANSCRIBE_TARGET,
};

/**
 * The two choices this account is on, read off the settings blob.
 *
 * Takes the blob rather than reading the store itself, so a component can
 * subscribe to `currentUser.settings` and re-render when it changes.
 */
export function currentLectureLanguages(settings: unknown): LectureLanguagePrefs {
  const lecture =
    settings && typeof settings === 'object'
      ? (settings as { lecture?: unknown }).lecture
      : undefined;
  const record =
    lecture && typeof lecture === 'object' && !Array.isArray(lecture)
      ? (lecture as Record<string, unknown>)
      : {};
  return {
    spokenLanguage: normalizeLectureSpokenLanguage(record.spokenLanguage),
    transcribeTo: normalizeLectureTranscribeTarget(record.transcribeTo),
  };
}

/**
 * Change one or both. Returns what is now in effect, so a caller that passed
 * junk is told what the student is actually on rather than assuming.
 */
export function setLectureLanguages(patch: {
  spokenLanguage?: unknown;
  transcribeTo?: unknown;
}): LectureLanguagePrefs {
  const user = useAuthStore.getState().currentUser;
  const settings =
    user?.settings && typeof user.settings === 'object'
      ? (user.settings as unknown as Record<string, unknown>)
      : {};
  const current = currentLectureLanguages(settings);
  const next: LectureLanguagePrefs = {
    spokenLanguage:
      patch.spokenLanguage !== undefined
        ? normalizeLectureSpokenLanguage(patch.spokenLanguage)
        : current.spokenLanguage,
    transcribeTo:
      patch.transcribeTo !== undefined
        ? normalizeLectureTranscribeTarget(patch.transcribeTo)
        : current.transcribeTo,
  };
  if (!user?.id) return next;

  // Only this key changes. The rest of the blob is carried forward untouched.
  useAuthStore.getState().setCurrentUser({
    ...user,
    settings: {
      ...settings,
      lecture: next,
      updatedAt: new Date().toISOString(),
    },
  } as typeof user);

  void saveUserSettingsDetailed(user.id, { lecture: next }).then((result) => {
    if (!result.ok) {
      // Not surfaced: the choice is already in effect on this device and the
      // next recording re-sends it. Nothing for the student to do about it.
      console.warn('Failed to save lecture language preference');
    }
  });

  return next;
}

/* ------------------------------------------------------------ consent --- */

/**
 * Has this account already answered the recording-consent card?
 *
 * Read off the same `lecture` settings category as the languages, so a student
 * is asked once rather than before every lecture. It rides with the account
 * because the question ("may you record this?") is about the student, not about
 * the laptop they happen to be sitting at.
 */
export function lectureConsentRemembered(settings: unknown): boolean {
  const lecture =
    settings && typeof settings === 'object'
      ? (settings as { lecture?: unknown }).lecture
      : undefined;
  if (!lecture || typeof lecture !== 'object' || Array.isArray(lecture)) return false;
  return (lecture as Record<string, unknown>).recordingConsent === true;
}

/**
 * Remember a "Yes, record now".
 *
 * Deliberately one-way: nothing here writes `false`. The card is a confirmation
 * the student gives, not a toggle the app flips back on their behalf — and a
 * declined take simply does not start.
 */
export function rememberLectureConsent(): void {
  const user = useAuthStore.getState().currentUser;
  const settings =
    user?.settings && typeof user.settings === 'object'
      ? (user.settings as unknown as Record<string, unknown>)
      : {};
  if (!user?.id) return;
  const current = currentLectureLanguages(settings);
  const next = { ...current, recordingConsent: true };
  useAuthStore.getState().setCurrentUser({
    ...user,
    settings: {
      ...settings,
      lecture: next,
      updatedAt: new Date().toISOString(),
    },
  } as typeof user);
  void saveUserSettingsDetailed(user.id, { lecture: next }).then((result) => {
    if (!result.ok) {
      // Not surfaced: the worst case is being asked once more next time.
      console.warn('Failed to save lecture consent preference');
    }
  });
}

/* --------------------------------------------------------- mic device --- */

const MIC_DEVICE_KEY = 'lantern:lecture:micDeviceId';

/** The last microphone this browser recorded with, or `null`. */
export function rememberedMicDeviceId(): string | null {
  try {
    const value = window.localStorage.getItem(MIC_DEVICE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function rememberMicDeviceId(deviceId: string | null): void {
  try {
    if (deviceId && deviceId.trim()) {
      window.localStorage.setItem(MIC_DEVICE_KEY, deviceId);
    } else {
      window.localStorage.removeItem(MIC_DEVICE_KEY);
    }
  } catch {
    // Private window, blocked site data. The browser picks the default input.
  }
}

/**
 * The remembered device, but only if it is still plugged in.
 *
 * A `deviceId` that no longer resolves would make `getUserMedia` throw
 * `OverconstrainedError` and the student would see "no microphone found" on a
 * laptop with a perfectly good one — so a stale id is dropped, not requested.
 */
export function usableMicDeviceId(
  remembered: string | null,
  devices: readonly { deviceId: string }[]
): string | null {
  if (!remembered) return null;
  return devices.some((device) => device.deviceId === remembered) ? remembered : null;
}
