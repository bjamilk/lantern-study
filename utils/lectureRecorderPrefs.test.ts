/**
 * The recorder's memory: what syncs, what does not, and what it refuses to
 * believe.
 *
 * `setLectureLanguages` is not driven here — it writes through the auth store
 * and the settings endpoint, which the shared `applySettingsPatch` tests
 * already cover on both ends. What is driven is the reading half, because that
 * is what decides which `language` reaches Whisper.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LECTURE_LANGUAGE_PREFS,
  currentLectureLanguages,
  usableMicDeviceId,
} from './lectureRecorderPrefs';

describe('currentLectureLanguages', () => {
  it('falls back to auto-detect for a profile that has never set one', () => {
    expect(currentLectureLanguages(undefined)).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
    expect(currentLectureLanguages({})).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
    expect(currentLectureLanguages('not-an-object')).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
  });

  it('reads a stored pair', () => {
    expect(
      currentLectureLanguages({ lecture: { spokenLanguage: 'ig', transcribeTo: 'en' } })
    ).toEqual({ spokenLanguage: 'ig', transcribeTo: 'en' });
  });

  it('narrows a value from a newer build rather than passing it to Whisper', () => {
    expect(
      currentLectureLanguages({ lecture: { spokenLanguage: 'zz', transcribeTo: 'fr' } })
    ).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
  });

  it('is not fooled by an array or a nested object under the key', () => {
    expect(currentLectureLanguages({ lecture: ['en'] })).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
    expect(
      currentLectureLanguages({ lecture: { spokenLanguage: { id: 'en' } } })
    ).toEqual(DEFAULT_LECTURE_LANGUAGE_PREFS);
  });
});

describe('usableMicDeviceId', () => {
  const devices = [{ deviceId: 'built-in' }, { deviceId: 'usb-1' }];

  it('keeps a device that is still plugged in', () => {
    expect(usableMicDeviceId('usb-1', devices)).toBe('usb-1');
  });

  it('drops one that is not', () => {
    // Requesting a `deviceId` that no longer resolves makes getUserMedia throw
    // OverconstrainedError, and the student sees "no microphone found" on a
    // laptop with a perfectly good one.
    expect(usableMicDeviceId('usb-gone', devices)).toBeNull();
  });

  it('has nothing to say when nothing was remembered', () => {
    expect(usableMicDeviceId(null, devices)).toBeNull();
  });
});
