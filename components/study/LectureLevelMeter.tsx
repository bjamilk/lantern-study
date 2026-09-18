/**
 * A row of bars that moves when the microphone hears something.
 *
 * Twelve discrete bars rather than one smooth fill, because a smooth bar
 * reads as progress and this is a level. It is drawn twice: large in the
 * pre-check panel, and small beside the clock while recording.
 *
 * The caption is the honest half. Before anything is heard the meter says so
 * in words — "This waveform will move if we are picking up audio" — instead of
 * showing an empty bar that could equally mean "broken" or "quiet room".
 */
import React from 'react';
import { lectureLevelBarCount } from '@lantern/shared/utils/lectureAudio';

export const LECTURE_LEVEL_BAR_COUNT = 12;

export const LECTURE_LEVEL_SILENT_CAPTION =
  'This waveform will move if we are picking up audio.';

interface LectureLevelMeterProps {
  /** dBFS, or `null` before the first reading. */
  levelDb: number | null;
  size?: 'sm' | 'lg';
  /** Screen-reader name; the bars themselves are decorative. */
  label?: string;
}

export const LectureLevelMeter: React.FC<LectureLevelMeterProps> = ({
  levelDb,
  size = 'lg',
  label = 'Microphone input level',
}) => {
  const lit = lectureLevelBarCount(levelDb, LECTURE_LEVEL_BAR_COUNT);
  const height = size === 'lg' ? 'h-8' : 'h-4';
  const width = size === 'lg' ? 'w-2' : 'w-1';
  const gap = size === 'lg' ? 'gap-1.5' : 'gap-0.5';

  return (
    <div
      className={`flex items-end ${gap} ${height}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={LECTURE_LEVEL_BAR_COUNT}
      aria-valuenow={lit}
    >
      {Array.from({ length: LECTURE_LEVEL_BAR_COUNT }, (_, index) => {
        const on = index < lit;
        // The bars rise across the row so a half-lit meter reads as a level
        // even for someone who cannot tell the two colours apart.
        const scale = 0.45 + (index / (LECTURE_LEVEL_BAR_COUNT - 1)) * 0.55;
        return (
          <span
            key={index}
            aria-hidden="true"
            style={{ height: `${Math.round(scale * 100)}%` }}
            className={`${width} rounded-full transition-colors ${
              on ? 'bg-lantern-feature-recording-ink' : 'bg-lantern-border'
            }`}
          />
        );
      })}
    </div>
  );
};

export default LectureLevelMeter;
