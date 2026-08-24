/**
 * Academic identity + enrolment helpers for mobile.
 *
 * Thin layer over the shared client: caches "my active courses" (every
 * course picker reads it), invalidates on writes, and keeps the auth store's
 * academicProfile in step with PUT /users/:id.
 */
import type { Course, CourseTopic, UserCourse } from '@lantern/shared/types';
import { currentAcademicYear } from '@lantern/shared/academic';
import { sortCourseTopics } from '@lantern/shared';
import {
  archiveSemester,
  fetchMyCourses,
  fetchUserProfile,
  removeMyCourse,
  setMyCourses,
  updateMyCourse,
  updateUserProfile,
} from './api';
import { API_BASE_URL, getAuthHeaders } from './supabase';
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

/* ── Course topics (Phase 1 · A) ─────────────────────────────────────────── */

/**
 * The syllabus outline inside one course. Not in @lantern/shared/api yet, so
 * the endpoint is called the way every other mobile-only route is.
 *
 * An outline is capped at 200 rows server-side, so the whole list is fetched
 * once per course and filtered client-side — no typeahead round-trips.
 *
 * `course_topics` does not exist in production until migration
 * 20260826120000 is applied, so every call here fails today. Callers must
 * treat a failure as "no outline yet" and must never block saving the
 * artefact on it.
 */
const courseTopicsCache = new Map<string, { fetchedAt: number; topics: CourseTopic[] }>();
const courseTopicsInflight = new Map<string, Promise<CourseTopic[]>>();
/**
 * Failures are cached for the same window as successes. While the migration is
 * unapplied every call 500s, and a picker mounts on every screen that shows an
 * artefact's course — without this the app would re-ask on every mount.
 */
const courseTopicsFailure = new Map<string, { failedAt: number; message: string }>();
const COURSE_TOPICS_TTL_MS = 60_000;

async function topicsRequest<T>(
  courseId: string,
  path = '',
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/api/v1/courses/${encodeURIComponent(courseId)}/topics${path}`,
    {
      ...options,
      headers: {
        ...headers,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Topics request failed (${response.status})`);
  }
  return (json.data ?? json) as T;
}

/**
 * THE syllabus order, shared with web and the Library trees: position, then
 * title (case-insensitive), then id. One comparator everywhere or the outline
 * reorders itself between the picker cache and the tree.
 */
function sortTopics(topics: CourseTopic[]): CourseTopic[] {
  return sortCourseTopics(topics);
}

export function invalidateCourseTopicsCache(courseId?: string): void {
  if (courseId) {
    courseTopicsCache.delete(courseId);
    courseTopicsFailure.delete(courseId);
  } else {
    courseTopicsCache.clear();
    courseTopicsFailure.clear();
  }
}

/** A course's outline, cached for a minute like "my courses". */
export async function getCourseTopics(
  courseId: string,
  options: { force?: boolean } = {}
): Promise<CourseTopic[]> {
  const cached = courseTopicsCache.get(courseId);
  if (!options.force && cached && Date.now() - cached.fetchedAt < COURSE_TOPICS_TTL_MS) {
    return cached.topics;
  }
  const failure = courseTopicsFailure.get(courseId);
  if (!options.force && failure && Date.now() - failure.failedAt < COURSE_TOPICS_TTL_MS) {
    throw new Error(failure.message);
  }
  let inflight = courseTopicsInflight.get(courseId);
  if (!inflight) {
    inflight = topicsRequest<CourseTopic[]>(courseId)
      .then(rows => {
        const topics = sortTopics(Array.isArray(rows) ? rows : []);
        courseTopicsCache.set(courseId, { fetchedAt: Date.now(), topics });
        courseTopicsFailure.delete(courseId);
        return topics;
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Could not load topics';
        courseTopicsFailure.set(courseId, { failedAt: Date.now(), message });
        throw e;
      })
      .finally(() => {
        courseTopicsInflight.delete(courseId);
      });
    courseTopicsInflight.set(courseId, inflight);
  }
  return inflight;
}

/**
 * Find-or-create by title, the same shape courses use: typing a topic that
 * already exists selects it rather than creating a near-duplicate.
 */
export async function createCourseTopic(courseId: string, title: string): Promise<CourseTopic> {
  const topic = await topicsRequest<CourseTopic>(courseId, '', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  // The endpoint clearly works, so stop short-circuiting the next read.
  courseTopicsFailure.delete(courseId);
  // Keep the cached outline in step so the picker lists the new topic at once
  // instead of after the TTL. find-or-create can return an existing row, hence
  // the de-dupe.
  const cached = courseTopicsCache.get(courseId);
  if (cached) {
    courseTopicsCache.set(courseId, {
      fetchedAt: cached.fetchedAt,
      topics: sortTopics([...cached.topics.filter(t => t.id !== topic.id), topic]),
    });
  }
  return topic;
}

/**
 * The outline mutations behind ManageOutlineSheet and the picker's seed row.
 * All are pure round-trips: the CALLER owns the cache, invalidating it after a
 * mutation (invalidateCourseTopicsCache) so no picker keeps a stale outline.
 * Every one changes SHARED course data — the outline everyone on the course
 * sees — which is why the sheet confirms before deleting.
 */

/** Bootstrap an empty outline from the course's flashcard tags (POST /topics/seed). */
export async function seedCourseTopics(courseId: string): Promise<CourseTopic[]> {
  const rows = await topicsRequest<CourseTopic[]>(courseId, '/seed', { method: 'POST' });
  return sortTopics(Array.isArray(rows) ? rows : []);
}

/**
 * Rewrite the outline order (PUT /topics/order): the client sends ids in the
 * order it wants and the server assigns sparse positions, returning the outline.
 */
export async function reorderCourseTopics(courseId: string, orderedIds: string[]): Promise<CourseTopic[]> {
  const rows = await topicsRequest<CourseTopic[]>(courseId, '/order', {
    method: 'PUT',
    body: JSON.stringify({ topicIds: orderedIds }),
  });
  return sortTopics(Array.isArray(rows) ? rows : []);
}

/** Rename one topic (PATCH /topics/:id). */
export async function renameCourseTopic(
  courseId: string,
  topicId: string,
  title: string
): Promise<CourseTopic> {
  return topicsRequest<CourseTopic>(courseId, `/${encodeURIComponent(topicId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

/**
 * Delete one topic (DELETE /topics/:id). Only UNFILES artefacts
 * (ON DELETE SET NULL) — it never deletes anyone's notes, decks or tests.
 */
export async function deleteCourseTopic(courseId: string, topicId: string): Promise<void> {
  await topicsRequest<void>(courseId, `/${encodeURIComponent(topicId)}`, { method: 'DELETE' });
}

/**
 * Is there an outline worth showing a second "Move to topic" step for? An
 * unreadable outline (the course_topics migration is not applied everywhere)
 * counts as none: a sheet whose only possible message is "no topics here" is
 * one dismissal the student never asked for.
 */
export async function courseHasTopics(courseId: string): Promise<boolean> {
  try {
    return (await getCourseTopics(courseId)).length > 0;
  } catch {
    return false;
  }
}
