/**
 * The Record door writes nothing until the student says yes (D4).
 *
 * The device run of 2026-09-05 found that both Record doors created and opened
 * "Lecture — 6 Sep" on the tap itself, so an empty lecture note landed in the
 * library before anything was recorded — the "Untitled Lecture" junk this app
 * exists to not have. The editor is keyed on a real note id throughout, so an
 * id-less draft mode is a rewrite of that screen; the door asks first instead,
 * and these are the rules it asks by.
 */
import {
  newLectureNoteTitle,
  recorderDoorPrompt,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
} from './recorderDoor';

describe('recorderDoorPrompt', () => {
  it('names the note it is about to create, and nothing else', () => {
    const prompt = recorderDoorPrompt(new Date(2026, 8, 6));
    expect(prompt.noteTitle).toBe('Lecture — 6 Sep');
    // The student can see the exact title before it exists.
    expect(prompt.message).toContain('Lecture — 6 Sep');
    expect(prompt.confirmLabel).toBe('Start');
    expect(prompt.cancelLabel).toBe('Cancel');
  });

  it('quotes the same title the door would create', () => {
    const now = new Date(2026, 0, 31);
    expect(recorderDoorPrompt(now).noteTitle).toBe(newLectureNoteTitle(now));
  });
});

describe('shouldCreateLectureNote', () => {
  it('creates the note only on an explicit yes', () => {
    expect(shouldCreateLectureNote(true)).toBe(true);
  });

  it('writes nothing when the sheet is cancelled or dismissed', () => {
    // A cancel, a back press and a tap outside all resolve false; none of
    // them may leave a note behind.
    expect(shouldCreateLectureNote(false)).toBe(false);
  });
});

describe('shouldDeleteDoorNoteOnDiscard', () => {
  const DOOR_TITLE = 'Lecture — 6 Sep';

  it('a cancelled start leaves nothing behind', () => {
    // The whole door reduces to two rules working together: the sheet's "no"
    // never creates a note (shouldCreateLectureNote), and if a note WAS
    // created on "yes" and then thrown away untouched, it is deleted too.
    // Between them, no cancelled or discarded start can leave a note behind.
    expect(shouldCreateLectureNote(false)).toBe(false);
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: DOOR_TITLE,
        body: '',
        doorTitle: DOOR_TITLE,
      })
    ).toBe(true);
  });

  it('deletes the untouched shell a discarded door recording leaves behind', () => {
    // Start → (realise the mis-tap) → Discard: the empty "Lecture — 6 Sep"
    // must not survive in the library.
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: DOOR_TITLE,
        body: '   ', // whitespace is not content
        doorTitle: DOOR_TITLE,
      })
    ).toBe(true);
  });

  it('keeps a door note the student has typed into', () => {
    // Their words are the commit. Discarding the audio must not delete them.
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: DOOR_TITLE,
        body: 'mitochondria is the powerhouse',
        doorTitle: DOOR_TITLE,
      })
    ).toBe(false);
  });

  it('keeps a door note the student has renamed', () => {
    // A title of their own is intent to keep the note, recording or not.
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: 'Bio 101 — cells',
        body: '',
        doorTitle: DOOR_TITLE,
      })
    ).toBe(false);
  });

  it('never deletes a note the door did not open', () => {
    // Recording into an existing note and discarding leaves that note exactly
    // where it was — even if it happens to be empty.
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: false,
        title: DOOR_TITLE,
        body: '',
        doorTitle: DOOR_TITLE,
      })
    ).toBe(false);
  });
});
