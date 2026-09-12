/**
 * Academic identity + course catalogue — web wrappers over the Phase 1 API
 * (docs/phase1-academic-identity-contract.md §2). Mirrors the shared client
 * in packages/shared/src/api/endpoints.ts but rides the web's own fetch /
 * auth-header / session-expiry plumbing like services/gamificationStreak.ts.
 */
import { getApiBaseUrl } from '@lantern/shared';
import type { Course, CourseTopic, InstitutionSummary, StudySet, User, UserCourse } from '@lantern/shared';
import { mapUserFromApi } from '@lantern/shared/utils/apiMappers';
import { getAuthHeaders, fetchMarketplaceCampuses } from './supabase';
import { handleApiAuthFailure } from './sessionHandler';
import { filterInstitutions, type InstitutionOption } from '../utils/academicSetup';

const API_BASE = getApiBaseUrl();

/**
 * JSON request against `/api/v1` with the web's auth headers and session-expiry
 * handling. Exported so sibling Phase 1 services (services/library.ts) share
 * the plumbing instead of copying it.
 */
export async function academicRequest<T>(path: string, options: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const doFetch = async () => {
    const headers = await getAuthHeaders();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE}/api/v1${path}`, {
        ...options,
        headers: { ...headers, 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    if (await handleApiAuthFailure(res.status)) {
      res = await doFetch();
    } else {
      throw new Error('Session expired');
    }
  }

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    throw new Error(
      (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        (typeof data.message === 'string' && data.message) ||
        'Request failed'
    );
  }
  return data.data as T;
}

// ---------- Course catalogue ----------

/** Search the shared course catalogue (canonical first, then by code). */
export const fetchCourses = (
  filters: { institutionId?: string | null; q?: string; limit?: number } = {}
): Promise<Course[]> => {
  const params = new URLSearchParams();
  if (filters.institutionId) params.set('institutionId', filters.institutionId);
  if (filters.q && filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return academicRequest<Course[]>(`/courses${qs ? `?${qs}` : ''}`).then((rows) => rows || []);
};

/** Find-or-create a course by normalised code (the API returns the row either way). */
export const createCourse = (input: {
  institutionId?: string | null;
  code: string;
  title: string;
  faculty?: string | null;
  level?: number | null;
  semester?: 1 | 2 | null;
}): Promise<Course> =>
  academicRequest<Course>('/courses', { method: 'POST', body: JSON.stringify(input) });

// ---------- Course topics (the syllabus outline inside a course) ----------

/**
 * A course's outline, ordered by position. Shared course data like the course
 * itself — every enrolled student sees the same list.
 *
 * The `course_topics` migration is not applied everywhere yet, so this can
 * reject with a plain server error. Callers must read that as "this course has
 * no outline" and carry on; a missing outline never blocks filing an artefact.
 */
export const fetchCourseTopics = (courseId: string): Promise<CourseTopic[]> =>
  academicRequest<CourseTopic[]>(`/courses/${encodeURIComponent(courseId)}/topics`).then((rows) => rows || []);

/** Find-or-create a topic by title (the API returns the row either way, case-insensitively). */
export const createCourseTopic = (courseId: string, title: string): Promise<CourseTopic> =>
  academicRequest<CourseTopic>(`/courses/${encodeURIComponent(courseId)}/topics`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });

// ---------- Outline management (shared course data — mutations change what every enrolled student sees) ----------

/**
 * Bootstrap an outline from the flashcard tags already used on this course.
 * Returns the resulting outline, which may legitimately be EMPTY: a tag has to
 * be in use enough to clear the server's threshold and "General" is skipped, so
 * a course with only throwaway tags seeds nothing. Callers must report that
 * honestly ("nothing to suggest yet") rather than treat `[]` as a silent no-op.
 */
export const seedCourseTopics = (courseId: string): Promise<CourseTopic[]> =>
  academicRequest<CourseTopic[]>(`/courses/${encodeURIComponent(courseId)}/topics/seed`, {
    method: 'POST',
  }).then((rows) => rows || []);

/**
 * Rename a topic for everyone on the course. A 23505 comes back as the shared
 * duplicate message, so the caller can surface the server's sentence verbatim.
 */
export const renameCourseTopic = (courseId: string, topicId: string, title: string): Promise<CourseTopic> =>
  academicRequest<CourseTopic>(
    `/courses/${encodeURIComponent(courseId)}/topics/${encodeURIComponent(topicId)}`,
    { method: 'PATCH', body: JSON.stringify({ title }) }
  );

/**
 * Persist a new outline order. Send the FULL ordered id list — the server
 * rewrites positions from it — and use the returned list as the new truth.
 */
export const reorderCourseTopics = (courseId: string, topicIds: string[]): Promise<CourseTopic[]> =>
  academicRequest<CourseTopic[]>(`/courses/${encodeURIComponent(courseId)}/topics/order`, {
    method: 'PUT',
    body: JSON.stringify({ topicIds }),
  }).then((rows) => rows || []);

/**
 * Delete a topic. Only UNFILES artefacts (ON DELETE SET NULL) — no note, deck
 * or test is ever destroyed — but the outline is shared, so it disappears for
 * every student on the course. The confirm copy says both things out loud.
 */
export const deleteCourseTopic = (courseId: string, topicId: string): Promise<void> =>
  academicRequest<void>(
    `/courses/${encodeURIComponent(courseId)}/topics/${encodeURIComponent(topicId)}`,
    { method: 'DELETE' }
  );

// ---------- My courses (enrolments) ----------

export const fetchMyCourses = (
  filters: { status?: 'active' | 'archived' | 'all'; academicYear?: string } = {}
): Promise<UserCourse[]> => {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.academicYear) params.set('academicYear', filters.academicYear);
  const qs = params.toString();
  return academicRequest<UserCourse[]>(`/users/me/courses${qs ? `?${qs}` : ''}`).then((rows) => rows || []);
};

/** Replace the active set for an academic year (ids not listed are deleted for that year). */
export const setMyCourses = (input: { courseIds: string[]; academicYear?: string }): Promise<UserCourse[]> =>
  academicRequest<UserCourse[]>('/users/me/courses', { method: 'PUT', body: JSON.stringify(input) }).then(
    (rows) => rows || []
  );

export const updateMyCourse = (
  courseId: string,
  patch: { examDate?: string | null; semester?: 1 | 2 | null; status?: 'active' | 'archived'; academicYear?: string }
): Promise<UserCourse> =>
  academicRequest<UserCourse>(`/users/me/courses/${encodeURIComponent(courseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const removeMyCourse = (courseId: string, academicYear?: string): Promise<void> =>
  academicRequest<void>(
    `/users/me/courses/${encodeURIComponent(courseId)}${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ''}`,
    { method: 'DELETE' }
  );

export const archiveSemester = (academicYear: string): Promise<{ archived: number }> =>
  academicRequest<{ archived: number }>('/users/me/courses/archive-semester', {
    method: 'POST',
    body: JSON.stringify({ academicYear }),
  });

export const fetchMyStudySets = () => academicRequest<StudySet[]>('/users/me/study-sets');

export const createStudySet = (input: {
  title: string;
  courseId?: string | null;
  description?: string | null;
  folderId?: string | null;
}) =>
  academicRequest<StudySet>('/users/me/study-sets', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const fetchStudySet = (setId: string) =>
  academicRequest<StudySet>(`/users/me/study-sets/${encodeURIComponent(setId)}`);

export const updateStudySet = (
  setId: string,
  patch: {
    title?: string;
    courseId?: string | null;
    description?: string | null;
    folderId?: string | null;
    visibility?: 'private' | 'public';
    mode?: 'cram' | 'standard' | 'comprehensive';
    /** "YYYY-MM-DD", or null to clear it. */
    examDate?: string | null;
  }
) =>
  academicRequest<StudySet>(`/users/me/study-sets/${encodeURIComponent(setId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const touchStudySet = (setId: string) =>
  academicRequest<StudySet>(`/users/me/study-sets/${encodeURIComponent(setId)}/touch`, {
    method: 'POST',
  });

export const fetchStudyResume = () => academicRequest('/users/me/study-resume');

export const fetchStudySetFolders = () => academicRequest('/users/me/study-sets/folders');

export const createStudySetFolder = (input: { title: string }) =>
  academicRequest('/users/me/study-sets/folders', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const deleteStudySetFolder = (folderId: string) =>
  academicRequest(`/users/me/study-sets/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
  });

export const fetchStudySetPlan = (setId: string) =>
  academicRequest(`/users/me/study-sets/${encodeURIComponent(setId)}/plan`);

export const replaceStudySetPlan = (setId: string, input: unknown) =>
  academicRequest(`/users/me/study-sets/${encodeURIComponent(setId)}/plan`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const updateStudySetTopicStatus = (setId: string, topicId: string, status: string) =>
  academicRequest(
    `/users/me/study-sets/${encodeURIComponent(setId)}/topics/${encodeURIComponent(topicId)}`,
    { method: 'PATCH', body: JSON.stringify({ status }) }
  );

export const deleteStudySet = (setId: string) =>
  academicRequest<void>(`/users/me/study-sets/${encodeURIComponent(setId)}`, {
    method: 'DELETE',
  });

// ---------- Academic profile (PUT /users/:id) ----------

export interface AcademicProfilePatch {
  institutionId?: string | null;
  faculty?: string | null;
  programme?: string | null;
  studyLevel?: number | null;
  /** 1 = first semester, 2 = second (20260830090000). */
  currentSemester?: 1 | 2 | null;
  entryYear?: number | null;
  expectedGraduationYear?: number | null;
}

/** Writes the academic columns; returns the mapped user (with `institution` summary). */
export const updateAcademicProfile = async (userId: string, patch: AcademicProfilePatch): Promise<User> => {
  const data = await academicRequest<any>(`/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return mapUserFromApi(data);
};

// ---------- Institutions ----------

/** Campuses minus sentinels and non-tertiary kinds — student onboarding only. */
export const fetchInstitutions = async (country = 'NG'): Promise<InstitutionOption[]> => {
  const campuses = (await fetchMarketplaceCampuses(country)) as InstitutionOption[];
  return filterInstitutions(campuses);
};

export const fetchSchools = (filters: { q?: string; kind?: string } = {}) => {
  const params = new URLSearchParams();
  if (filters.q && filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.kind) params.set('kind', filters.kind);
  const qs = params.toString();
  return academicRequest<(InstitutionSummary & { city?: string; state?: string })[]>(
    `/schools${qs ? `?${qs}` : ''}`
  ).then((rows) => rows || []);
};

export const createSchool = (input: { name: string; kind: string; city?: string; state?: string }) =>
  academicRequest<InstitutionSummary>('/schools', { method: 'POST', body: JSON.stringify(input) });
