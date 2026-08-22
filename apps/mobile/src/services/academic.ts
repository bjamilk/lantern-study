/**
 * Academic identity + enrolment helpers for mobile.
 *
 * Thin layer over the shared client: caches "my active courses" (every
 * course picker reads it), invalidates on writes, and keeps the auth store's
 * academicProfile in step with PUT /users/:id.
 */
import type { Course, UserCourse } from '@lantern/shared/types';
import { currentAcademicYear } from '@lantern/shared/academic';
import {
  archiveSemester,
  fetchMyCourses,
  fetchUserProfile,
  removeMyCourse,
  setMyCourses,
  updateMyCourse,
  updateUserProfile,
} from './api';
import { useAuthStore } from '../stores/authStore';
import { extractAcademicProfile, type AcademicProfile } from '../utils/academicProfile';
import { buildYearCourseSet } from '../utils/courseSelection';

let myCoursesCache: { fetchedAt: number; rows: UserCourse[] } | null = null;
let myCoursesInflight: Promise<UserCourse[]> | null = null;
const MY_COURSES_TTL_MS = 60_000;

export function invalidateMyCoursesCache(): void {
  myCoursesCache = null;
}

/** Active enrolments (all academic years), cached for a minute. */
export async function getMyActiveCourses(options: { force?: boolean } = {}): Promise<UserCourse[]> {
  if (!options.force && myCoursesCache && Date.now() - myCoursesCache.fetchedAt < MY_COURSES_TTL_MS) {
    return myCoursesCache.rows;
  }
  if (!myCoursesInflight) {
    myCoursesInflight = fetchMyCourses({ status: 'active' })
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        myCoursesCache = { fetchedAt: Date.now(), rows: list };
        return list;
      })
      .finally(() => {
        myCoursesInflight = null;
      });
  }
  return myCoursesInflight;
}

/** Replace this academic year's active set (PUT semantics: missing ids are deleted). */
export async function saveMyCourseSet(courseIds: string[], academicYear?: string): Promise<UserCourse[]> {
  const rows = await setMyCourses({ courseIds, academicYear });
  invalidateMyCoursesCache();
  return rows;
}

/** Add one course to the current academic year without disturbing the rest. */
export async function addMyCourse(course: Course, academicYear: string = currentAcademicYear()): Promise<UserCourse[]> {
  // Fetch the FULL set (active + archived) for this year, not just active: the
  // PUT below deletes every row for the year not in the id list, so archived
  // enrolments must ride along or archiving a semester then adding a
  // next-semester course would wipe the archived ones.
  const yearRows = (await fetchMyCourses({ status: 'all', academicYear })).filter(
    row => row.academicYear === academicYear
  );
  const { ids, reArchiveIds } = buildYearCourseSet(yearRows, course.id);
  const rows = await saveMyCourseSet(ids, academicYear);
  if (reArchiveIds.length === 0) return rows;
  // The PUT upserts every id as 'active'; restore the ones that were archived.
  await Promise.allSettled(
    reArchiveIds.map(id => updateMyCourse(id, { status: 'archived', academicYear }))
  );
  invalidateMyCoursesCache();
  return getMyActiveCourses({ force: true });
}

export async function removeMyCourseEnrolment(courseId: string, academicYear?: string): Promise<void> {
  await removeMyCourse(courseId, academicYear);
  invalidateMyCoursesCache();
}

export async function setMyCourseExamDate(
  courseId: string,
  examDate: string | null,
  academicYear?: string
): Promise<UserCourse> {
  const row = await updateMyCourse(courseId, { examDate, academicYear });
  invalidateMyCoursesCache();
  return row;
}

export async function archiveAcademicYear(academicYear: string = currentAcademicYear()): Promise<number> {
  const result = await archiveSemester(academicYear);
  invalidateMyCoursesCache();
  return result?.archived ?? 0;
}

export type AcademicProfilePatch = Partial<
  Pick<AcademicProfile, 'institutionId' | 'faculty' | 'programme' | 'studyLevel' | 'entryYear' | 'expectedGraduationYear'>
>;

/** PUT /users/:id with academic fields; mirrors the result into the auth store. */
export async function saveAcademicProfile(userId: string, patch: AcademicProfilePatch): Promise<AcademicProfile> {
  const updated = await updateUserProfile(userId, patch);
  const next = extractAcademicProfile(updated);
  useAuthStore.getState().setAcademicProfile(next);
  return next;
}

/** GET /users/:id → academic projection; also refreshes the auth store copy. */
export async function loadAcademicProfile(userId: string): Promise<AcademicProfile> {
  const profile = await fetchUserProfile(userId);
  const academic = extractAcademicProfile(profile);
  useAuthStore.getState().setAcademicProfile(academic);
  return academic;
}
