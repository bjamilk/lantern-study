import React from 'react';
import { isLectureNote, notePreviewText } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { ResolvedStorageImg } from '../ui/ResolvedStorageImg';
import {
  FEATURE_INK_TEXT,
  FEATURE_PANEL_INK_TEXT,
  FEATURE_TINT_BG,
} from '../ui/featureClasses';

export interface StudySetMaterialTileNote {
  id: string;
  title?: string | null;
  body?: string | null;
  sourceType?: string | null;
  /** Storage ref ("bucket/path") for the note's cover, re-signed on display. */
  coverPath?: string | null;
}

interface StudySetMaterialTileProps {
  note: StudySetMaterialTileNote;
  onClick: () => void;
  selected?: boolean;
  /**
   * The tile's ⋮, when the viewer owns the material. It is rendered as a
   * SIBLING of the tile button, never inside it: a <button> in a <button> is
   * invalid markup the keyboard cannot reach, and every click of the menu
   * would also open the note. Same arrangement `StudySetArtifactLibrary` uses
   * for a deck tile.
   */
  menu?: React.ReactNode;
}

export const StudySetMaterialTile: React.FC<StudySetMaterialTileProps> = ({
  note,
  onClick,
  selected,
  menu,
}) => {
  const lecture = isLectureNote(note);
  const preview = notePreviewText(note.body);
  const tile = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      // `w-full` matters once the tile is wrapped for its menu: as a bare grid
      // child the button stretched to the column, but inside the relative
      // wrapper it is an inline-block that would otherwise shrink to its text.
      // 233×226 as measured (2026-09-17): the preview block is the card's
      // largest element and the label is a footer under it, which is what
      // makes a wall of these scannable by their content rather than by
      // their titles. `min-h` so a long title wraps rather than clips.
      className={`min-h-[226px] w-full rounded-xl border bg-lantern-surface text-left overflow-hidden hover:bg-lantern-background-secondary ${
        selected ? 'border-lantern-text' : 'border-lantern-border'
      }`}
    >
      <div
        className={`h-[164px] ${note.coverPath ? '' : 'px-3 py-3'} ${
          lecture ? FEATURE_TINT_BG.recording : 'bg-lantern-background-secondary'
        }`}
      >
        {/* A cover fills the whole header block, edge to edge — it replaces the
            preview text (or the lecture disc), not the tile around it. The
            footer glyph below still says which kind of material this is. */}
        {note.coverPath ? (
          <ResolvedStorageImg
            src={note.coverPath}
            variant="thumb"
            alt=""
            className="h-full w-full object-cover"
          />
        ) : lecture ? (
          <span
            aria-hidden="true"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-lantern-surface ${FEATURE_PANEL_INK_TEXT.recording}`}
          >
            <AppIcon name="mic" size={20} />
          </span>
        ) : (
          <p className="text-caption text-lantern-text-secondary line-clamp-6">
            {preview || 'Untitled note'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Tinted to the material's own hue, not left in body ink: this glyph
            is the only thing distinguishing a lecture tile from a note tile
            once the preview text is scrolled past, and an untinted mark made
            the two rows identical at a glance. */}
        <AppIcon
          name={lecture ? 'mic' : 'document-text'}
          size={16}
          className={lecture ? FEATURE_INK_TEXT.recording : FEATURE_INK_TEXT.notes}
        />
        {/* The reference sets this title 13/20 in its tertiary ink. 13 is not
            a step on Lantern's ladder and the tertiary is #A3A3A3 (2.6:1), so
            the honest equivalent is the 14/20 body step in the body ink — same
            role, same leading, legible. */}
        <span className="text-body font-medium truncate">{note.title || 'Untitled note'}</span>
      </div>
    </button>
  );
  if (!menu) return tile;
  return (
    <div className="relative">
      {tile}
      <div className="absolute right-2 top-2">{menu}</div>
    </div>
  );
};

export default StudySetMaterialTile;
