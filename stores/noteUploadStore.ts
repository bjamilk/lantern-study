/**
 * The note-import progress tray: one record per PDF / slide deck / photo batch
 * / YouTube import, held outside the component that started it so navigating
 * away does not hide an upload that is still running.
 *
 * Exports: `useNoteUploadStore` (`jobs` plus `startJob`, `updateJob`,
 * `completeJob`, `failJob`, `dismissJob`, `dismissAllFinished`), the pure
 * selectors `getActiveUploadJob` / `getVisibleUploadJobs`, and the
 * `NoteUploadJob` / `NoteUploadKind` / `NoteUploadJobStatus` types.
 *
 * Touches: zustand `persist`, localStorage key `lantern-note-upload-jobs`.
 * Only `jobs` is persisted. No network calls — the actual upload lives in the
 * caller, which reports progress in through `updateJob`.
 *
 * Gotchas:
 *  - The key is NOT user-scoped and there is no reset action, so a sign-out in
 *    the same browser leaves the previous student's file names in the tray.
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

/** Pure selectors — use with `jobs` from the store + useMemo, not inside useNoteUploadStore(). */
export function getActiveUploadJob(jobs: NoteUploadJob[]): NoteUploadJob | undefined {
  return jobs.find(
    (j) => !j.dismissed && (j.status === 'uploading' || j.status === 'processing')
  );
}

export function getVisibleUploadJobs(jobs: NoteUploadJob[]): NoteUploadJob[] {
  return jobs.filter((j) => !j.dismissed).slice(0, 5);
}

interface NoteUploadState {
  jobs: NoteUploadJob[];
  startJob: (fileName: string, kind: NoteUploadKind) => string;
  updateJob: (
    id: string,
    update: Partial<Pick<NoteUploadJob, 'status' | 'label' | 'error' | 'noteId'>>
  ) => void;
  completeJob: (id: string, noteId: string) => void;
  failJob: (id: string, error: string) => void;
  dismissJob: (id: string) => void;
  dismissAllFinished: () => void;
}

export const useNoteUploadStore = create<NoteUploadState>()(
  persist(
    (set, get) => ({
      jobs: [],

      startJob: (fileName, kind) => {
        const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const now = Date.now();
        const job: NoteUploadJob = {
          id,
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

      dismissAllFinished: () => {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.status === 'complete' || j.status === 'failed'
              ? { ...j, dismissed: true }
              : j
          ),
        }));
      },
    }),
    {
      name: 'lantern-note-upload-jobs',
      partialize: (state) => ({ jobs: state.jobs }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const reconciled = reconcileStaleJobs(state.jobs);
        if (reconciled !== state.jobs) {
          state.jobs = reconciled;
        }
      },
    }
  )
);
