/**
 * The Record door's one piece of logic.
 *
 * Recording has no screen of its own — a lecture is recorded INTO a note — so
 * both the Study hub tile and the Home tile create a note and open the editor.
 * The title has to be recognisable in a notes list a week later, which means a
 * date, and it has to be stable enough to assert on, which means this function
 * rather than an inline template literal in two screens.
 */

import { LECTURE_TRANSCRIPTION_PRICE_RULE } from '@lantern/shared/utils/aiCredits';
import { lectureCapacityLine } from '@lantern/shared/utils/lectureAudio';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** e.g. "Lecture — 6 Sep". `now` is injectable so the test is not date-bound. */
export function newLectureNoteTitle(now: Date = new Date()): string {
  return `Lecture — ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

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

export function recorderDoorPrompt(now: Date = new Date()): RecorderDoorPrompt {
  const noteTitle = newLectureNoteTitle(now);
  // Recording is free; transcribing is the charge, and its size depends on
  // how long the lecture runs. Both sentences are derived, never typed.
  const priceLine = `Recording is free. ${LECTURE_TRANSCRIPTION_PRICE_RULE} ${lectureCapacityLine()}`;
  return {
    title: 'Start a lecture note?',
    // The name is quoted so the student knows what will be in their library.
    message: `We'll create "${noteTitle}" and start recording straight away.\n\n${priceLine}`,
    confirmLabel: 'Start',
    cancelLabel: 'Cancel',
    noteTitle,
    priceLine,
  };
}

/** Whether the door may create the note. `false` writes nothing at all. */
export function shouldCreateLectureNote(confirmed: boolean): boolean {
  return confirmed === true;
}

/**
 * The other half of "nothing exists until the student commits".
 *
 * `shouldCreateLectureNote` moved creation from the tap to the "Start" of the
 * confirm sheet, so a *cancelled* start leaves nothing behind. But "Start"
 * still writes the note before a single second is recorded, and the recorder
 * opens straight onto it — so a student who taps Start and then Discards (the
 * mis-tap-twice case the device pass hit) was left with exactly the empty
 * "Lecture — 6 Sep" the door was meant to stop creating. The note simply moved
 * one tap deeper.
 *
 * This is the rule that closes that hole: when a door recording is discarded,
 * the note the door created is deleted too — but ONLY while it is still the
 * untouched shell the door wrote. The moment the student makes it theirs — a
 * word typed in the body, or a title of their own — the note is a note, and
 * throwing away the audio must never throw away their note with it. A note the
 * door did not open is never in scope at all, so recording into an existing
 * note and discarding leaves that note exactly where it was.
 */
export interface DoorNoteCleanupInput {
  /** True only when THIS editor session was opened by the Record door. */
  openedByDoor: boolean;
  /** The note's title as it stands now. */
  title: string | null | undefined;
  /** The note's body as it stands now. */
  body: string | null | undefined;
  /**
   * The exact title the door wrote when it created the note, so a title the
   * student has since changed reads as intent to keep.
   */
  doorTitle: string;
}

export function shouldDeleteDoorNoteOnDiscard(input: DoorNoteCleanupInput): boolean {
  // A note the door never opened is the student's from the start.
  if (!input.openedByDoor) return false;
  // Anything typed into the body is content the discard must not destroy.
  if ((input.body ?? '').trim().length > 0) return false;
  // A renamed note is one the student decided to keep; only the door's own
  // untouched placeholder is a throwaway shell.
  if ((input.title ?? '').trim() !== input.doorTitle.trim()) return false;
  return true;
}
