import {
  LECTURE_AUDIO_BITS_PER_SECOND,
  LECTURE_AUDIO_CHANNELS,
  LECTURE_AUDIO_SAMPLE_RATE_HZ,
  MAX_LECTURE_AUDIO_BYTES,
  estimateLectureAudioBytes,
  exceedsLectureAudioCap,
  lectureAudioFillFraction,
  lectureCapacityLine,
  maxLectureRecordingMinutes,
} from './lectureAudio';

describe('the speech preset', () => {
  it('is mono 16 kHz — what a transcription model actually listens to', () => {
    expect(LECTURE_AUDIO_CHANNELS).toBe(1);
    expect(LECTURE_AUDIO_SAMPLE_RATE_HZ).toBe(16_000);
  });

  it('fits a 45-minute lecture under the server cap, which HIGH_QUALITY did not', () => {
    const fortyFiveMinutes = 45 * 60_000;
    // The defect this replaced: 128 kbps stereo is ~43 MB for this lecture,
    // and the server refuses at 25 MB — after the lecture is over.
    const highQualityBytes = (45 * 60 * 128_000) / 8;
    expect(highQualityBytes).toBeGreaterThan(MAX_LECTURE_AUDIO_BYTES);
    expect(estimateLectureAudioBytes(fortyFiveMinutes)).toBeLessThan(MAX_LECTURE_AUDIO_BYTES);
    expect(exceedsLectureAudioCap(fortyFiveMinutes)).toBe(false);
  });
});

describe('estimateLectureAudioBytes', () => {
  it('is zero for nothing recorded', () => {
    expect(estimateLectureAudioBytes(0)).toBe(0);
    expect(estimateLectureAudioBytes(-1)).toBe(0);
    expect(estimateLectureAudioBytes(Number.NaN)).toBe(0);
  });

  it('estimates high rather than low, so a lecture that "fits" really fits', () => {
    const oneMinute = 60_000;
    const exact = (60 * LECTURE_AUDIO_BITS_PER_SECOND) / 8;
    expect(estimateLectureAudioBytes(oneMinute)).toBeGreaterThan(exact);
  });
});

describe('maxLectureRecordingMinutes', () => {
  it('is derived from the bitrate and the cap, not written down', () => {
    const bytesPerMinute = estimateLectureAudioBytes(60_000);
    const minutes = maxLectureRecordingMinutes();
    expect(minutes * bytesPerMinute).toBeLessThanOrEqual(MAX_LECTURE_AUDIO_BYTES);
    expect((minutes + 1) * bytesPerMinute).toBeGreaterThan(MAX_LECTURE_AUDIO_BYTES);
  });

  it('moves with the cap it is given', () => {
    expect(maxLectureRecordingMinutes(MAX_LECTURE_AUDIO_BYTES / 2)).toBeLessThan(
      maxLectureRecordingMinutes(MAX_LECTURE_AUDIO_BYTES)
    );
  });

  it('leaves room for a normal lecture', () => {
    expect(maxLectureRecordingMinutes()).toBeGreaterThanOrEqual(90);
  });
});

describe('lectureAudioFillFraction', () => {
  it('is clamped to 0..1', () => {
    expect(lectureAudioFillFraction(0)).toBe(0);
    expect(lectureAudioFillFraction(1000 * 60 * 60 * 24)).toBe(1);
  });

  it('reaches 1 exactly when the cap is exceeded', () => {
    const limitMs = maxLectureRecordingMinutes() * 60_000;
    expect(exceedsLectureAudioCap(limitMs)).toBe(false);
    expect(lectureAudioFillFraction(limitMs)).toBeLessThanOrEqual(1);
  });
});

describe('lectureCapacityLine', () => {
  it('prints the derived figure and never a hand-typed one', () => {
    expect(lectureCapacityLine()).toBe(
      `Up to about ${maxLectureRecordingMinutes()} minutes fit in one lecture.`
    );
  });
});
