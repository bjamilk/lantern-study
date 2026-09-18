/**
 * The ⚙ popover on the recorder: which language is being spoken, where the
 * transcript should land, and which microphone.
 *
 * The languages are an ACCOUNT preference (`UserSettings.lecture`) because a
 * student who lectures in Yoruba lectures in Yoruba on the phone too; the
 * microphone is a fact about this laptop and stays in `localStorage`. Both
 * halves live in `utils/lectureRecorderPrefs.ts`.
 *
 * The honest bit is "Transcribe to". Whisper's translate task produces
 * ENGLISH and nothing else, so the list has exactly two entries. Offering
 * "Transcribe to Yoruba" would be a promise the model cannot keep, which is
 * why `LECTURE_TRANSCRIBE_TARGETS` is a shared constant rather than a local
 * array someone could extend.
 */
import React from 'react';
import {
  LECTURE_SPOKEN_LANGUAGES,
  LECTURE_TRANSCRIBE_TARGETS,
} from '@lantern/shared/utils/lectureAudio';
import { Select } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import type { LectureLanguagePrefs } from '../../utils/lectureRecorderPrefs';
import type { MicDeviceOption } from '../../hooks/useLecturePreCheck';

export interface LectureRecorderSettingsProps {
  languages: LectureLanguagePrefs;
  onChangeLanguages: (patch: {
    spokenLanguage?: string;
    transcribeTo?: string;
  }) => void;
  devices: MicDeviceOption[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
  onClose: () => void;
}

export const LectureRecorderSettings: React.FC<LectureRecorderSettingsProps> = ({
  languages,
  onChangeLanguages,
  devices,
  selectedDeviceId,
  onSelectDevice,
  onClose,
}) => (
  <div
    role="group"
    aria-label="Recorder settings"
    className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4 shadow-lantern-md"
  >
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-label uppercase text-lantern-text-secondary">Recorder settings</h3>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close recorder settings"
        title="Close recorder settings"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text hover:bg-lantern-background"
      >
        <AppIcon name="close" size={20} />
      </button>
    </div>

    <div className="space-y-1">
      <label htmlFor="lecture-spoken-language" className="text-body text-lantern-text">
        Speaking language
      </label>
      <Select
        id="lecture-spoken-language"
        value={languages.spokenLanguage}
        onChange={(event) => onChangeLanguages({ spokenLanguage: event.target.value })}
        className="min-h-[44px] w-full"
      >
        {LECTURE_SPOKEN_LANGUAGES.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </Select>
      <p className="text-caption text-lantern-text-secondary">
        Auto-detect lets the model work it out, which is usually right. Picking the language helps
        when a lecture switches between two.
      </p>
    </div>

    <div className="space-y-1">
      <label htmlFor="lecture-transcribe-to" className="text-body text-lantern-text">
        Transcribe to
      </label>
      <Select
        id="lecture-transcribe-to"
        value={languages.transcribeTo}
        onChange={(event) => onChangeLanguages({ transcribeTo: event.target.value })}
        className="min-h-[44px] w-full"
      >
        {LECTURE_TRANSCRIBE_TARGETS.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </Select>
      <p className="text-caption text-lantern-text-secondary">
        English is the only language we can translate a lecture INTO. Any other target would be a
        promise we cannot keep, so it is not offered.
      </p>
    </div>

    <div className="space-y-1">
      <label htmlFor="lecture-settings-mic" className="text-body text-lantern-text">
        Mic
      </label>
      {devices.length > 0 ? (
        <Select
          id="lecture-settings-mic"
          value={selectedDeviceId ?? devices[0]?.deviceId ?? ''}
          onChange={(event) => onSelectDevice(event.target.value)}
          className="min-h-[44px] w-full"
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-caption text-lantern-text-secondary">
          We can only list microphones once you have allowed mic access on this site.
        </p>
      )}
    </div>
  </div>
);

export default LectureRecorderSettings;
