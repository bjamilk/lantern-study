/**
 * The note-import progress tray: one record per PDF / slide deck / photo batch
 * / YouTube import, held outside the component that started it so navigating
 * away does not hide an upload that is still running.
 *
 * Exports: `useNoteUploadStore` (`jobs` plus `startJob`, `updateJob`,
 * `completeJob`, `failJob`, `dismissJob`, `dismissAllFinished`, `reset`), the
 * pure selectors `getUploadJobsForUser` / `getActiveUploadJob` /
 * `getVisibleUploadJobs`, and the `NoteUploadJob` / `NoteUploadKind` /
 * `NoteUploadJobStatus` types.
 *
 * Touches: zustand `persist`, localStorage key `lantern-note-upload-jobs`.
 * Only `jobs` is persisted. No network calls — the actual upload lives in the
 * caller, which reports progress in through `updateJob`.
 *
 * FIXED (#144): the persisted list is one list per BROWSER, so on a shared
 * machine it used to show the previous student's file names after a sign-out —
 * `NoteUploadJob` had no owner and the store had no reset. Every record now
 * carries `userId`, stamped at `startJob`; every read goes through
 * `getUploadJobsForUser` (or the two selectors built on it); `reset` runs from
 * the sign-out registry (`stores/userScopedStoreReset.ts`); and a rehydrate
 * DROPS any row with no `userId` — rows written by a build before this one,
 * whose owner is genuinely unknowable. Guessing an owner for them would be the
 * same leak with extra steps, and a dropped row costs a student nothing: an
 * upload cannot resume across a reload anyway (below).
 *
 * Gotchas:
 *  - An upload cannot resume across a reload (the request died with the page),
 *    so `onRehydrateStorage` marks anything still 'uploading'/'processing' and
 *    older than two minutes as failed. That means a genuinely slow import whose
 *    tab was reloaded reads as "Upload interrupted" even if the server finished.
 *  - `getActiveUploadJob` / `getVisibleUploadJobs` are deliberately free
 *    functions, not store getters: they allocate per call and must be used with
 *    `jobs` + `useMemo`, not inside `useNoteUploadStore(...)`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NoteUploadKind = 'pdf' | 'presentation' | 'photos' | 'youtube';
export type NoteUploadJobStatus = 'uploading' | 'processing' | 'complete' | 'failed';

export interface NoteUploadJob {
  id: string;
  /** Owner. Every read filters on it so a shared browser never leaks titles. */
  userId: string;
  fileName: string;
  kind: NoteUploadKind;
  status: NoteUploadJobStatus;
  label: string;
  error?: string;
  noteId?: string;
  startedAt: number;
  updatedAt: number;
  dismissed: boolean;
}

const MAX_JOBS = 12;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Jobs left in-flight after a reload cannot resume — mark as failed. */
const STALE_JOB_MS = 2 * 60 * 1000;

function pruneJobs(jobs: NoteUploadJob[]): NoteUploadJob[] {
  const cutoff = Date.now() - JOB_TTL_MS;
  return jobs
    .filter((j) => j.updatedAt >= cutoff || j.status === 'uploading' || j.status === 'processing')
    .slice(0, MAX_JOBS);
}

function reconcileStaleJobs(jobs: NoteUploadJob[]): NoteUploadJob[] {
  const now = Date.now();
  let changed = false;
  const next = jobs.map((j) => {
    if (
      (j.status === 'uploading' || j.status === 'processing') &&
      now - j.updatedAt > STALE_JOB_MS
    ) {
      changed = true;
      return {
        ...j,
        status: 'failed' as const,
        label: 'Upload interrupted',
        error: 'Upload was interrupted. Please try again.',
        updatedAt: now,
      };
    }
    return j;
  });
  return changed ? next : jobs;
}

/**
 * What a rehydrate keeps: owned rows only, with in-flight ones reconciled.
 *
 * A row with no `userId` was written by a build before #144 and its owner is
 * unknowable. It is DROPPED rather than shown to whoever is signed in now —
 * guessing an owner would be the same leak with extra steps, and an upload
 * cannot resume across a reload anyway, so nothing is lost with it.
 *
 * Pure, and exported, because `onRehydrateStorage` is not reachable from a
 * test without a working localStorage.
 */
export function reconcilePersistedJobs(jobs: NoteUploadJob[]): NoteUploadJob[] {
  return reconcileStaleJobs(jobs.filter((job) => Boolean(job.userId)));
}

/**
 * Rows belonging to one signed-in student, and nobody else's.
 *
 * Signed out (`userId` null/undefined) yields NOTHING rather than everything:
 * "we do not know who this is" must not mean "show whatever is in this
 * browser". A row with no owner is dropped at rehydrate, so it cannot reach
 * here, but the `!job.userId` guard keeps that true for a row set in memory too.
 */
export function getUploadJobsForUser(
  jobs: NoteUploadJob[],
  userId: string | null | undefined
): NoteUploadJob[] {
  if (!userId) return [];
  return jobs.filter((job) => Boolean(job.userId) && job.userId === userId);
}

/** Pure selectors — use with `jobs` from the store + useMemo, not inside useNoteUploadStore(). */
export function getActiveUploadJob(
  jobs: NoteUploadJob[],
  userId: string | null | undefined
): NoteUploadJob | undefined {
  return getUploadJobsForUser(jobs, userId).find(
    (j) => !j.dismissed && (j.status === 'uploading' || j.status === 'processing')
  );
}

export function getVisibleUploadJobs(
  jobs: NoteUploadJob[],
  userId: string | null | undefined
): NoteUploadJob[] {
  return getUploadJobsForUser(jobs, userId)
    .filter((j) => !j.dismissed)
    .slice(0, 5);
}

interface NoteUploadState {
  jobs: NoteUploadJob[];
  /**
   * Start a tracked upload. `userId` is the signed-in student and is REQUIRED:
   * a row that cannot say who it belongs to is a row no later reader can
   * filter, which is exactly the leak this store used to have.
   */
  startJob: (
    fileName: string,
    kind: NoteUploadKind,
    userId: string | null | undefined
  ) => string;
  updateJob: (
    id: string,
    update: Partial<Pick<NoteUploadJob, 'status' | 'label' | 'error' | 'noteId'>>
  ) => void;
  completeJob: (id: string, noteId: string) => void;
  failJob: (id: string, error: string) => void;
  dismissJob: (id: string) => void;
  dismissAllFinished: (userId: string | null | undefined) => void;
  /** Sign-out teardown. See `stores/userScopedStoreReset.ts`. */
  reset: () => void;
}

export const useNoteUploadStore = create<NoteUploadState>()(
  persist(
    (set, get) => ({
      jobs: [],

      startJob: (fileName, kind, userId) => {
        const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const now = Date.now();
        const job: NoteUploadJob = {
          id,
          userId: userId || '',
          fileName,
          kind,
          status: 'uploading',
          label:
            kind === 'pdf'
              ? 'Preparing PDF…'
              : kind === 'youtube'
                ? 'Fetching transcript…'
                : 'Preparing slides…',
          startedAt: now,
          updatedAt: now,
          dismissed: false,
        };
        set((state) => ({ jobs: pruneJobs([job, ...state.jobs]) }));
        return id;
      },

      updateJob: (id, update) => {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, ...update, updatedAt: Date.now() } : j
          ),
        }));
      },

      completeJob: (id, noteId) => {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: 'complete' as const,
                  noteId,
                  label: 'Upload complete',
                  error: undefined,
                  updatedAt: Date.now(),
                }
              : j
          ),
        }));
      },

      failJob: (id, error) => {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: 'failed' as const,
                  error,
                  label: 'Upload failed',
                  updatedAt: Date.now(),
                }
              : j
          ),
        }));
      },

      dismissJob: (id) => {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? { ...j, dismissed: true, updatedAt: Date.now() } : j
          ),
        }));
      },

      dismissAllFinished: (userId) => {
        if (!userId) return;
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.userId === userId && (j.status === 'complete' || j.status === 'failed')
              ? { ...j, dismissed: true }
              : j
          ),
        }));
      },

      // Everything, not just the finished rows: unlike an AI job, an upload
      // costs no credit and holds no generated work — the transfer died with
      // the session — so there is nothing here a student could lose.
      reset: () => set({ jobs: [] }),
    }),
    {
      name: 'lantern-note-upload-jobs',
      partialize: (state) => ({ jobs: state.jobs }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.jobs = reconcilePersistedJobs(state.jobs);
      },
    }
  )
);
