/**
 * The invariant issue #137 broke: no chip in a set room's Add materials row may
 * open a sheet with nothing behind it.
 *
 * Read the first test first. It is the one that would have failed before this
 * lane: PDF, PPT, Audio and Video all resolved to "open ImportAndStudyModal",
 * which had a picker for none of them.
 */
import { SET_UPLOAD_CHIPS } from './setUploadDoors';
import { importFilePickerOptions, PDF_MIME, PRESENTATION_MIMES } from '../../utils/fileImportDoors';
import { DOCX_MIME } from '@lantern/shared/utils/noteUpload';

const chip = (id: string) => {
  const found = SET_UPLOAD_CHIPS.find((c) => c.id === id);
  if (!found) throw new Error(`No chip "${id}"`);
  return found;
};

describe('SET_UPLOAD_CHIPS', () => {
  it('every chip resolves to a picker, the recorder, a panel or the Anki sheet', () => {
    for (const c of SET_UPLOAD_CHIPS) {
      expect(['picker', 'recorder', 'panel', 'anki']).toContain(c.action.kind);
    }
  });

  it('no chip offers audio or video file import — no platform can read one', () => {
    const ids = SET_UPLOAD_CHIPS.map((c) => c.id);
    expect(ids).not.toContain('Audio');
    expect(ids).not.toContain('Video');
  });

  it('offers the recorder instead, which is the door that does transcribe', () => {
    expect(chip('Record').action).toEqual({ kind: 'recorder' });
  });

  it('opens the PDF picker with the PDF mime', () => {
    const action = chip('PDF').action;
    expect(action).toEqual({ kind: 'picker', file: 'pdf' });
    if (action.kind !== 'picker') throw new Error('unreachable');
    expect(importFilePickerOptions(action.file).type).toEqual([PDF_MIME]);
  });

  it('opens the slides picker with both PowerPoint mimes', () => {
    const action = chip('PPT').action;
    expect(action).toEqual({ kind: 'picker', file: 'presentation' });
    if (action.kind !== 'picker') throw new Error('unreachable');
    expect(importFilePickerOptions(action.file).type).toEqual(PRESENTATION_MIMES);
  });

  it('opens the Word picker with the docx mime', () => {
    const action = chip('Word').action;
    expect(action).toEqual({ kind: 'picker', file: 'document' });
    if (action.kind !== 'picker') throw new Error('unreachable');
    expect(importFilePickerOptions(action.file).type).toEqual([DOCX_MIME]);
  });

  it('keeps the three doors that were already real', () => {
    expect(chip('YouTube').action).toEqual({ kind: 'panel', panel: 'youtube' });
    expect(chip('Paste').action).toEqual({ kind: 'panel', panel: 'paste' });
    expect(chip('Anki').action).toEqual({ kind: 'anki' });
  });

  it('gives every chip a hint that says what pressing it does', () => {
    for (const c of SET_UPLOAD_CHIPS) {
      expect(c.hint.trim().length).toBeGreaterThan(0);
      expect(c.icon.trim().length).toBeGreaterThan(0);
    }
  });
});
