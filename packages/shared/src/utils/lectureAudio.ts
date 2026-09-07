/**
 * What a lecture recording actually weighs, and how long one is allowed to be.
 *
 * This module exists because of a defect the last round found: the phone
 * recorded at `HIGH_QUALITY` (128 kbps, stereo, 44.1 kHz ≈ 43 MB for a
 * 45-minute lecture) while the server refuses anything over 25 MB. The
 * rejection landed AFTER the lecture was over — the one moment where a
 * student can do nothing about it. A 45-minute lecture must fit, so the
 * preset is a speech preset, and the limit is printed BEFORE recording starts.
 *
 * Two rules hold here:
 *   1. The recording settings and the "how long fits" sentence come from the
 *      SAME numbers. Nobody types a minute figure anywhere in the app.
 *   2. Both platforms record at the same bitrate, so a lecture that fits on
 *      Android fits in the browser.
 */

/**
 * Mono, 16 kHz, ~32 kbps.
 *
 * This is what a transcription model wants: Whisper downsamples everything to
 * 16 kHz mono internally, so a stereo 44.1 kHz capture spends four times the
 * bytes to deliver the same transcript. 32 kbps of AAC/Opus on speech is
 * transparent enough for transcription — and any accuracy it costs is nothing
 * beside the accuracy of a lecture that was rejected for being too big.
 */
export const LECTURE_AUDIO_SAMPLE_RATE_HZ = 16_000;
export const LECTURE_AUDIO_CHANNELS = 1;
export const LECTURE_AUDIO_BITS_PER_SECOND = 32_000;

/**
 * Containers are not free: MPEG-4 and WebM both add headers, an index and
 * per-frame overhead, and a bitrate target is a target rather than a promise.
 * Estimating 10 % heavy is what keeps the pre-flight sentence a floor rather
 * than a hope — a lecture the card said would fit has to actually fit.
 */
export const LECTURE_AUDIO_OVERHEAD_FACTOR = 1.1;

/**
 * The server's ceiling (apps/api-server/src/routes/notes.ts,
 * `MAX_LECTURE_AUDIO_BYTES`). Mirrored here so the clients can warn before
 * recording instead of after uploading. If the server's figure ever moves,
 * this one moves with it in the same commit.
 */
export const MAX_LECTURE_AUDIO_BYTES = 25 * 1024 * 1024;

/** Bytes a recording of this length is expected to weigh, overhead included. */
export function estimateLectureAudioBytes(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const seconds = durationMs / 1000;
  return Math.round(
    (seconds * LECTURE_AUDIO_BITS_PER_SECOND * LECTURE_AUDIO_OVERHEAD_FACTOR) / 8
  );
}

/**
 * The longest lecture that fits under the byte cap, in whole minutes.
 *
 * Derived, never typed. Floor rather than round: a minute figure that rounds
 * up is a promise the upload cannot keep.
 */
export function maxLectureRecordingMinutes(
  maxBytes: number = MAX_LECTURE_AUDIO_BYTES
): number {
  const bytesPerSecond =
    (LECTURE_AUDIO_BITS_PER_SECOND * LECTURE_AUDIO_OVERHEAD_FACTOR) / 8;
  return Math.max(1, Math.floor(maxBytes / bytesPerSecond / 60));
}

/** Same figure in milliseconds, for a store that wants to stop itself. */
export function maxLectureRecordingMs(maxBytes: number = MAX_LECTURE_AUDIO_BYTES): number {
  return maxLectureRecordingMinutes(maxBytes) * 60_000;
}

/** 0..1 — how full the byte budget is. Drives a "getting long" warning. */
export function lectureAudioFillFraction(
  durationMs: number,
  maxBytes: number = MAX_LECTURE_AUDIO_BYTES
): number {
  if (maxBytes <= 0) return 0;
  const raw = estimateLectureAudioBytes(durationMs) / maxBytes;
  return Math.max(0, Math.min(1, raw));
}

/** True once the estimate says the upload would be refused. */
export function exceedsLectureAudioCap(
  durationMs: number,
  maxBytes: number = MAX_LECTURE_AUDIO_BYTES
): boolean {
  return estimateLectureAudioBytes(durationMs) > maxBytes;
}

/**
 * The pre-flight sentence. "About" because the estimate is an estimate, and
 * the number is computed rather than written down.
 */
export function lectureCapacityLine(maxBytes: number = MAX_LECTURE_AUDIO_BYTES): string {
  return `Up to about ${maxLectureRecordingMinutes(maxBytes)} minutes fit in one lecture.`;
}
