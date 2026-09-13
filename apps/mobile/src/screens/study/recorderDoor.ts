/**
 * The Record door's one piece of logic.
 *
 * Recording has no screen of its own — a lecture is recorded INTO a note — so
 * both the Study hub tile and the Home tile create a note and open the editor.
 * The title has to be recognisable in a notes list a week later, which means a
 * date, and it has to be stable enough to assert on, which means this function
 * rather than an inline template literal in two screens.
 */

import {
  newLectureNoteTitle,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  type DoorNoteCleanupInput,
} from '@lantern/shared/learning';
import { LECTURE_TRANSCRIPTION_PRICE_RULE } from '@lantern/shared/utils/aiCredits';
import { lectureCapacityLine } from '@lantern/shared/utils/lectureAudio';

export { newLectureNoteTitle, shouldCreateLectureNote, shouldDeleteDoorNoteOnDiscard };
export type { DoorNoteCleanupInput };

/**
 * What the Record door does BEFORE it writes anything.
 *
 * The door used to create a note and open the editor in one silent motion, so
 * a mis-tap — and every curious first tap — left an empty "Lecture — 6 Sep" in
 * the library forever. That is exactly the "Untitled Lecture" junk this app
 * exists to not have.
 *
 * The editor is keyed on a real `noteId` everywhere it touches (loadNote,
 * scheduleSave, the lecture recording store, OCR polling, quiz generation), so
 * a true id-less draft mode is a refactor of the whole screen rather than a
 * route param. The door therefore ASKS first, which is the documented
 * fallback: nothing is written until the student says yes, and when they do,
 * the editor opens with the recorder already running — so the note that lands
 * has a recording in it.
 */
export interface RecorderDoorPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** The note title to create, identical to the one quoted in the message. */
  noteTitle: string;
  /**
   * The price rule, in one line, before anything is recorded.
   *
   * Transcription is charged by length, so "1 AI use" would be a lie for
   * anything over a quarter of an hour. The door is the last place the
   * student can decide not to spend, so it is where the rule belongs — and it
   * comes from `aiCredits.ts` rather than being written out here.
   */
  priceLine: string;
}

export function recorderDoorPrompt(
  now: Date = new Date(),
  options?: { resumeTitle?: string | null }
): RecorderDoorPrompt {
  const resumeTitle = options?.resumeTitle?.trim() || '';
  const noteTitle = resumeTitle || newLectureNoteTitle(now);
  // Recording is free; transcribing is the charge, and its size depends on
  // how long the lecture runs. Both sentences are derived, never typed.
  const priceLine = `Recording is free. ${LECTURE_TRANSCRIPTION_PRICE_RULE} ${lectureCapacityLine()}`;
  return {
    title: resumeTitle ? 'Continue this lecture?' : 'Start a lecture note?',
    // The name is quoted so the student knows what will be in their library.
    message: resumeTitle
      ? `We'll open "${noteTitle}" and start recording.\n\n${priceLine}`
      : `We'll create "${noteTitle}" and start recording straight away.\n\n${priceLine}`,
    confirmLabel: 'Start',
    cancelLabel: 'Cancel',
    noteTitle,
    priceLine,
  };
}

