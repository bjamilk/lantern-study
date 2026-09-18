/**
 * The last screen before a lecture starts.
 *
 * It answers the three questions a student actually has while standing in a
 * lecture hall — can it hear me, will the upload work, and is it using the
 * right microphone — and then gets out of the way with one big Start button.
 *
 * Every word on it is a function of a reading (see
 * `@lantern/shared/utils/lectureAudio`, and the phone's `lecturePreflight.ts`,
 * which grades the same room the same way). Nothing here says "Great" about
 * something it has not measured: before the first frame the badge says
 * "Checking", and a browser that will not report connection speed gets
 * "Checking" rather than an invented grade.
 *
 * The one thing that DISABLES Start is being offline, which is a fact rather
 * than a guess — a recording made offline cannot be transcribed, and nothing
 * queues it for later (see `LECTURE_OFFLINE_QUEUEING` on the phone).
 */
import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { Select } from '../ui';
import type { LecturePreCheck } from '../../hooks/useLecturePreCheck';
import {
  LECTURE_LEVEL_SILENT_CAPTION,
  LectureLevelMeter,
} from './LectureLevelMeter';

/** Badge colours by grade. Tokens only — no literal hex anywhere. */
const GRADE_TEXT: Record<string, string> = {
  great: 'text-lantern-success',
  fair: 'text-lantern-warning',
  poor: 'text-lantern-error',
  offline: 'text-lantern-error',
  unknown: 'text-lantern-text-secondary',
};

interface StatusRowProps {
  icon: 'mic' | 'wifi';
  label: string;
  grade: string;
  state: string;
  reason: string;
}

const StatusRow: React.FC<StatusRowProps> = ({ icon, label, grade, state, reason }) => (
  <div className="flex items-start gap-3">
    <AppIcon name={icon} size={20} className="mt-0.5 shrink-0 text-lantern-text-secondary" />
    <div className="min-w-0 flex-1">
      <p className="text-body">
        <span className="text-lantern-text-secondary">{label}: </span>
        <span className={`font-semibold ${GRADE_TEXT[grade] ?? GRADE_TEXT.unknown}`}>{state}</span>
      </p>
      <p className="text-caption text-lantern-text-secondary">{reason}</p>
    </div>
  </div>
);

export interface LecturePreCheckPanelProps {
  preCheck: LecturePreCheck;
  /** The consent checkbox and the honest cost copy, rendered above the meter. */
  consent: React.ReactNode;
  /** Opens the settings popover. */
  onOpenSettings: () => void;
  onStart: () => void;
  starting?: boolean;
  /** False until the student has ticked the consent box. */
  canStart: boolean;
}

export const LecturePreCheckPanel: React.FC<LecturePreCheckPanelProps> = ({
  preCheck,
  consent,
  onOpenSettings,
  onStart,
  starting,
  canStart,
}) => {
  const offline = preCheck.internet.grade === 'offline';
  const hearing = preCheck.levelDb !== null;
  const blocked = offline || !canStart || Boolean(starting);

  return (
    <div className="space-y-4">
      {consent}

      <div className="rounded-lantern-xl border border-lantern-border bg-lantern-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-label uppercase text-lantern-text-secondary">Before you start</h3>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Recorder settings"
            title="Recorder settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-lantern-border text-lantern-text hover:border-lantern-text-tertiary"
          >
            <AppIcon name="settings" size={20} />
          </button>
        </div>

        <div className="mt-3 flex justify-center">
          <LectureLevelMeter levelDb={preCheck.levelDb} size="lg" />
        </div>
        <p className="mt-2 text-center text-caption text-lantern-text-secondary">
          {hearing ? 'We are picking up audio.' : LECTURE_LEVEL_SILENT_CAPTION}
        </p>

        <div className="mt-4 space-y-3 border-t border-lantern-border pt-3">
          <StatusRow
            icon="mic"
            label="Audio quality"
            grade={preCheck.quality.grade}
            state={preCheck.quality.label}
            reason={preCheck.quality.reason}
          />
          <StatusRow
            icon="wifi"
            label="Internet"
            grade={preCheck.internet.grade}
            state={preCheck.internet.label}
            reason={preCheck.internet.reason}
          />

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="lecture-mic-device" className="text-body text-lantern-text-secondary">
              Mic
            </label>
            {preCheck.devices.length > 0 ? (
              <Select
                id="lecture-mic-device"
                value={preCheck.selectedDeviceId ?? preCheck.devices[0]?.deviceId ?? ''}
                onChange={(event) => preCheck.selectDevice(event.target.value)}
                className="min-h-[44px] min-w-0 flex-1"
              >
                {preCheck.devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-caption text-lantern-text-secondary">
                {preCheck.error
                  ? 'No microphone to choose from yet.'
                  : 'Reading the microphones on this computer…'}
              </span>
            )}
          </div>

          {preCheck.error ? (
            <p className="text-caption text-lantern-error">{preCheck.error}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={blocked}
          aria-label="Start recording"
          title="Start recording"
          className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-lantern-feature-recording-ink text-white shadow-lantern-md transition-opacity disabled:opacity-50"
        >
          <AppIcon name="mic" size={32} />
        </button>
        <span className="text-body font-semibold text-lantern-text">
          {starting ? 'Starting…' : 'Start recording'}
        </span>
        {offline ? (
          <p className="text-caption text-lantern-error">
            You are offline. Recording would work, but we could not transcribe it — reconnect
            first.
          </p>
        ) : !canStart ? (
          <p className="text-caption text-lantern-text-secondary">
            Tick the box above to confirm you can record this lecture.
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default LecturePreCheckPanel;
