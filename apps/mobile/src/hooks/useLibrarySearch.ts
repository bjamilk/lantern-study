/**
 * Debounced GET /library/search (300 ms, ≥ 2 chars) scoped to the Library's
 * course and topic filters. Stale responses are dropped by request id.
 */
import { useEffect, useRef, useState } from 'react';
import type { LibrarySearchResult, LibrarySearchType } from '@lantern/shared/types';
import { searchLibrary } from '../services/api';
import { isLibrarySearchable, matchesTopicFilter, UNFILED_COURSE_ID } from '../utils/libraryArchive';

export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;

export function useLibrarySearch(options: {
  query: string;
  /** Course uuid, `'null'` for unfiled, or null/undefined for everything. */
  courseId?: string | null;
  /** Topic uuid inside `courseId`, `'null'` for untopiced, or null/undefined for the whole course. */
  topicId?: string | null;
  /** Omit to search every artefact. Flashcards tab passes decks/cards/bundles. */
  types?: LibrarySearchType[];
  limit?: number;
}): { results: LibrarySearchResult[]; searching: boolean; error: string | null; active: boolean } {
  const { query, courseId, topicId, types, limit = 30 } = options;
  const typesKey = types && types.length > 0 ? types.join(',') : '';
  const [results, setResults] = useState<LibrarySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const active = isLibrarySearchable(query);

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!active) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    // A topic is meaningless server-side without its course, so it never travels alone.
    const scopedTopicId = topicId && courseId && courseId !== UNFILED_COURSE_ID ? topicId : null;
    const timer = setTimeout(() => {
      // The shared client drops `topicId` until it learns the query param, so
      // narrow the rows here as well — a no-op once the server filters, and the
      // rows' own `topicId` is absent (not null) until the migration lands.
      const params = {
        q: query.trim(),
        courseId: courseId ?? undefined,
        topicId: scopedTopicId ?? undefined,
        types: types && types.length > 0 ? types : undefined,
        limit,
      };
      searchLibrary(params)
        .then(rows => {
          if (requestId !== requestRef.current) return;
          const list = Array.isArray(rows) ? rows : [];
          setResults(scopedTopicId ? list.filter(row => matchesTopicFilter(row?.topicId, scopedTopicId)) : list);
          setError(null);
        })
        .catch(e => {
          if (requestId !== requestRef.current) return;
          setResults([]);
          setError(e instanceof Error ? e.message : 'Search failed');
        })
        .finally(() => {
          if (requestId === requestRef.current) setSearching(false);
        });
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, courseId, topicId, typesKey, limit, active]);

  return { results, searching, error, active };
}
