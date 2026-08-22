/**
 * My courses (enrolments) — the archive spine every course picker, chip row
 * and the Academic settings section read from. Loaded lazily on first use and
 * refreshed after every write so all surfaces agree.
 */
import { create } from 'zustand';
import type { Course, UserCourse } from '../types';
import { currentAcademicYear } from '@lantern/shared';
import {
  fetchMyCourses,
  setMyCourses as apiSetMyCourses,
  updateMyCourse as apiUpdateMyCourse,
  removeMyCourse as apiRemoveMyCourse,
  archiveSemester as apiArchiveSemester,
} from '../services/academic';
import { findCourseById, planAddCourse } from '../utils/academicSetup';

interface AcademicState {
  /** Every enrolment (active + archived) for the signed-in user. */
  myCourses: UserCourse[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Courses seen in searches/selections — lets pickers label ids that aren't enrolments. */
  knownCourses: Record<string, Course>;

  loadMyCourses: (options?: { force?: boolean }) => Promise<UserCourse[]>;
  /** Replace this year's active set (PUT semantics). */
  replaceMyCourses: (courseIds: string[], academicYear?: string) => Promise<UserCourse[]>;
  /** Add one course to this year's active set (keeps the rest). */
  addMyCourse: (courseId: string, academicYear?: string) => Promise<UserCourse[]>;
  removeMyCourse: (courseId: string, academicYear?: string) => Promise<void>;
  updateMyCourse: (
    courseId: string,
    patch: { examDate?: string | null; semester?: 1 | 2 | null; status?: 'active' | 'archived'; academicYear?: string }
  ) => Promise<UserCourse | null>;
  archiveSemester: (academicYear?: string) => Promise<number>;
  rememberCourses: (courses: ReadonlyArray<Course>) => void;
  resolveCourse: (courseId: string | null | undefined) => Course | null;
  reset: () => void;
}

let inflight: Promise<UserCourse[]> | null = null;

export const useAcademicStore = create<AcademicState>((set, get) => ({
  myCourses: [],
  loaded: false,
  loading: false,
  error: null,
  knownCourses: {},

  loadMyCourses: async (options) => {
    if (!options?.force && get().loaded) return get().myCourses;
    if (inflight) return inflight;
    set({ loading: true, error: null });
    inflight = (async () => {
      try {
        const rows = await fetchMyCourses({ status: 'all' });
        const known = { ...get().knownCourses };
        rows.forEach((uc) => {
          if (uc?.course?.id) known[uc.course.id] = uc.course;
        });
        set({ myCourses: rows, loaded: true, loading: false, knownCourses: known });
        return rows;
      } catch (e: any) {
        set({ loading: false, error: e?.message || 'Could not load your courses' });
        return get().myCourses;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  replaceMyCourses: async (courseIds, academicYear) => {
    const year = academicYear || currentAcademicYear();
    await apiSetMyCourses({ courseIds, academicYear: year });
    return get().loadMyCourses({ force: true });
  },

  addMyCourse: async (courseId, academicYear) => {
    const year = academicYear || currentAcademicYear();
    // The store must hold this year's ARCHIVED rows too, or the union below
    // can't protect them. loadMyCourses fetches status 'all'.
    if (!get().loaded) await get().loadMyCourses();
    // PUT /users/me/courses has SET semantics: it upserts every listed id as
    // ACTIVE and deletes the year's rows not listed. Include the year's archived
    // ids so adding a course never silently deletes archived enrolments (and
    // their exam dates); the archived ids the PUT reactivates are re-archived
    // afterwards so their status/exam date/semester are preserved.
    const { putIds, reArchiveIds } = planAddCourse(get().myCourses, courseId, year);
    await apiSetMyCourses({ courseIds: putIds, academicYear: year });
    for (const id of reArchiveIds) {
      try {
        await apiUpdateMyCourse(id, { status: 'archived', academicYear: year });
      } catch (e) {
        console.warn('[academic] Failed to re-archive course after add:', id, e);
      }
    }
    return get().loadMyCourses({ force: true });
  },

  removeMyCourse: async (courseId, academicYear) => {
    await apiRemoveMyCourse(courseId, academicYear);
    set({
      myCourses: get().myCourses.filter(
        (uc) => !(uc.course?.id === courseId && (!academicYear || uc.academicYear === academicYear))
      ),
    });
  },

  updateMyCourse: async (courseId, patch) => {
    const updated = await apiUpdateMyCourse(courseId, patch);
    if (updated?.course) {
      set({
        myCourses: get().myCourses.map((uc) =>
          uc.course?.id === courseId && uc.academicYear === updated.academicYear ? updated : uc
        ),
      });
    }
    return updated ?? null;
  },

  archiveSemester: async (academicYear) => {
    const year = academicYear || currentAcademicYear();
    const result = await apiArchiveSemester(year);
    await get().loadMyCourses({ force: true });
    return result?.archived ?? 0;
  },

  rememberCourses: (courses) => {
    if (!courses?.length) return;
    const known = { ...get().knownCourses };
    let changed = false;
    courses.forEach((c) => {
      if (c?.id && known[c.id] !== c) {
        known[c.id] = c;
        changed = true;
      }
    });
    if (changed) set({ knownCourses: known });
  },

  resolveCourse: (courseId) => {
    if (!courseId) return null;
    return findCourseById(get().myCourses, courseId) ?? get().knownCourses[courseId] ?? null;
  },

  reset: () => {
    inflight = null;
    set({ myCourses: [], loaded: false, loading: false, error: null, knownCourses: {} });
  },
}));
