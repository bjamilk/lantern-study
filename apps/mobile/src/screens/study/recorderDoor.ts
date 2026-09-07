/**
 * The Record door's one piece of logic.
 *
 * Recording has no screen of its own — a lecture is recorded INTO a note — so
 * both the Study hub tile and the Home tile create a note and open the editor.
 * The title has to be recognisable in a notes list a week later, which means a
 * date, and it has to be stable enough to assert on, which means this function
 * rather than an inline template literal in two screens.
 */

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
}

export function recorderDoorPrompt(now: Date = new Date()): RecorderDoorPrompt {
  const noteTitle = newLectureNoteTitle(now);
  return {
    title: 'Start a lecture note?',
    // The name is quoted so the student knows what will be in their library.
    message: `We'll create "${noteTitle}" and start recording straight away.`,
    confirmLabel: 'Start',
    cancelLabel: 'Cancel',
    noteTitle,
  };
}

/** Whether the door may create the note. `false` writes nothing at all. */
export function shouldCreateLectureNote(confirmed: boolean): boolean {
  return confirmed === true;
}
