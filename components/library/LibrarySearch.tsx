import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudArrowDownIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  ShoppingBagIcon,
  Square2StackIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { LibrarySearchResult } from '../../types';
import { searchLibrary } from '../../services/library';
import { useAcademicStore } from '../../stores/academicStore';
import {
  LIBRARY_SEARCH_MIN_CHARS,
  groupLibrarySearchResults,
  isPurchasedBundleId,
  isSearchableQuery,
  searchMatchLabel,
  type LibrarySearchGroups,
} from '../../utils/libraryArchive';

export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;
const LIBRARY_SEARCH_LIMIT = 40;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ---------- Search box ----------

export interface LibrarySearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Escape / the clear button. */
  onClear: () => void;
  /** "in BIO 201" style hint shown inside the box when a course filter is active. */
  scopeLabel?: string | null;
  className?: string;
  autoFocus?: boolean;
}

export const LibrarySearchBox: React.FC<LibrarySearchBoxProps> = ({
  value,
  onChange,
  onClear,
  scopeLabel,
  className = '',
  autoFocus = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 focus-within:ring-2 focus-within:ring-lantern-primary/40 ${className}`}
      role="search"
    >
      <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-lantern-text-secondary" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClear();
            inputRef.current?.blur();
          }
        }}
        placeholder={scopeLabel ? `Search ${scopeLabel}…` : 'Search notes, decks, cards and bundles…'}
        aria-label="Search your library"
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent text-sm text-lantern-text outline-none placeholder:text-lantern-text-tertiary [&::-webkit-search-cancel-button]:hidden"
      />
      {scopeLabel && !value ? (
        <span className="hidden sm:inline shrink-0 rounded-full bg-lantern-primary/10 px-2 py-0.5 text-[11px] font-medium text-lantern-primary">
          {scopeLabel}
        </span>
      ) : null}
      {value ? (
        <button
          type="button"
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="shrink-0 rounded-md p-1 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};

// ---------- Results ----------

export interface LibrarySearchResultsProps {
  /** Raw query; debounced internally (300 ms) and only sent once ≥ 2 chars. */
  query: string;
  /** Course filter: uuid | 'null' (unfiled) | null (everything). */
  courseId: string | null;
  /** Topic filter inside `courseId`: uuid | 'null' (no topic) | null (whole course). */
  topicId?: string | null;
  onOpenNote: (noteId: string) => void;
  onOpenDeck: (deckId: string) => void;
  onOpenBundle: (bundle: LibrarySearchResult) => void;
  className?: string;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; results: LibrarySearchResult[] | null }
  | { status: 'done'; results: LibrarySearchResult[] }
  | { status: 'error'; message: string; results: LibrarySearchResult[] | null };

const formatUpdated = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export const LibrarySearchResults: React.FC<LibrarySearchResultsProps> = ({
  query,
  courseId,
  topicId = null,
  onOpenNote,
  onOpenDeck,
  onOpenBundle,
  className = '',
}) => {
  const debouncedQuery = useDebouncedValue(query.trim(), LIBRARY_SEARCH_DEBOUNCE_MS);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  void knownCourses; // subscribe so course codes on rows resolve once loaded

  useEffect(() => {
    if (!isSearchableQuery(debouncedQuery)) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState((prev) => ({
      status: 'loading',
      results: prev.status === 'done' || prev.status === 'loading' || prev.status === 'error' ? prev.results : null,
    }));
    void searchLibrary({
      q: debouncedQuery,
      courseId: courseId || undefined,
      topicId: topicId || undefined,
      limit: LIBRARY_SEARCH_LIMIT,
    })
      .then((rows) => {
        if (cancelled) return;
        setState({ status: 'done', results: rows });
      })
      .catch((e: any) => {
        if (cancelled) return;
        setState((prev) => ({
          status: 'error',
          message: e?.message || 'Search failed. Check your connection and try again.',
          results: prev.status === 'loading' ? prev.results : null,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, courseId, topicId]);

  const groups: LibrarySearchGroups | null = useMemo(() => {
    const rows = state.status === 'idle' ? null : state.results;
    return rows ? groupLibrarySearchResults(rows) : null;
  }, [state]);

  const typed = query.trim();
  const tooShort = typed.length > 0 && typed.length < LIBRARY_SEARCH_MIN_CHARS;
  const waiting = isSearchableQuery(typed) && debouncedQuery !== typed;

  const courseTag = (row: LibrarySearchResult) => {
    if (courseId) return null; // already scoped — no need to repeat the code on every row
    const course = resolveCourse(row.courseId);
    return course ? (
      <span className="shrink-0 rounded-full bg-lantern-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-lantern-primary">
        {course.code}
      </span>
    ) : null;
  };

  const rowClass =
    'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';

  const renderSnippet = (row: LibrarySearchResult) => {
    const label = searchMatchLabel(row);
    if (!row.snippet && !label) return null;
    return (
      <p className="mt-0.5 text-xs text-lantern-text-secondary line-clamp-2 break-words">
        {label ? <span className="font-medium text-lantern-text-tertiary">{label}: </span> : null}
        {row.snippet}
      </p>
    );
  };

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 ${className}`} aria-live="polite">
      {tooShort ? (
        <p className="text-sm text-lantern-text-secondary">Type at least {LIBRARY_SEARCH_MIN_CHARS} characters to search.</p>
      ) : null}

      {(state.status === 'loading' || waiting) && !groups ? (
        <div className="space-y-2" aria-busy="true" aria-label="Searching">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-lantern-background-secondary animate-pulse" />
          ))}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.message}
        </div>
      ) : null}

      {groups && groups.total === 0 && state.status === 'done' ? (
        <div className="rounded-xl border border-dashed border-lantern-border p-6 text-center">
          <MagnifyingGlassIcon className="mx-auto mb-2 h-8 w-8 text-lantern-text-tertiary" aria-hidden />
          <p className="text-sm font-medium text-lantern-text">No matches for “{debouncedQuery}”</p>
          <p className="mt-1 text-xs text-lantern-text-secondary">
            {topicId
              ? 'Try widening the filter to the whole course.'
              : courseId
                ? 'Try clearing the course filter to search everything you own.'
                : 'Try a different word or a shorter phrase.'}
          </p>
        </div>
      ) : null}

      {groups && groups.total > 0 ? (
        <div className={`space-y-5 ${state.status === 'loading' || waiting ? 'opacity-70' : ''}`}>
          <p className="text-xs text-lantern-text-secondary">
            {groups.total} result{groups.total === 1 ? '' : 's'} for “{debouncedQuery}”
            {groups.total >= LIBRARY_SEARCH_LIMIT ? ' — showing the best matches' : ''}
          </p>

          {groups.notes.length > 0 ? (
            <section aria-labelledby="library-search-notes">
              <h3
                id="library-search-notes"
                className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary"
              >
                <DocumentTextIcon className="h-3.5 w-3.5" aria-hidden /> Notes · {groups.notes.length}
              </h3>
              <ul className="rounded-xl border border-lantern-border bg-lantern-surface divide-y divide-lantern-border/60">
                {groups.notes.map((row) => (
                  <li key={`note-${row.id}`}>
                    <button type="button" onClick={() => onOpenNote(row.id)} className={rowClass}>
                      <DocumentTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-lantern-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-lantern-text">{row.title || 'Untitled note'}</span>
                          {courseTag(row)}
                          <span className="ml-auto shrink-0 text-[10px] text-lantern-text-tertiary">{formatUpdated(row.updatedAt)}</span>
                        </span>
                        {renderSnippet(row)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.decks.length > 0 ? (
            <section aria-labelledby="library-search-decks">
              <h3
                id="library-search-decks"
                className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary"
              >
                <RectangleStackIcon className="h-3.5 w-3.5" aria-hidden /> Flashcards · {groups.decks.length} deck
                {groups.decks.length === 1 ? '' : 's'}
              </h3>
              <ul className="space-y-2">
                {groups.decks.map((group) => (
                  <li key={`deck-${group.deckId}`} className="rounded-xl border border-lantern-border bg-lantern-surface">
                    <button type="button" onClick={() => onOpenDeck(group.deckId)} className={rowClass}>
                      <RectangleStackIcon className="mt-0.5 h-4 w-4 shrink-0 text-lantern-accent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-lantern-text">{group.title || 'Deck'}</span>
                          {group.deck ? courseTag(group.deck) : group.cards[0] ? courseTag(group.cards[0]) : null}
                          {group.cards.length > 0 ? (
                            <span className="shrink-0 text-[10px] text-lantern-text-tertiary">
                              {group.cards.length} matching card{group.cards.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                          {group.deck ? (
                            <span className="ml-auto shrink-0 text-[10px] text-lantern-text-tertiary">
                              {formatUpdated(group.deck.updatedAt)}
                            </span>
                          ) : null}
                        </span>
                        {group.deck ? renderSnippet(group.deck) : null}
                      </span>
                    </button>
                    {group.cards.length > 0 ? (
                      <ul className="border-t border-lantern-border/60 pl-6">
                        {group.cards.map((card) => (
                          <li key={`card-${card.id}`} className="border-b border-lantern-border/40 last:border-b-0">
                            <button type="button" onClick={() => onOpenDeck(card.deckId || group.deckId)} className={rowClass}>
                              <Square2StackIcon className="mt-0.5 h-4 w-4 shrink-0 text-lantern-text-tertiary" aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-lantern-text">{card.title || 'Card'}</span>
                                {renderSnippet(card)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.bundles.length > 0 ? (
            <section aria-labelledby="library-search-bundles">
              <h3
                id="library-search-bundles"
                className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary"
              >
                <CloudArrowDownIcon className="h-3.5 w-3.5" aria-hidden /> Offline bundles · {groups.bundles.length}
              </h3>
              <ul className="rounded-xl border border-lantern-border bg-lantern-surface divide-y divide-lantern-border/60">
                {groups.bundles.map((row) => (
                  <li key={`bundle-${row.id}`}>
                    <button type="button" onClick={() => onOpenBundle(row)} className={rowClass}>
                      <CloudArrowDownIcon className="mt-0.5 h-4 w-4 shrink-0 text-lantern-feature-offline" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-lantern-text">{row.title || 'Bundle'}</span>
                          {isPurchasedBundleId(row.id) ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-lantern-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-lantern-accent">
                              <ShoppingBagIcon className="h-3 w-3" aria-hidden /> Purchased
                            </span>
                          ) : null}
                          {courseTag(row)}
                          <span className="ml-auto shrink-0 text-[10px] text-lantern-text-tertiary">{formatUpdated(row.updatedAt)}</span>
                        </span>
                        {renderSnippet(row)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
