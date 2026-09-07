import {
  LECTURE_AUDIO_BITS_PER_SECOND,
  LECTURE_AUDIO_CHANNELS,
  LECTURE_AUDIO_SAMPLE_RATE_HZ,
  MAX_LECTURE_AUDIO_BYTES,
} from '@lantern/shared/utils/lectureAudio';
import { speechRecordingOptions } from './lectureAudioPreset';

/** A stand-in for `Audio.RecordingOptionsPresets.HIGH_QUALITY`. */
const HIGH_QUALITY = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 2,
    audioEncoder: 3,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'aac ',
    audioQuality: 127,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
    linearPCMBitDepth: 16,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
};

describe('speechRecordingOptions', () => {
  const options = speechRecordingOptions(HIGH_QUALITY);

  it('records speech, not music, on both native platforms', () => {
    for (const platform of ['android', 'ios'] as const) {
      expect(options[platform]).toMatchObject({
        sampleRate: LECTURE_AUDIO_SAMPLE_RATE_HZ,
        numberOfChannels: LECTURE_AUDIO_CHANNELS,
        bitRate: LECTURE_AUDIO_BITS_PER_SECOND,
      });
    }
    expect(options.web?.bitsPerSecond).toBe(LECTURE_AUDIO_BITS_PER_SECOND);
  });

  it('keeps the container and codec the transcription route already accepts', () => {
    // Only three numbers change. Switching to a 3gp/AMR preset would be
    // smaller still and useless — the route would refuse the file.
    expect(options.android).toMatchObject({ extension: '.m4a', outputFormat: 2, audioEncoder: 3 });
    expect(options.ios).toMatchObject({ extension: '.m4a', outputFormat: 'aac ' });
    expect(options.ios?.linearPCMBitDepth).toBe(16);
  });

  it('keeps metering on, whatever the preset said', () => {
    // Without it the pre-flight card has a level bar and no reading to put in
    // it, which is the fake meter this feature exists to not ship.
    expect(speechRecordingOptions({ ...HIGH_QUALITY, isMeteringEnabled: false })
      .isMeteringEnabled).toBe(true);
  });

  it('brings a 45-minute lecture under the size the server accepts', () => {
    const seconds = 45 * 60;
    const before = (seconds * (HIGH_QUALITY.android.bitRate as number)) / 8;
    const after = (seconds * (options.android?.bitRate as number)) / 8;
    expect(before).toBeGreaterThan(MAX_LECTURE_AUDIO_BYTES);
    expect(after).toBeLessThan(MAX_LECTURE_AUDIO_BYTES);
  });

  it('does not mutate the preset it was handed', () => {
    expect(HIGH_QUALITY.android.sampleRate).toBe(44100);
  });
});
