/**
 * Pure helpers behind the mobile course typeahead (CoursePicker /
 * CourseMultiSelect / Academic settings). Kept free of React so the
 * search-merge + "Add ‘CODE’" decision can be unit-tested.
 */
import type { Course, UserCourse } from '@lantern/shared/types';
import { isValidCourseCode, normalizeCourseCode } from '@lantern/shared/academic';

/** Shape of GET /marketplace/campuses rows (also what CampusPicker accepts). */
export interface InstitutionOption {
  id: string;
  name: string;
  city: string;
  state: string;
  slug: string;
  country_code?: string;
}

/**
 * Institutions are marketplace campuses minus the "Other (city in Nigeria)"
 * sentinels. The API refuses those ids on PUT /users/:id, so they must never
 * be offered as a university.
 */
export function isSentinelCampus(campus: { slug?: string | null; name?: string | null }): boolean {
  const slug = (campus.slug || '').toLowerCase();
  if (slug === 'other-city-nigeria' || slug.startsWith('other-')) return true;
  return (campus.name || '').trim().toLowerCase() === 'other (city in nigeria)';
}

export function filterInstitutions<T extends { slug?: string | null; name?: string | null }>(
  campuses: T[]
): T[] {
  return campuses.filter(campus => !isSentinelCampus(campus));
}

/** "BIO 201 · Introductory Biology" — the one label every picker uses. */
export function formatCourseLabel(course: Pick<Course, 'code' | 'title'>): string {
  const title = (course.title || '').trim();
  return title && title.toUpperCase() !== course.code ? `${course.code} · ${title}` : course.code;
}

function courseMatchesQuery(course: Course, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const normalized = normalizeCourseCode(q).toLowerCase();
  return (
    course.code.toLowerCase().includes(q) ||
    course.code.toLowerCase().includes(normalized) ||
    (course.title || '').toLowerCase().includes(q)
  );
}

/**
 * Merge "my active courses" (shown first) with server search results,
 * de-duplicated by id, filtered by the query, optionally excluding ids.
 */
export function mergeCourseOptions(options: {
  myCourses: UserCourse[];
  searchResults: Course[];
  query: string;
  excludeIds?: Iterable<string>;
  limit?: number;
}): Course[] {
  const excluded = new Set(options.excludeIds ?? []);
  const seen = new Set<string>();
  const out: Course[] = [];
  const push = (course: Course) => {
    if (!course || seen.has(course.id) || excluded.has(course.id)) return;
    if (!courseMatchesQuery(course, options.query)) return;
    seen.add(course.id);
    out.push(course);
  };
  options.myCourses.forEach(uc => push(uc.course));
  options.searchResults.forEach(push);
  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out;
}

/**
 * Should the list offer an "Add ‘BIO 201’" row for this query?
 * Only when the normalised query is a plausible course code and no visible
 * option already has exactly that code.
 */
export function suggestCourseCreation(query: string, visible: Course[]): string | null {
  const code = normalizeCourseCode(query);
  if (!code || !isValidCourseCode(code)) return null;
  // Require at least one digit: "BIO" alone is a prefix, not a course.
  if (!/\d/.test(code)) return null;
  const exists = visible.some(c => c.code.toUpperCase() === code);
  return exists ? null : code;
}

/**
 * PUT /users/me/courses replaces a whole academic year's set: rows for that
 * year NOT in the list are deleted regardless of status. So adding one course
 * to a year that also has archived enrolments must carry the archived ids in
 * the PUT (or they get wiped — e.g. archive semester 1, then add a semester-2
 * course in the same academic year). The PUT upserts every id as 'active', so
 * `reArchiveIds` are the ones to flip back to 'archived' afterwards.
 */
export function buildYearCourseSet(
  yearRows: Pick<UserCourse, 'course' | 'status'>[],
  addCourseId: string
): { ids: string[]; reArchiveIds: string[] } {
  const archivedIds = yearRows
    .filter(row => row.status === 'archived' && row.course.id !== addCourseId)
    .map(row => row.course.id);
  const activeIds = yearRows
    .filter(row => row.status !== 'archived')
    .map(row => row.course.id);
  const ids = Array.from(new Set([...activeIds, ...archivedIds, addCourseId]));
  return { ids, reArchiveIds: Array.from(new Set(archivedIds)) };
}

/** Toggle a course in a multi-select; returns a new array. */
export function toggleCourseSelection(selected: Course[], course: Course): Course[] {
  return selected.some(c => c.id === course.id)
    ? selected.filter(c => c.id !== course.id)
    : [...selected, course];
}

export const EXAM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" that is a real calendar date; empty string means "clear". */
export function isValidExamDateInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!EXAM_DATE_RE.test(trimmed)) return false;
  const [y, m, d] = trimmed.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Entry / graduation years must be plausible and ordered. */
export function validateAcademicYears(entryYear: number | null, graduationYear: number | null): string | null {
  const inRange = (y: number) => Number.isInteger(y) && y >= 1990 && y <= 2100;
  if (entryYear != null && !inRange(entryYear)) return 'Entry year must be between 1990 and 2100';
  if (graduationYear != null && !inRange(graduationYear)) {
    return 'Expected graduation year must be between 1990 and 2100';
  }
  if (entryYear != null && graduationYear != null && graduationYear < entryYear) {
    return 'Expected graduation year cannot be before entry year';
  }
  return null;
}
