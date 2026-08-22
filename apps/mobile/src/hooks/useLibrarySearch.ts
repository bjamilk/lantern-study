/**
 * Debounced GET /library/search (300 ms, ≥ 2 chars) scoped to the Library's
 * course filter. Stale responses are dropped by request id.
 */
import { useEffect, useRef, useState } from 'react';
import type { LibrarySearchResult } from '@lantern/shared/types';
import { searchLibrary } from '../services/api';
import { isLibrarySearchable } from '../utils/libraryArchive';

export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;

export function useLibrarySearch(options: {
  query: string;
  /** Course uuid, `'null'` for unfiled, or null/undefined for everything. */
  courseId?: string | null;
  limit?: number;
}): { results: LibrarySearchResult[]; searching: boolean; error: string | null; active: boolean } {
  const { query, courseId, limit = 30 } = options;
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
    const timer = setTimeout(() => {
      searchLibrary({ q: query.trim(), courseId: courseId ?? undefined, limit })
        .then(rows => {
          if (requestId !== requestRef.current) return;
          setResults(Array.isArray(rows) ? rows : []);
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
  }, [query, courseId, limit, active]);

  return { results, searching, error, active };
}
