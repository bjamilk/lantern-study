import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../../types';
import { useAcademicStore } from '../../stores/academicStore';
import { createCourse, fetchCourses } from '../../services/academic';
import {
  createCourseOffer,
  defaultCourseTitle,
  mergeCourseOptions,
  type CreateCourseOffer,
} from '../../utils/academicSetup';

interface UseCourseSearchOptions {
  /** Scope the catalogue search to one institution (falls back to the whole catalogue). */
  institutionId?: string | null;
  /** Ids to hide from the option list (already selected in a multi-select). */
  excludeIds?: ReadonlyArray<string>;
  /** Skip the "my courses first" prefix (e.g. when picking courses *for* the enrolment list). */
  includeMyCourses?: boolean;
  enabled?: boolean;
  /**
   * Offer "Add ‘MATH’" for letter-only codes. Student pickers keep the default
   * (letters + digits, e.g. BIO 201) so a title like "biology" is not created.
   */
  allowLetterOnlyCreate?: boolean;
}

/**
 * Shared typeahead brain for CoursePicker / CourseMultiSelect: my active
 * courses first, then a debounced catalogue search, plus an "Add ‘CODE’"
 * offer that find-or-creates the course.
 */
export function useCourseSearch({
  institutionId,
  excludeIds,
  includeMyCourses = true,
  enabled = true,
  allowLetterOnlyCreate = false,
}: UseCourseSearchOptions) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Course[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const myCourses = useAcademicStore((s) => s.myCourses);
  const loaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const rememberCourses = useAcademicStore((s) => s.rememberCourses);
  const seq = useRef(0);

  useEffect(() => {
    if (enabled && includeMyCourses && !loaded) void loadMyCourses();
  }, [enabled, includeMyCourses, loaded, loadMyCourses]);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    const current = ++seq.current;
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const rows = await fetchCourses({ institutionId: institutionId || undefined, q: trimmed, limit: 20 });
        if (seq.current !== current) return;
        setResults(rows);
        rememberCourses(rows);
      } catch (e: any) {
        if (seq.current !== current) return;
        setResults([]);
        setError(e?.message || 'Could not search courses');
      } finally {
        if (seq.current === current) setSearching(false);
      }
    }, trimmed ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, institutionId, enabled, rememberCourses]);

  const options = useMemo(
    () => mergeCourseOptions(includeMyCourses ? myCourses : [], results, query, excludeIds || []),
    [myCourses, results, query, excludeIds, includeMyCourses]
  );

  const offer: CreateCourseOffer | null = useMemo(
    () => createCourseOffer(query, options, { requireDigit: allowLetterOnlyCreate ? false : undefined }),
    [query, options, allowLetterOnlyCreate]
  );

  const create = useCallback(
    async (code: string, title?: string): Promise<Course> => {
      setCreating(true);
      setError(null);
      try {
        const course = await createCourse({
          institutionId: institutionId || null,
          code,
          title: title?.trim() || defaultCourseTitle(code),
        });
        rememberCourses([course]);
        setResults((prev) => (prev.some((c) => c.id === course.id) ? prev : [course, ...prev]));
        return course;
      } catch (e: any) {
        setError(e?.message || 'Could not add that course');
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [institutionId, rememberCourses]
  );

  return { query, setQuery, options, offer, searching, creating, error, create };
}
