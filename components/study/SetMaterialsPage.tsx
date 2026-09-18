import React, { useMemo, useState } from 'react';
import type { StudyNote } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { LibrarySearchBox } from '../library/LibrarySearch';
import { StudySetMaterialTile } from './StudySetMaterialTile';
import { MaterialSortMenu, ViewModeToggle, useMaterialSort, useViewMode } from './ViewModeToggle';
import { sortMaterials } from './viewMode';
import { matchesMaterialFilter, type MaterialFilter, type RecentMaterialsDeck } from './RecentMaterials';

/**
 * Materials — the `/study/sets/:id/materials` page.
 *
 * WHY IT IS A PAGE IN THE ROOM AND NOT THE LIBRARY SCREEN. The room's "View
 * all materials" used to call `navigateTo(AppMode.LIBRARY)`, which carries no
 * set id — and `LibraryScreen` has no set-scoping prop at all; it filters by
 * course and topic. So the one door a student pressed to see THIS set's
 * materials took them out of the set and showed them the whole account. Set
 * scoping already exists inside the room (`materialsForStudySet`), so the page
 * belongs here, where the set is known.
 *
 * The anatomy is the 2026-09-17 measurement
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Materials):
 * a title with a Folder pill and a dark Upload pill, a filter row (scope chip,
 * All Types, sort, grid/list, search), then a 3-column grid whose first two
 * cards are Add Material and Create Folder, followed by folders and materials.
 *
 * Touches: `CourseWorkspace` (supplies the notes, the folders and the menu),
 * `RecentMaterials` (the filter predicate and the tile are shared, not
 * re-cut), `ViewModeToggle` (the remembered sort and view).
 *
 * Gotchas:
 *  - The folders are NOTE folders (`useNotesStore.folders`), not the study-set
 *    folders in `useStudySetStore` — those group SETS, and filing a material
 *    into one would mean nothing. The two lists are both called `folders`,
 *    which is exactly how the wrong one gets picked.
 *  - The view surface is its own key (`setMaterialsPage`), so the page and the
 *    set home's smaller grid do not fight over one remembered setting.
 *  - Folder cards are real buttons. A card is a control here — it changes what
 *    the grid shows — so a div with an onClick would be unreachable by Tab.
 */

const FILTER_LABELS: Record<MaterialFilter, string> = {
  all: 'All types',
  notes: 'Notes',
  lectures: 'Lectures',
  pdfs: 'PDFs',
  decks: 'Flashcards',
};

export interface MaterialsFolder {
  id: string;
  name: string;
  /** How many of THIS set's materials are filed in it. */
  count: number;
}

interface SetMaterialsPageProps {
  setLabel: string;
  notes: readonly StudyNote[];
  decks?: readonly RecentMaterialsDeck[];
  folders: readonly MaterialsFolder[];
  /** null is "everything in this set"; an id narrows to that folder. */
  folderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onOpenNote: (noteId: string) => void;
  onOpenDeck?: (deckId: string) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  /** Which folder a note is in — used to filter, since notes carry it. */
  folderOfNote: (note: StudyNote) => string | null;
  renderNoteMenu?: (note: StudyNote) => React.ReactNode;
}

export const SetMaterialsPage: React.FC<SetMaterialsPageProps> = ({
  setLabel,
  notes,
  decks = [],
  folders,
  folderId,
  onSelectFolder,
  onOpenNote,
  onOpenDeck,
  onUpload,
  onCreateFolder,
  folderOfNote,
  renderNoteMenu,
}) => {
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useViewMode('setMaterialsPage', 'grid');
  const [sort, setSort] = useMaterialSort('setMaterialsPage', 'newest');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = notes.filter((note) => {
      if (!matchesMaterialFilter(note, filter)) return false;
      if (folderId && folderOfNote(note) !== folderId) return false;
      if (needle && !(note.title || '').toLowerCase().includes(needle)) return false;
      return true;
    });
    return sortMaterials(matching, sort);
  }, [notes, filter, folderId, folderOfNote, query, sort]);

  const shownDecks = useMemo(() => {
    if (folderId) return [];
    if (filter !== 'all' && filter !== 'decks') return [];
    const needle = query.trim().toLowerCase();
    return decks.filter((deck) => !needle || deck.name.toLowerCase().includes(needle));
  }, [decks, filter, folderId, query]);

  const openFolder = folders.find((row) => row.id === folderId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-title text-lantern-text">Materials</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCreateFolder}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <AppIcon name="folder-add" size={16} aria-hidden="true" />
            Folder
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-lantern-text px-3 py-2 text-body font-semibold text-lantern-surface hover:opacity-90"
          >
            <AppIcon name="cloud-upload" size={16} aria-hidden="true" />
            Upload material
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* The scope chip: which set's materials these are. It is a BUTTON only
            when it can do something — inside a folder it steps back out. */}
        {openFolder ? (
          <button
            type="button"
            onClick={() => onSelectFolder(null)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <AppIcon name="chevron-back" size={16} aria-hidden="true" />
            {openFolder.name}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption font-medium text-lantern-text-secondary">
            <AppIcon name="library" size={14} aria-hidden="true" />
            {setLabel}
          </span>
        )}
        <label className="relative inline-flex items-center">
          <span className="sr-only">Filter materials by type</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as MaterialFilter)}
            className="h-8 rounded-xl border border-lantern-border bg-lantern-surface px-2 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
          >
            {(Object.keys(FILTER_LABELS) as MaterialFilter[]).map((option) => (
              <option key={option} value={option}>
                {FILTER_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <MaterialSortMenu value={sort} onChange={setSort} label="materials" />
        <ViewModeToggle value={view} onChange={setView} label="Materials" />
        <div className="min-w-[12rem] flex-1">
          <LibrarySearchBox
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            filterLabel="materials in this set"
          />
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={onUpload}
            className="flex min-h-[226px] flex-col items-center justify-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${FEATURE_TINT_BG.sets}`}>
              <AppIcon name="cloud-upload" size={24} className={FEATURE_INK_TEXT.sets} />
            </span>
            Add material
          </button>
          <button
            type="button"
            onClick={onCreateFolder}
            className="flex min-h-[226px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-lantern-border text-body font-medium text-lantern-text-secondary hover:border-lantern-text-tertiary hover:text-lantern-text"
          >
            <AppIcon name="folder-add" size={24} aria-hidden="true" />
            Create folder
          </button>
          {!openFolder &&
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className="flex min-h-[226px] flex-col items-center justify-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface text-center hover:bg-lantern-background-secondary"
              >
                <AppIcon name="folder" size={32} aria-hidden="true" className={FEATURE_INK_TEXT.notes} />
                <span className="max-w-full truncate px-3 text-body font-medium text-lantern-text">
                  {folder.name}
                </span>
                <span className="text-caption text-lantern-text-secondary">
                  Folder · {folder.count} {folder.count === 1 ? 'item' : 'items'}
                </span>
              </button>
            ))}
          {shown.map((note) => (
            <StudySetMaterialTile
              key={note.id}
              note={note}
              onClick={() => onOpenNote(note.id)}
              menu={renderNoteMenu?.(note)}
            />
          ))}
          {shownDecks.map((deck) => (
            <button
              key={deck.id}
              type="button"
              onClick={() => onOpenDeck?.(deck.id)}
              className="min-h-[226px] overflow-hidden rounded-xl border border-lantern-border bg-lantern-surface text-left hover:bg-lantern-background-secondary"
            >
              <div className={`flex h-[164px] items-center justify-center ${FEATURE_TINT_BG.flashcards}`}>
                <AppIcon name="layers" size={32} className="text-lantern-ink" />
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <AppIcon name="layers" size={16} className={FEATURE_INK_TEXT.flashcards} />
                <span className="truncate text-body font-medium">{deck.name}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-lantern-border overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface">
          {!openFolder &&
            folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                  className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-lantern-background-secondary"
                >
                  <AppIcon name="folder" size={16} aria-hidden="true" className={FEATURE_INK_TEXT.notes} />
                  <span className="min-w-0 flex-1 truncate text-body">{folder.name}</span>
                  <span className="shrink-0 text-caption text-lantern-text-tertiary">
                    {folder.count} {folder.count === 1 ? 'item' : 'items'}
                  </span>
                </button>
              </li>
            ))}
          {shown.map((note) => (
            <li key={note.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onOpenNote(note.id)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-lantern-background-secondary"
              >
                <AppIcon name="document-text" size={16} aria-hidden="true" className={FEATURE_INK_TEXT.notes} />
                <span className="min-w-0 flex-1 truncate text-body">
                  {note.title || 'Untitled note'}
                </span>
              </button>
              {renderNoteMenu ? (
                <div className="shrink-0 pr-2">{renderNoteMenu(note)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 && shownDecks.length === 0 ? (
        <p className="text-body text-lantern-text-secondary">
          {query.trim()
            ? 'Nothing in this set matches that search.'
            : 'Nothing of that type in this set yet.'}
        </p>
      ) : null}
    </div>
  );
};

export default SetMaterialsPage;
