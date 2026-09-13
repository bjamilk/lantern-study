import React, { useMemo, useState } from 'react';
import { isLectureNote } from '@lantern/shared';
import type { StudyNote } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { StudySetMaterialTile } from './StudySetMaterialTile';

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

interface RecentMaterialsProps {
  notes: readonly StudyNote[];
  decks?: readonly RecentMaterialsDeck[];
  onOpenNote: (noteId: string) => void;
  onOpenDeck?: (deckId: string) => void;
  /** Opens the Library, filtered to this set. */
  onViewAll: () => void;
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
 */
export const RecentMaterials: React.FC<RecentMaterialsProps> = ({
  notes,
  decks = [],
  onOpenNote,
  onOpenDeck,
  onViewAll,
}) => {
  const [filter, setFilter] = useState<MaterialFilter>('all');

  const available = useMemo(() => {
    const options: MaterialFilter[] = ['all'];
    if (notes.some((note) => !isLectureNote(note))) options.push('notes');
    if (notes.some((note) => isLectureNote(note))) options.push('lectures');
    if (notes.some((note) => matchesMaterialFilter(note, 'pdfs'))) options.push('pdfs');
    if (decks.length > 0) options.push('decks');
    return options;
  }, [notes, decks.length]);

  const shown = useMemo(
    () => notes.filter((note) => matchesMaterialFilter(note, filter)).slice(0, 8),
    [notes, filter]
  );
  const shownDecks = filter === 'all' || filter === 'decks' ? decks.slice(0, 4) : [];

  if (notes.length === 0 && decks.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title text-lantern-text">Recent materials</h2>
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {shown.map((note) => (
          <StudySetMaterialTile key={note.id} note={note} onClick={() => onOpenNote(note.id)} />
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
      {shown.length === 0 && shownDecks.length === 0 ? (
        <p className="mt-3 text-caption text-lantern-text-secondary">
          Nothing of that type in this set yet.
        </p>
      ) : null}
    </section>
  );
};

export default RecentMaterials;
