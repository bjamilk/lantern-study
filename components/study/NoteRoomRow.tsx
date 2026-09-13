import React from 'react';
import { FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';

export interface NoteRoomRowProps {
  title: string;
  onOpen: () => void;
  /**
   * Optional per-row overflow menu (the ⋮ a note needs for its cover).
   *
   * Rendered BESIDE the row's button, never inside it — the same rule the deck
   * tiles follow in `StudySetArtifactLibrary`. A <button> may not contain
   * another button: nesting one puts the menu trigger out of reach of a
   * keyboard and makes every click on it also fire "open the note".
   */
  menu?: React.ReactNode;
}

/**
 * One note in the room's Notes activity list.
 *
 * WHY IT IS ITS OWN FILE. The row was inline JSX inside a 2,000-line workspace,
 * which is why it silently missed the ⋮ the Library list and the deck tiles
 * both have — "Add cover" was reachable from the Library and nowhere else in
 * the room. Pulled out, the row is one thing with one rule about where the menu
 * sits, and a render test can hold that rule without mounting the workspace.
 */
export const NoteRoomRow: React.FC<NoteRoomRowProps> = ({ title, onOpen, menu }) => (
  <div className="relative flex items-center gap-2">
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 flex-1 flex items-center gap-3 p-3 rounded-xl border border-lantern-border text-left hover:bg-lantern-background-secondary"
    >
      <FeatureDisc feature="notes" icon={<AppIcon name="document-text" size={20} />} />
      <span className="text-body font-semibold truncate">{title}</span>
    </button>
    {menu ? <div className="shrink-0">{menu}</div> : null}
  </div>
);

export default NoteRoomRow;
