/**
 * Academic identity + course catalogue — web wrappers over the Phase 1 API
 * (docs/phase1-academic-identity-contract.md §2). Mirrors the shared client
 * in packages/shared/src/api/endpoints.ts but rides the web's own fetch /
 * auth-header / session-expiry plumbing like services/gamificationStreak.ts.
 */
import { getApiBaseUrl } from '@lantern/shared';
import type { Course, User, UserCourse } from '@lantern/shared';
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

// ---------- Academic profile (PUT /users/:id) ----------

export interface AcademicProfilePatch {
  institutionId?: string | null;
  faculty?: string | null;
  programme?: string | null;
  studyLevel?: number | null;
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

/** Campuses minus the "Other …" sentinels — the only rows a profile may reference. */
export const fetchInstitutions = async (country = 'NG'): Promise<InstitutionOption[]> => {
  const campuses = (await fetchMarketplaceCampuses(country)) as InstitutionOption[];
  return filterInstitutions(campuses);
};
