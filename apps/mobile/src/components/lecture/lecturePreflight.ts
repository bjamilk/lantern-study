/**
 * The pre-flight card's arithmetic and its words, with no React in sight.
 *
 * The whole point of this card is that it never says anything it has not
 * measured. StudyFetch shows "Audio Quality: Great" on a phone whose
 * microphone permission is denied — a sentence with no reading behind it. So
 * every state word here is a function of a real input, and the "we have not
 * measured yet" case has its own word rather than an optimistic default.
 */

import {
  LECTURE_TRANSCRIPTION_PRICE_RULE,
  formatLectureTranscriptionEstimate,
} from '@lantern/shared/utils/aiCredits';
import {
  LECTURE_LEVEL_BAR_FLOOR_DB,
  LECTURE_LEVEL_THRESHOLDS_DB,
  lectureAudioFillFraction,
  lectureCapacityLine,
  lectureLevelBarFraction,
  lectureLevelWord,
  maxLectureRecordingMinutes,
} from '@lantern/shared/utils/lectureAudio';
import { newLectureNoteTitle } from '../../screens/study/recorderDoor';

/** What `expo-av`'s `Audio.getPermissionsAsync()` can tell us, plus "not read yet". */
export type MicPermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

/** How a row should read: green-ish, amber-ish, red-ish, or "no reading yet". */
export type PreflightTone = 'ok' | 'warn' | 'blocked' | 'unknown';

export interface PreflightAction {
  label: string;
  /** The only next step this card ever offers. */
  kind: 'open-settings';
}

export interface PreflightRow {
  /** Row name, fixed: Microphone / Level / Connection. */
  label: string;
  /** The measured state, in one or two plain words. */
  state: string;
  /** One plain sentence saying what that means for this recording. */
  detail: string;
  tone: PreflightTone;
  /** Present only when there is something the student can actually do. */
  action?: PreflightAction;
}

/* ------------------------------------------------------------------ mic -- */

export function micPermissionRow(state: MicPermissionState): PreflightRow {
  switch (state) {
    case 'granted':
      return {
        label: 'Microphone',
        state: 'Allowed',
        detail: 'This app can hear the room.',
        tone: 'ok',
      };
    case 'denied':
      return {
        label: 'Microphone',
        state: 'Blocked',
        detail:
          'Nothing will be recorded until you allow the microphone in your phone settings.',
        tone: 'blocked',
        action: { label: 'Open settings', kind: 'open-settings' },
      };
    case 'undetermined':
      return {
        label: 'Microphone',
        state: 'Not asked yet',
        detail: 'Your phone will ask for the microphone when recording starts.',
        tone: 'unknown',
      };
    default:
      return {
        label: 'Microphone',
        state: 'Checking',
        detail: 'Reading the microphone permission.',
        tone: 'unknown',
      };
  }
}

/* ---------------------------------------------------------------- level -- */

export type LevelWord = 'Silent' | 'Quiet' | 'Good' | 'Loud';

/**
 * The thresholds, the word and the bar now live in
 * `@lantern/shared/utils/lectureAudio` so the browser's pre-check panel and
 * this card grade the same room the same way. They are re-exported under
 * their original names because this module's callers (and its tests) predate
 * the move; the numbers are unchanged.
 */
export const LEVEL_THRESHOLDS_DB = LECTURE_LEVEL_THRESHOLDS_DB;
export const LEVEL_BAR_FLOOR_DB = LECTURE_LEVEL_BAR_FLOOR_DB;
export const levelStateWord = lectureLevelWord;
export const levelBarFraction = lectureLevelBarFraction;

export function levelRow(db: number | null | undefined): PreflightRow {
  const word = levelStateWord(db);
  if (word === null) {
    return {
      label: 'Level',
      state: 'No signal yet',
      detail: 'Waiting for the first reading from the microphone.',
      tone: 'unknown',
    };
  }
  if (word === 'Silent') {
    return {
      label: 'Level',
      state: 'Silent',
      detail: 'We are picking up almost nothing. Check the microphone is not covered.',
      tone: 'warn',
    };
  }
  if (word === 'Quiet') {
    return {
      label: 'Level',
      state: 'Quiet',
      detail: 'We can hear the room, faintly. Move the phone closer to the speaker.',
      tone: 'warn',
    };
  }
  if (word === 'Loud') {
    return {
      label: 'Level',
      state: 'Loud',
      detail: 'Loud enough to distort. Move the phone back a little.',
      tone: 'warn',
    };
  }
  return {
    label: 'Level',
    state: 'Good',
    detail: 'Clear enough to transcribe.',
    tone: 'ok',
  };
}

/* ----------------------------------------------------------- connection -- */

/**
 * Does a recording stopped offline get transcribed later?
 *
 * NO — and this constant exists so the card cannot drift away from the code.
 * `lectureRecordingStore.stopAndTranscribe` calls `transcribeAudioForNote`
 * straight away, and nothing schedules it for later. A FAILED attempt now keeps
 * the file and offers "Retry transcription" (see `lectureRecordingStore`), but
 * a retry is a tap, not a queue: nothing uploads on its own when the phone
 * comes back online. Until a lecture upload goes through the sync service, the
 * honest sentence is the one in `connectionRow` below, not "we transcribe
 * later".
 *
 * Flip this to `true` in the same commit that adds the queue, and the card's
 * words change with it.
 */
export const LECTURE_OFFLINE_QUEUEING = false;

export function connectionRow(
  isOnline: boolean,
  offlineQueueing: boolean = LECTURE_OFFLINE_QUEUEING
): PreflightRow {
  if (isOnline) {
    return {
      label: 'Connection',
      state: 'Online',
      detail: 'We upload and transcribe as soon as you stop.',
      tone: 'ok',
    };
  }
  if (offlineQueueing) {
    return {
      label: 'Connection',
      state: 'Offline',
      detail: 'We record now and transcribe when you are back online.',
      tone: 'warn',
    };
  }
  return {
    label: 'Connection',
    state: 'Offline',
    // Not a queue, and it does not claim to be one: transcription still has
    // to be asked for. What changed is that a failed attempt no longer throws
    // the recording away, so "Retry transcription" is a real offer.
    detail:
      'Recording works. Transcribing needs a connection — we keep the audio, so you can tap Retry once you are back online.',
    tone: 'warn',
  };
}


/* ------------------------------------------------------ cost and length -- */

/**
 * The running price.
 *
 * Transcription is charged by length, so the number moves while the student
 * records — and the one moment it must be on screen is BEFORE they stop, when
 * stopping is still free. Both the figure and the rule come from
 * `aiCredits.ts`; nothing here knows what 15 minutes costs.
 */
export function estimatedCostRow(elapsedMs: number): PreflightRow {
  return {
    label: 'Cost',
    state: formatLectureTranscriptionEstimate(elapsedMs),
    detail: LECTURE_TRANSCRIPTION_PRICE_RULE,
    tone: 'unknown',
  };
}

/** Above this share of the byte budget the length row starts warning. */
export const LECTURE_LENGTH_WARN_FRACTION = 0.8;

/**
 * How much lecture still fits.
 *
 * The minutes figure is derived from the recording preset and the server's
 * byte cap, never typed — see `@lantern/shared/utils/lectureAudio`. Before
 * this row existed, a 45-minute lecture recorded at HIGH_QUALITY was refused
 * by the server AFTER it was over, which is the worst possible moment to find
 * out.
 */
export function lengthRow(elapsedMs: number): PreflightRow {
  const fill = lectureAudioFillFraction(elapsedMs);
  const capacity = lectureCapacityLine();
  if (fill >= 1) {
    return {
      label: 'Length',
      state: 'Full',
      detail: `This recording has reached the size a lecture can be. Stop now — anything longer cannot be uploaded. ${capacity}`,
      tone: 'blocked',
    };
  }
  if (fill >= LECTURE_LENGTH_WARN_FRACTION) {
    const minutesLeft = Math.max(
      0,
      Math.floor(maxLectureRecordingMinutes() - elapsedMs / 60_000)
    );
    return {
      label: 'Length',
      state: `About ${minutesLeft} min left`,
      detail: `Getting close to the size a lecture can be. ${capacity}`,
      tone: 'warn',
    };
  }
  return {
    label: 'Length',
    state: 'Room to spare',
    detail: capacity,
    tone: 'ok',
  };
}

/* ---------------------------------------------------------------- screen -- */

/**
 * What happens when the phone locks.
 *
 * Two mechanisms, and the row says which one is actually holding. The screen
 * is kept awake while recording (`expo-keep-awake`), and on an Android build
 * that carries the foreground service the recording ALSO survives the student
 * pressing the power button. On anything else — Expo Go, iOS, an older build
 * — it does not, and the row must not pretend otherwise.
 */
export function screenRow(screenOffSurvives: boolean): PreflightRow {
  if (screenOffSurvives) {
    return {
      label: 'Screen',
      state: 'Stays on',
      detail:
        'We keep the screen awake while recording, and recording carries on if you switch it off or leave the app.',
      tone: 'ok',
    };
  }
  return {
    label: 'Screen',
    state: 'Stays on',
    detail:
      'We keep the screen awake while recording. Locking the phone yourself can stop the recording on this build, so leave it unlocked.',
    tone: 'warn',
  };
}

/* -------------------------------------------------------------- consent -- */

/** One line, on the card, in plain words. Not a legal notice. */
export { LECTURE_CONSENT_LINE } from '@lantern/shared/learning';

/* ----------------------------------------------------------------- card -- */

export interface PreflightInput {
  micPermission: MicPermissionState;
  /** Latest metering reading in dBFS, or `null` before the first one arrives. */
  meterDb: number | null;
  isOnline: boolean;
  offlineQueueing?: boolean;
  /** Milliseconds recorded so far. 0 before the recorder starts. */
  elapsedMs?: number;
  /** True only where the Android foreground service is actually running. */
  screenOffSurvives?: boolean;
}

export function preflightRows(input: PreflightInput): PreflightRow[] {
  return [
    micPermissionRow(input.micPermission),
    levelRow(input.meterDb),
    // Price before length before connection: the price is the thing a student
    // can still act on for free, and stopping is how they act on it.
    estimatedCostRow(input.elapsedMs ?? 0),
    lengthRow(input.elapsedMs ?? 0),
    screenRow(input.screenOffSurvives ?? false),
    connectionRow(input.isOnline, input.offlineQueueing ?? LECTURE_OFFLINE_QUEUEING),
  ];
}

/* --------------------------------------------------- title at stop -------- */

/** Longest title we will write. Long enough for a real lecture name. */
export const MAX_LECTURE_TITLE_LENGTH = 120;

const PLACEHOLDER_TITLES = ['', 'untitled note', 'untitled', 'new note'];

function isPlaceholder(title: string | null | undefined): boolean {
  return PLACEHOLDER_TITLES.includes((title || '').trim().toLowerCase());
}

/**
 * What the sheet is prefilled with.
 *
 * A note the student already named keeps its name — retyping it is the one
 * thing a naming sheet must not make you do. A note that still carries the
 * door's placeholder gets the date title, which is the thing one tap keeps.
 */
export function suggestedLectureTitle(
  currentTitle: string | null | undefined,
  now: Date = new Date()
): string {
  if (isPlaceholder(currentTitle)) return newLectureNoteTitle(now);
  return (currentTitle || '').trim().slice(0, MAX_LECTURE_TITLE_LENGTH);
}

export interface StopTitlePlan {
  /** What goes in the input when the sheet opens. */
  suggestion: string;
  /** The title to save. Never empty. */
  nextTitle: string;
  /** Whether saving actually changes the note's title. */
  shouldRename: boolean;
}

/**
 * The sheet's whole decision, as data: one tap (empty edit) keeps the
 * suggestion, whitespace is not a title, and an unchanged title writes nothing.
 */
export function planTitleAtStop(args: {
  currentTitle: string | null | undefined;
  typedTitle?: string | null;
  now?: Date;
}): StopTitlePlan {
  const suggestion = suggestedLectureTitle(args.currentTitle, args.now ?? new Date());
  const typed = (args.typedTitle ?? '').trim().slice(0, MAX_LECTURE_TITLE_LENGTH);
  const nextTitle = typed.length > 0 ? typed : suggestion;
  const current = (args.currentTitle || '').trim();
  return {
    suggestion,
    nextTitle,
    shouldRename: nextTitle.length > 0 && nextTitle !== current,
  };
}
