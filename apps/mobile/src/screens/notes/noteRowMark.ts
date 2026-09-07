/**
 * What a Library row's disc says a thing IS. Spec v3 §5.7 "Library".
 *
 * Every row in the Library used to draw the same grey glyph and lean on an
 * indigo text pill ("PDF", "Slides") to say what it was, which is a word where
 * a shape would do. The disc carries the type instead: teal for everything
 * that reads as notes — typed, imported, PDF, slides, photos, a video's
 * transcript — with a per-source GLYPH inside it, and fuchsia for a lecture
 * recording, because a recording belongs to the recording family and not to
 * the notes one.
 *
 * Two hues in the whole list, which is what keeps this screen inside the 4–6%
 * chromatic budget for a list. Decks are lime and tests are sky elsewhere;
 * neither appears in this list today, so neither is mapped here.
 *
 * Pure and importing only TYPES, so jest's node environment can test the map
 * and an icon name that does not exist is a compile error rather than a blank
 * square.
 */
import type { StudyNoteSourceType } from '@lantern/shared/types';
import type { FeatureKey } from '@lantern/shared/design';
import type { AppIconName } from '../../components/ui/appIconMap';

export interface NoteRowMark {
  feature: FeatureKey;
  icon: AppIconName;
  /** Spoken type, so a screen reader gets what the disc shows. */
  label: string;
}

const MARKS: Record<StudyNoteSourceType, NoteRowMark> = {
  typed: { feature: 'notes', icon: 'document-text', label: 'Note' },
  import: { feature: 'notes', icon: 'document-text', label: 'Note' },
  // A file glyph, not a page of text: what is behind this row is a document
  // someone handed you, and the row's job is to let you find it again.
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
