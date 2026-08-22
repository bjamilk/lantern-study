/**
 * Debounced course typeahead over GET /courses plus the cached "my courses"
 * list, merged the way every picker shows them (mine first, then search).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course, UserCourse } from '@lantern/shared/types';
import { fetchCourses } from '../services/api';
import { getMyActiveCourses } from '../services/academic';
import { mergeCourseOptions, suggestCourseCreation } from '../utils/courseSelection';

export function useMyActiveCourses(enabled = true): { myCourses: UserCourse[]; reload: () => void } {
  const [myCourses, setMyCourses] = useState<UserCourse[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getMyActiveCourses({ force: attempt > 0 })
      .then(rows => {
        if (!cancelled) setMyCourses(rows);
      })
      .catch(() => {
        if (!cancelled) setMyCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);
  return { myCourses, reload: () => setAttempt(a => a + 1) };
}

export function useCourseSearch(options: {
  query: string;
  institutionId?: string | null;
  enabled?: boolean;
  excludeIds?: string[];
  myCourses: UserCourse[];
  limit?: number;
}): { options: Course[]; searching: boolean; error: string | null; addCode: string | null } {
  const { query, institutionId, enabled = true, excludeIds, myCourses, limit = 30 } = options;
  const [results, setResults] = useState<Course[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    const requestId = ++requestRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      fetchCourses({ institutionId: institutionId ?? undefined, q: trimmed || undefined, limit: 20 })
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
    }, trimmed ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, institutionId, enabled]);

  // Memoise so `options` keeps a stable identity between renders. Without this
  // a fresh array every render made any consumer effect that depends on
  // `options` (CoursePicker's `known` map) loop: setState → re-render → new
  // array → effect refires. Deps use the joined excludeIds string because
  // callers pass a fresh `excludeIds` array each render.
  const excludeKey = (excludeIds ?? []).join(',');
  const merged = useMemo(
    () => mergeCourseOptions({ myCourses, searchResults: results, query, excludeIds, limit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myCourses, results, query, excludeKey, limit]
  );
  const addCode = useMemo(
    () => (searching ? null : suggestCourseCreation(query, merged)),
    [searching, query, merged]
  );
  return { options: merged, searching, error, addCode };
}
