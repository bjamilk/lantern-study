/**
 * What the recording bar and the note's Record card are allowed to say.
 *
 * Both sentences here replace a string that was assembled at the render site
 * out of whatever happened to be in the store, and both were wrong on device:
 *
 *  - The failure line pasted the raw upload error in front of a fixed
 *    sentence with no separator, so a student read "Network request failed The
 *    audio is still here — tap Retry." A transport error is not a sentence and
 *    is not the student's language.
 *  - The Record card said "Another note is recording" whenever the lecture
 *    store was not `idle` — which includes `naming`, `uploading` and `failed`,
 *    and includes THIS note. After a second stop the card claimed a recording
 *    was running while nothing was.
 *
 * Pure on purpose: these are the claims, and they are tested without a
 * recorder, a store or a screen.
 */

/** The one promise a failed lecture must always end on. */
export const AUDIO_HELD_COPY = 'The audio is still here — tap Retry.';

/**
 * The upload failures a student can tell apart, and nothing else.
 *
 * `unknown` is a real answer: an error we cannot classify gets NO invented
 * reason, because a wrong reason ("No connection." while online) sends the
 * student to fix something that is not broken. The promise still lands.
 */
export type LectureFailureReason = 'offline' | 'interrupted' | 'unknown';

/**
 * Classify an upload/transcription failure by the words the platform uses.
 *
 * Matching is on substrings of the message because these strings come from
 * three different layers (RN's fetch, the abort controller, our own toast
 * copy) and none of them carries a code.
 */
export function classifyLectureFailure(
  error: string | null | undefined
): LectureFailureReason {
  const text = (error ?? '').toLowerCase();
  if (!text.trim()) return 'unknown';
  if (
    text.includes('network request failed') ||
    text.includes('network error') ||
    text.includes('offline') ||
    text.includes('no internet') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('failed to fetch')
  ) {
    return 'offline';
  }
  if (
    text.includes('abort') ||
    text.includes('cancel') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('interrupt')
  ) {
    return 'interrupted';
  }
  return 'unknown';
}

/** Each reason as the one short sentence that precedes the promise. */
export const LECTURE_FAILURE_REASON_COPY: Record<LectureFailureReason, string> = {
  offline: 'No connection.',
  interrupted: 'The upload was interrupted.',
  unknown: '',
};

/**
 * The whole failure line: a plain reason (or none) then the promise.
 *
 * Never interpolates the raw error. The raw text is still in the store for a
 * log or a bug report; it is not shown to the student.
 */
export function lectureFailureLine(error: string | null | undefined): string {
  const reason = LECTURE_FAILURE_REASON_COPY[classifyLectureFailure(error)];
  return reason ? `${reason} ${AUDIO_HELD_COPY}` : AUDIO_HELD_COPY;
}

// ─────────────────────────────────────────────────────────────
// Which note, if any, is actually recording
// ─────────────────────────────────────────────────────────────

/** The lecture store's status, mirrored so this file imports nothing. */
export type LectureCopyStatus =
  | 'idle'
  | 'recording'
  | 'naming'
  | 'uploading'
  | 'transcribing'
  | 'failed';

export interface LectureOwnershipInput {
  status: LectureCopyStatus;
  /** The note the lecture session belongs to, or `null` when idle. */
  activeNoteId: string | null;
  /** The note whose Record card is asking. */
  noteId: string;
  /** Set while the recorder is paused. A paused lecture is still recording. */
  paused?: boolean;
}

/**
 * True only while a DIFFERENT note is capturing audio.
 *
 * `naming`, `uploading`, `transcribing` and `failed` are all states in which
 * nothing is being recorded, so none of them may claim otherwise — which is
 * the whole defect. Pausing does not stop a recording, so a paused session
 * still owns the microphone and still answers true.
 */
export function isOtherNoteRecording(input: LectureOwnershipInput): boolean {
  if (input.status !== 'recording') return false;
  if (!input.activeNoteId) return false;
  return input.activeNoteId !== input.noteId;
}

/**
 * True while a DIFFERENT note holds a lecture that has not been dealt with —
 * a stopped file waiting for a title, an upload in flight, a failed one still
 * on disk. Starting a second recording is refused in those states by the
 * store, so the card must say so, but it must not call it "recording".
 */
export function isOtherNoteHoldingLecture(input: LectureOwnershipInput): boolean {
  if (input.status === 'idle' || input.status === 'recording') return false;
  if (!input.activeNoteId) return false;
  return input.activeNoteId !== input.noteId;
}

/**
 * Why the Record card is disabled, in one phrase — or `null` when it is not.
 *
 * The order matters: this note's own session is described from this note's
 * point of view ("controls are above") before anything is said about others.
 */
export function recordCardBlockedReason(
  input: LectureOwnershipInput
): string | null {
  const mine = input.activeNoteId === input.noteId && input.status !== 'idle';
  if (mine) {
    return input.status === 'recording'
      ? 'Recording — controls are above'
      : input.status === 'naming'
        ? 'Name the recording you just stopped'
        : input.status === 'failed'
          ? 'Retry or discard your last recording'
          : 'Finishing the last recording';
  }
  if (isOtherNoteRecording(input)) return 'Another note is recording';
  if (isOtherNoteHoldingLecture(input)) return 'Another note is finishing a recording';
  return null;
}
