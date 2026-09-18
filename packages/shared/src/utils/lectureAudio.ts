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

/* ======================================================================
 * PRE-CHECK: what the recorder can measure BEFORE a lecture starts.
 *
 * Everything below is a pure function of a reading, shared by the browser
 * (Web Audio `AnalyserNode` on the `getUserMedia` stream) and the phone
 * (expo-av metering, which reports dBFS directly). One vocabulary, one set
 * of thresholds, so the two platforms cannot disagree about what "Great"
 * means.
 *
 * The rule the mobile pre-flight card already lives by holds here too: a
 * reading we do not have is `unknown`, never an optimistic default. A card
 * that says "Audio quality: Great" over a muted microphone is the exact
 * failure this code exists to prevent.
 * ==================================================================== */

/**
 * The words are thresholds on dBFS, where 0 dB is the loudest the mic can go.
 *
 * Moved here from `apps/mobile/src/components/lecture/lecturePreflight.ts`
 * (which now re-exports them) so the browser meter and the phone meter draw
 * the same bar for the same room.
 */
export const LECTURE_LEVEL_THRESHOLDS_DB = {
  /** At or below this we are hearing room noise, not a voice. */
  silentMax: -45,
  /** Above `silentMax` and at or below this: audible but thin. */
  quietMax: -30,
  /** Above `quietMax` and below this: what a transcript wants. */
  loudMin: -8,
} as const;

/** The dB span the bar draws; anything quieter than this pins the bar at empty. */
export const LECTURE_LEVEL_BAR_FLOOR_DB = -60;

export type LectureLevelWord = 'Silent' | 'Quiet' | 'Good' | 'Loud';

/**
 * `null` in means `null` out — "no reading yet" is a state of its own and is
 * never rounded up into "Silent", which would be a claim about the room.
 */
export function lectureLevelWord(db: number | null | undefined): LectureLevelWord | null {
  if (db === null || db === undefined || !Number.isFinite(db)) return null;
  if (db <= LECTURE_LEVEL_THRESHOLDS_DB.silentMax) return 'Silent';
  if (db <= LECTURE_LEVEL_THRESHOLDS_DB.quietMax) return 'Quiet';
  if (db < LECTURE_LEVEL_THRESHOLDS_DB.loudMin) return 'Good';
  return 'Loud';
}

/** 0..1 for the meter bar. No reading draws an empty bar, not a guessed one. */
export function lectureLevelBarFraction(db: number | null | undefined): number {
  if (db === null || db === undefined || !Number.isFinite(db)) return 0;
  const span = 0 - LECTURE_LEVEL_BAR_FLOOR_DB;
  const raw = (db - LECTURE_LEVEL_BAR_FLOOR_DB) / span;
  return Math.max(0, Math.min(1, raw));
}

/**
 * How many equal bars a row of `count` bars should light for this level.
 *
 * Bars, not a continuous fill, because a row of discrete bars reads as a
 * level meter at a glance and a smooth bar reads as progress.
 */
export function lectureLevelBarCount(db: number | null | undefined, count: number): number {
  if (count <= 0) return 0;
  return Math.round(lectureLevelBarFraction(db) * count);
}

/* ----------------------------------------------------------- quality --- */

export type LectureAudioGrade = 'great' | 'fair' | 'poor' | 'unknown';

export interface LectureAudioQuality {
  grade: LectureAudioGrade;
  /** The one or two words on the badge. */
  label: string;
  /** One plain clause saying WHY, or what to do about it. Never empty. */
  reason: string;
}

/**
 * A clipped sample is one at or beyond the converter's ceiling. Two
 * thresholds because clipping is not a cliff: a handful of samples in two
 * seconds is a door slam, a fiftieth of them is a microphone being shouted
 * into and a transcript full of holes.
 */
export const LECTURE_CLIPPING_POOR_RATIO = 0.02;
export const LECTURE_CLIPPING_FAIR_RATIO = 0.005;

/**
 * Audio quality from the last couple of seconds of sound.
 *
 * `rmsDb` is the root-mean-square level in dBFS over the window (`null`
 * before the first reading). `clippingRatio` is the share of samples at the
 * ceiling over the same window; platforms that cannot measure it pass 0,
 * which only ever makes this function kinder, never falsely reassuring about
 * a quiet room.
 */
export function classifyLectureAudioQuality(input: {
  rmsDb: number | null | undefined;
  clippingRatio?: number | null;
}): LectureAudioQuality {
  const { rmsDb } = input;
  const clipping =
    typeof input.clippingRatio === 'number' && Number.isFinite(input.clippingRatio)
      ? Math.max(0, input.clippingRatio)
      : 0;

  if (rmsDb === null || rmsDb === undefined || !Number.isFinite(rmsDb)) {
    return {
      grade: 'unknown',
      label: 'Checking',
      reason: 'waiting for the first reading from the microphone',
    };
  }

  // Clipping first: a loud-and-broken signal is worse than a quiet one, and
  // the fix ("move back") is the opposite of the quiet fix.
  if (clipping >= LECTURE_CLIPPING_POOR_RATIO) {
    return { grade: 'poor', label: 'Poor', reason: 'clipping — move back' };
  }
  if (rmsDb <= LECTURE_LEVEL_THRESHOLDS_DB.silentMax) {
    return { grade: 'poor', label: 'Poor', reason: 'too quiet — move closer' };
  }
  if (clipping >= LECTURE_CLIPPING_FAIR_RATIO) {
    return { grade: 'fair', label: 'Fair', reason: 'a little loud — move back' };
  }
  if (rmsDb <= LECTURE_LEVEL_THRESHOLDS_DB.quietMax) {
    return { grade: 'fair', label: 'Fair', reason: 'quiet — move closer' };
  }
  if (rmsDb >= LECTURE_LEVEL_THRESHOLDS_DB.loudMin) {
    return { grade: 'fair', label: 'Fair', reason: 'very loud — move back' };
  }
  return { grade: 'great', label: 'Great', reason: 'clear enough to transcribe' };
}

/* ---------------------------------------------------------- internet --- */

export type LectureInternetGrade = 'great' | 'fair' | 'offline' | 'unknown';

export interface LectureInternetQuality {
  grade: LectureInternetGrade;
  label: string;
  reason: string;
}

/** Round-trip milliseconds above which a connection is called slow. */
export const LECTURE_INTERNET_FAIR_RTT_MS = 300;
/** A timed HEAD to /health slower than this is a slow connection. */
export const LECTURE_INTERNET_FAIR_PROBE_MS = 800;

/**
 * Internet from whatever the platform will tell us.
 *
 * `online` is `navigator.onLine` / NetInfo. `effectiveType` and `rttMs` come
 * from `navigator.connection` where it exists (Chromium only). `probeMs` is
 * the fallback: one timed HEAD to `/health`. Nothing here claims a speed it
 * did not measure — a browser with none of the three reports `unknown`, and
 * the Start button is only ever disabled by `offline`, which is a fact.
 */
export function classifyLectureInternet(input: {
  online: boolean | null | undefined;
  effectiveType?: string | null;
  rttMs?: number | null;
  probeMs?: number | null;
}): LectureInternetQuality {
  if (input.online === false) {
    return {
      grade: 'offline',
      label: 'Offline',
      reason: 'recording works, but transcribing needs a connection',
    };
  }

  const type = typeof input.effectiveType === 'string' ? input.effectiveType : '';
  const rtt =
    typeof input.rttMs === 'number' && Number.isFinite(input.rttMs) && input.rttMs >= 0
      ? input.rttMs
      : null;
  const probe =
    typeof input.probeMs === 'number' && Number.isFinite(input.probeMs) && input.probeMs >= 0
      ? input.probeMs
      : null;

  if (!type && rtt === null && probe === null) {
    return {
      grade: input.online === true ? 'unknown' : 'unknown',
      label: 'Checking',
      reason: 'this browser does not report connection speed',
    };
  }

  if (type === 'slow-2g' || type === '2g') {
    return { grade: 'fair', label: 'Fair', reason: 'a very slow connection — uploading may take a while' };
  }
  if (type === '3g') {
    return { grade: 'fair', label: 'Fair', reason: 'a slow connection — uploading may take a while' };
  }
  if (rtt !== null && rtt > LECTURE_INTERNET_FAIR_RTT_MS) {
    return { grade: 'fair', label: 'Fair', reason: `a slow connection (${Math.round(rtt)} ms round trip)` };
  }
  if (probe !== null && probe > LECTURE_INTERNET_FAIR_PROBE_MS) {
    return { grade: 'fair', label: 'Fair', reason: `a slow connection (${Math.round(probe)} ms to reach us)` };
  }
  return { grade: 'great', label: 'Great', reason: 'fast enough to upload as soon as you stop' };
}

/* ---------------------------------------------------------- language --- */

/**
 * The languages the recorder offers, as ISO-639-1 codes.
 *
 * Short on purpose. Whisper supports ninety-odd languages, but a ninety-item
 * select is not a choice — these are the ones Lantern's students actually
 * lecture in, plus "Auto-detect", which is the default and sends no
 * `language` at all.
 */
export type LectureSpokenLanguageId =
  | 'auto'
  | 'en'
  | 'yo'
  | 'ha'
  | 'ig'
  | 'fr'
  | 'ar'
  | 'sw'
  | 'pt'
  | 'es';

export interface LectureSpokenLanguage {
  id: LectureSpokenLanguageId;
  label: string;
}

export const LECTURE_SPOKEN_LANGUAGES: readonly LectureSpokenLanguage[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'en', label: 'English' },
  { id: 'yo', label: 'Yoruba' },
  { id: 'ha', label: 'Hausa' },
  { id: 'ig', label: 'Igbo' },
  { id: 'fr', label: 'French' },
  { id: 'ar', label: 'Arabic' },
  { id: 'sw', label: 'Swahili' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'es', label: 'Spanish' },
] as const;

export const DEFAULT_LECTURE_SPOKEN_LANGUAGE: LectureSpokenLanguageId = 'auto';

export function isLectureSpokenLanguageId(value: unknown): value is LectureSpokenLanguageId {
  return (
    typeof value === 'string' &&
    LECTURE_SPOKEN_LANGUAGES.some((row) => row.id === value)
  );
}

/** Anything off the list — a typo, a newer build's id, an object — is `auto`. */
export function normalizeLectureSpokenLanguage(value: unknown): LectureSpokenLanguageId {
  return isLectureSpokenLanguageId(value) ? value : DEFAULT_LECTURE_SPOKEN_LANGUAGE;
}

export function lectureSpokenLanguageLabel(value: unknown): string {
  const id = normalizeLectureSpokenLanguage(value);
  return LECTURE_SPOKEN_LANGUAGES.find((row) => row.id === id)?.label ?? 'Auto-detect';
}

/**
 * The value that reaches Whisper's `language` field, or `undefined` for
 * auto-detect — Whisper detects the language itself when the field is absent,
 * and sending "auto" would be sending a language code that does not exist.
 */
export function whisperLanguageParam(value: unknown): string | undefined {
  const id = normalizeLectureSpokenLanguage(value);
  return id === 'auto' ? undefined : id;
}

/**
 * Where the transcript should end up.
 *
 * Two values, and only two, because Whisper's translate task translates into
 * ENGLISH and nothing else. A "Transcribe to: Yoruba" option would be a
 * promise the model cannot keep, so the picker does not offer one.
 */
export type LectureTranscribeTarget = 'same' | 'en';

export const DEFAULT_LECTURE_TRANSCRIBE_TARGET: LectureTranscribeTarget = 'same';

export const LECTURE_TRANSCRIBE_TARGETS: readonly {
  id: LectureTranscribeTarget;
  label: string;
}[] = [
  { id: 'same', label: 'Same as spoken' },
  { id: 'en', label: 'English' },
] as const;

export function normalizeLectureTranscribeTarget(value: unknown): LectureTranscribeTarget {
  return value === 'en' ? 'en' : DEFAULT_LECTURE_TRANSCRIBE_TARGET;
}

/**
 * True when the request must go to Whisper's *translations* endpoint rather
 * than *transcriptions*. Translating into English when the speaker is already
 * speaking English is a wasted round trip, so that pair is not a translation.
 */
export function needsWhisperTranslation(
  spoken: unknown,
  target: unknown
): boolean {
  const language = normalizeLectureSpokenLanguage(spoken);
  return normalizeLectureTranscribeTarget(target) === 'en' && language !== 'en';
}
