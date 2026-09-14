import React, { useMemo, useState } from 'react';
import { isLectureNote } from '@lantern/shared';
import { formatShortDate } from '@lantern/shared/study/setPresentation';
import type { StudyNote } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { StudySetMaterialTile } from './StudySetMaterialTile';
import { MaterialSortMenu, ViewModeToggle, useMaterialSort, useViewMode } from './ViewModeToggle';
import { sortMaterials } from './viewMode';

/** The filter's options. `all` is the default and is never filtered out. */
export type MaterialFilter = 'all' | 'notes' | 'lectures' | 'pdfs' | 'decks';

const FILTER_LABELS: Record<MaterialFilter, string> = {
  all: 'All types',
  notes: 'Notes',
  lectures: 'Lectures',
  pdfs: 'PDFs',
  decks: 'Flashcards',
};

export interface RecentMaterialsDeck {
  id: string;
  name: string;
  cardCount?: number;
}

/** Does this note belong under the chosen filter? */
export function matchesMaterialFilter(note: StudyNote, filter: MaterialFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'decks') return false;
  const lecture = isLectureNote(note);
  if (filter === 'lectures') return lecture;
  if (filter === 'pdfs') return note.sourceType === 'pdf' || note.sourceType === 'presentation';
  // "Notes" means a note a student wrote or imported as text — not the lecture
  // recordings, which have their own row and their own tile.
  return !lecture;
}

/** `2 Sep`, or nothing at all rather than `Invalid Date`. */
function addedLabel(iso?: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(time) ? formatShortDate(new Date(time)) : '';
}

interface RecentMaterialsProps {
  notes: readonly StudyNote[];
  decks?: readonly RecentMaterialsDeck[];
  onOpenNote: (noteId: string) => void;
  onOpenDeck?: (deckId: string) => void;
  /** Opens the Library, filtered to this set. */
  onViewAll: () => void;
  /**
   * The ⋮ for one note — `Add cover…` and the rest — or `null` when the note
   * is not the viewer's to change.
   *
   * This section is where a student inside a set actually meets their notes,
   * and it shipped with no menu on either view: the room's only ⋮ lived on the
   * `Notes` activity list, which is a different screen. So a note could be
   * given a cover from the Library but not from the room that displays it.
   * Both the grid tile and the list row now carry the same trigger.
   */
  renderNoteMenu?: (note: StudyNote) => React.ReactNode;
}

/**
 * `Recent materials`, INSIDE the set room.
 *
 * THE GAP THIS CLOSES. Lantern had this section on Home and in the separate
 * Library destination — everywhere except the set the student is actually
 * studying. So from inside a set, the only way to reach the PDF you uploaded
 * ten minutes ago was to leave the set. StudyFetch keeps a materials grid, a
 * type filter and a `View all materials` tile at the foot of every set room, and
 * this is that.
 *
 * The card is `StudySetMaterialTile` — the same preview-over-label anatomy Home
 * draws, reused rather than re-cut. `HomeRecentMaterials` itself is not reusable
 * here: it reads the global notes/resume stores directly and is scoped to the
 * whole account, so pointing it at one set would mean rewriting it into this
 * component anyway.
 *
 * GRID OR LIST. The grid is the default because it is what this section has
 * always been, so the toggle costs nothing to a student who ignores it. The
 * list earns its place on a set with a lot of material: eight tiles fill a
 * screen and show eight titles, where the same screen of rows shows twenty and
 * puts a date on each — which is the column you need when two PDFs are called
 * `lecture-notes`. The cap is lifted to match: a list that showed only the same
 * eight would be a shorter grid, not a different view.
 */
export const RecentMaterials: React.FC<RecentMaterialsProps> = ({
  notes,
  decks = [],
  onOpenNote,
  onOpenDeck,
  onViewAll,
  renderNoteMenu,
}) => {
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [view, setView] = useViewMode('setRoomMaterials', 'grid');
  const [sort, setSort] = useMaterialSort('setRoomMaterials', 'newest');

  const available = useMemo(() => {
    const options: MaterialFilter[] = ['all'];
    if (notes.some((note) => !isLectureNote(note))) options.push('notes');
    if (notes.some((note) => isLectureNote(note))) options.push('lectures');
    if (notes.some((note) => matchesMaterialFilter(note, 'pdfs'))) options.push('pdfs');
    if (decks.length > 0) options.push('decks');
    return options;
  }, [notes, decks.length]);

  const shown = useMemo(() => {
    const matching = notes.filter((note) => matchesMaterialFilter(note, filter));
    return sortMaterials(matching, sort).slice(0, view === 'list' ? 24 : 8);
  }, [notes, filter, sort, view]);
  const shownDecks = filter === 'all' || filter === 'decks' ? decks.slice(0, 4) : [];

  if (notes.length === 0 && decks.length === 0) return null;

  const empty = shown.length === 0 && shownDecks.length === 0;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title text-lantern-text">Recent materials</h2>
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 1 ? (
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Filter materials by type</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as MaterialFilter)}
                className="min-h-[40px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption text-lantern-text"
              >
                {available.map((option) => (
                  <option key={option} value={option}>
                    {FILTER_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <MaterialSortMenu value={sort} onChange={setSort} label="recent materials" />
          <ViewModeToggle value={view} onChange={setView} label="Recent materials" />
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
              className="min-h-[11rem] overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface text-left hover:bg-lantern-background-secondary"
            >
              <div className={`flex h-28 items-center justify-center ${FEATURE_TINT_BG.flashcards}`}>
                <AppIcon name="layers" size={32} className="text-lantern-ink" />
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <AppIcon name="layers" size={16} className={FEATURE_INK_TEXT.flashcards} />
                <span className="truncate text-body font-semibold">{deck.name}</span>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={onViewAll}
            className="flex min-h-[11rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-lantern-border text-caption font-medium text-lantern-text-secondary hover:border-lantern-text-tertiary hover:text-lantern-text"
          >
            <AppIcon name="arrow-forward" size={20} />
            View all materials
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-lantern-border overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface">
          {shown.map((note) => {
            const lecture = isLectureNote(note);
            const added = addedLabel(note.createdAt);
            const menu = renderNoteMenu?.(note);
            return (
              <li key={note.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onOpenNote(note.id)}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-lantern-background-secondary"
                >
                  <AppIcon
                    name={lecture ? 'mic' : 'document-text'}
                    size={16}
                    aria-hidden
                    className={lecture ? FEATURE_INK_TEXT.recording : FEATURE_INK_TEXT.notes}
                  />
                  <span className="min-w-0 flex-1 truncate text-body">
                    {note.title || (lecture ? 'Lecture' : 'Untitled note')}
                  </span>
                  {added ? (
                    <span className="shrink-0 text-caption text-lantern-text-tertiary">{added}</span>
                  ) : null}
                </button>
                {/* Beside the row button, not inside it — same rule the Notes
                    activity row holds in `NoteRoomRow`. */}
                {menu ? <div className="shrink-0 pr-2">{menu}</div> : null}
              </li>
            );
          })}
          {shownDecks.map((deck) => (
            <li key={deck.id}>
              <button
                type="button"
                onClick={() => onOpenDeck?.(deck.id)}
                className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-lantern-background-secondary"
              >
                <AppIcon
                  name="layers"
                  size={16}
                  aria-hidden
                  className={FEATURE_INK_TEXT.flashcards}
                />
                <span className="min-w-0 flex-1 truncate text-body">{deck.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={onViewAll}
              className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2.5 text-left text-caption font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
            >
              <AppIcon name="arrow-forward" size={16} aria-hidden />
              View all materials
            </button>
          </li>
        </ul>
      )}

      {empty ? (
        <p className="mt-3 text-caption text-lantern-text-secondary">
          Nothing of that type in this set yet.
        </p>
      ) : null}
    </section>
  );
};

export default RecentMaterials;
