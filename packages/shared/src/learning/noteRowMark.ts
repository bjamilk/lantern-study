/**
 * What a Library note row's disc says a thing IS.
 *
 * The disc carries the type: teal for everything that reads as notes, with a
 * per-source glyph inside it, and the recording family for a lecture. Two hues
 * in the whole list, which is what keeps the screen inside the chromatic
 * budget. The indigo "PDF"/"Slides" word-pill this replaced was a label doing
 * an icon's job.
 */

import type { FeatureKey } from '../design';
import type { StudyNoteSourceType } from '../types';

export type NoteRowMarkIcon =
  | 'document-text'
  | 'document'
  | 'easel'
  | 'images'
  | 'logo-youtube'
  | 'mic';

export interface NoteRowMark {
  feature: FeatureKey;
  icon: NoteRowMarkIcon;
  /** Spoken type, so a screen reader gets what the disc shows. */
  label: string;
}

const MARKS: Record<StudyNoteSourceType, NoteRowMark> = {
  typed: { feature: 'notes', icon: 'document-text', label: 'Note' },
  import: { feature: 'notes', icon: 'document-text', label: 'Note' },
  pdf: { feature: 'notes', icon: 'document', label: 'PDF' },
  presentation: { feature: 'notes', icon: 'easel', label: 'Slides' },
  photos: { feature: 'notes', icon: 'images', label: 'Photos' },
  youtube: { feature: 'notes', icon: 'logo-youtube', label: 'YouTube' },
  audio: { feature: 'recording', icon: 'mic', label: 'Audio' },
};

const FALLBACK: NoteRowMark = MARKS.typed;

/** The disc for one Library row. An unknown source reads as a plain note. */
export function noteRowMark(sourceType: string | null | undefined): NoteRowMark {
  return MARKS[sourceType as StudyNoteSourceType] ?? FALLBACK;
}
