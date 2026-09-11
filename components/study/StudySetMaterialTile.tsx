import React from 'react';
import { isLectureNote, notePreviewText } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';

export interface StudySetMaterialTileNote {
  id: string;
  title?: string | null;
  body?: string | null;
  sourceType?: string | null;
}

interface StudySetMaterialTileProps {
  note: StudySetMaterialTileNote;
  onClick: () => void;
  selected?: boolean;
}

export const StudySetMaterialTile: React.FC<StudySetMaterialTileProps> = ({
  note,
  onClick,
  selected,
}) => {
  const lecture = isLectureNote(note);
  const preview = notePreviewText(note.body);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-[11rem] rounded-2xl border bg-lantern-surface text-left overflow-hidden hover:bg-lantern-background-secondary ${
        selected ? 'border-lantern-text' : 'border-lantern-border'
      }`}
    >
      <div
        className={`h-28 px-3 py-3 ${
          lecture ? FEATURE_TINT_BG.recording : 'bg-lantern-background-secondary'
        }`}
      >
        {lecture ? (
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-lantern-surface ${FEATURE_INK_TEXT.recording}`}
          >
            <AppIcon name="mic" size={20} />
          </span>
        ) : (
          <p className="text-caption text-lantern-text-secondary line-clamp-5">
            {preview || 'Untitled note'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <AppIcon name={lecture ? 'mic' : 'document-text'} size={16} />
        <span className="text-body font-semibold truncate">{note.title || 'Untitled note'}</span>
      </div>
    </button>
  );
};

export default StudySetMaterialTile;
