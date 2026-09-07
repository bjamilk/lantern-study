/**
 * The recording preset, as a pure transform of `expo-av`'s HIGH_QUALITY.
 *
 * The defect this fixes: the recorder used HIGH_QUALITY — 128 kbps, stereo,
 * 44.1 kHz — which weighs about 43 MB for a 45-minute lecture, while the
 * server refuses anything over 25 MB. Every long lecture was therefore
 * recorded in full and then thrown away at the upload, after the lecture had
 * ended.
 *
 * Whisper resamples everything to 16 kHz mono before it listens, so the extra
 * bytes bought exactly nothing. Overriding three numbers — sample rate,
 * channels, bitrate — cuts the weight roughly fourfold and keeps the container
 * and codec (m4a / AAC) that the transcription route already accepts. It is
 * written as an override rather than a literal so the container, extension and
 * encoder stay whatever `expo-av` says they should be.
 *
 * It takes the preset as an argument so the test needs no native module.
 */
import {
  LECTURE_AUDIO_BITS_PER_SECOND,
  LECTURE_AUDIO_CHANNELS,
  LECTURE_AUDIO_SAMPLE_RATE_HZ,
} from '@lantern/shared/utils/lectureAudio';

interface PlatformRecordingOptions {
  sampleRate?: number;
  numberOfChannels?: number;
  bitRate?: number;
  [key: string]: unknown;
}

export interface LectureRecordingOptions {
  isMeteringEnabled?: boolean;
  android?: PlatformRecordingOptions;
  ios?: PlatformRecordingOptions;
  web?: { bitsPerSecond?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export function speechRecordingOptions(
  base: LectureRecordingOptions
): LectureRecordingOptions {
  const speech = {
    sampleRate: LECTURE_AUDIO_SAMPLE_RATE_HZ,
    numberOfChannels: LECTURE_AUDIO_CHANNELS,
    bitRate: LECTURE_AUDIO_BITS_PER_SECOND,
  };
  return {
    ...base,
    // Without this the pre-flight card has a level bar and no reading to put
    // in it. It is not a quality setting and must survive every override.
    isMeteringEnabled: true,
    android: { ...(base.android ?? {}), ...speech },
    ios: { ...(base.ios ?? {}), ...speech },
    web: { ...(base.web ?? {}), bitsPerSecond: LECTURE_AUDIO_BITS_PER_SECOND },
  };
}
