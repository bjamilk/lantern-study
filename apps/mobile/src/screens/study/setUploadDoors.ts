/**
 * The Add-materials chips of a set room, and what each one actually opens.
 *
 * WHY IT IS A MODULE. Issue #137: four of the eight chips (PDF, PPT, Audio,
 * Video) opened `ImportAndStudyModal`, which had a picker for none of them —
 * a row of doors with nothing behind them, the one thing this app is not
 * allowed to have. The list and the routing now live here so a node test can
 * assert the invariant directly: EVERY chip resolves to a picker, the recorder,
 * a panel or the Anki sheet, and none of them resolves to "just open a sheet".
 *
 * WHAT WAS REMOVED AND WHY. Audio and Video are gone rather than wired: there
 * is no file-transcription path on any platform — not on web, not on the API —
 * so a picker would have handed the student a file nothing can read. The honest
 * door for a lecture is the recorder, which exists, transcribes, and is now on
 * this screen as **Record**.
 *
 * Touches: `utils/fileImportDoors` (the picker kinds) and the `LectureStudio`
 * route. No React, no native module — that is the point.
 */
import type { ImportFileKind } from '../../utils/fileImportDoors';

export type SetUploadChipAction =
  /** Opens the import sheet with this file picker already firing. */
  | { kind: 'picker'; file: ImportFileKind }
  /** Opens the lecture recorder on this set. */
  | { kind: 'recorder' }
  /** Opens an inline panel on the screen itself. */
  | { kind: 'panel'; panel: 'youtube' | 'paste' }
  /** Opens the Anki/Quizlet paste sheet. */
  | { kind: 'anki' };

export interface SetUploadChip {
  id: string;
  icon: string;
  hint: string;
  action: SetUploadChipAction;
}

export const SET_UPLOAD_CHIPS: readonly SetUploadChip[] = [
  {
    id: 'PDF',
    icon: 'document-text',
    hint: 'Pick a PDF',
    action: { kind: 'picker', file: 'pdf' },
  },
  {
    id: 'PPT',
    icon: 'easel',
    hint: 'Pick slides',
    action: { kind: 'picker', file: 'presentation' },
  },
  // Word sits with the other document types, not at the end: it is the class
  // file students hand in and hand round, and it was the one common one
  // Lantern could not read.
  {
    id: 'Word',
    icon: 'document',
    hint: 'Pick a Word document (.docx)',
    action: { kind: 'picker', file: 'document' },
  },
  // Plain text and Markdown. It sits with the document chips because that is
  // what it is; the file is read on the device rather than uploaded, so it is
  // also the one document door that costs nothing.
  {
    id: 'Text',
    icon: 'document-text',
    hint: 'Pick a .txt or .md file',
    action: { kind: 'picker', file: 'text' },
  },
  // The replacement for the Audio and Video chips. Recording a class is the
  // one audio path that exists end to end, and it files into this set.
  {
    id: 'Record',
    icon: 'mic',
    hint: 'Record this lecture',
    action: { kind: 'recorder' },
  },
  {
    id: 'YouTube',
    icon: 'logo-youtube',
    hint: 'Paste a video link',
    action: { kind: 'panel', panel: 'youtube' },
  },
  {
    id: 'Paste',
    icon: 'clipboard',
    hint: 'Paste text',
    action: { kind: 'panel', panel: 'paste' },
  },
  {
    id: 'Anki',
    icon: 'layers',
    hint: 'Paste an Anki or Quizlet export',
    action: { kind: 'anki' },
  },
] as const;
