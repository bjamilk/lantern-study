/**
 * AI job delivery state (web).
 *
 * The problem this solves: every AI generate call site used to `await` a
 * promise inside a component. The request itself survives — `pollAiJob` in
 * packages/shared keeps polling `/api/v1/jobs/:id` for up to 180s and nothing
 * aborts it — but the *UI* was component-bound, so navigating away or closing
 * the modal threw away the only reference to the result. The student saw
 * "nothing happened" while the server was still working, and their credits had
 * already been spent.
 *
 * So the run lives here, at module level, not in a component:
 *
 *   runAiJob(descriptor, () => aiGenerateFlashcards(...))
 *
 * The call site fires and forgets. This module holds the promise, ticks a
 * clock so elapsed/percent stay live, applies the result whenever it lands
 * (mounted or not), and notifies. Components only ever *read* — which means
 * unmounting them cannot cancel anything.
 *
 * Credit honesty (product rule): a job is charged by the server exactly once,
 * when the request is accepted. Passing the 90s budget does NOT re-issue it —
 * "Keep waiting" simply extends the budget on a request that is still running.
 * Only an explicit Retry starts a second, separately-charged request, and the
 * UI says so in those words. Nothing here ever tells a student their work was
 * lost while it is still queued.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type AiJobKind =
  | 'smart_notes'
  | 'flashcards'
  | 'quiz'
  | 'import_study';

export type AiJobStatus = 'running' | 'succeeded' | 'failed' | 'orphaned';

/** Where clicking a finished job should take the student. */
export interface AiJobTarget {
  /** Route path, e.g. `/notes/abc` — passed to navigateToPath. */
  path: string;
  label: string;
}

export interface AiJob {
  id: string;
  /** Owner. Selectors filter by this so a shared device never leaks titles. */
  userId: string;
  kind: AiJobKind;
  /** What the student called the thing, e.g. the note title. */
  title: string;
  /** Ordered stage labels; `stageIndex` points at the one running now. */
  stages: string[];
  stageIndex: number;
  stageStartedAt: number;
  status: AiJobStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  /**
   * Deadline for the "taking longer than expected" prompt. Starts at
   * startedAt + AI_JOB_BUDGET_MS and moves forward on "Keep waiting".
   */
  budgetUntil: number;
  /** Credits the server charged for this run. Shown on the Retry warning. */
  creditCost: number;
  error?: string;
  target?: AiJobTarget;
  /** Server job id when the 202 path exposed one. Reserved for reattach. */
  jobId?: string;
  dismissed: boolean;
  /** Set once the browser notification for this job has fired. */
  notified: boolean;
}

/** How long a student waits before we offer Retry / Keep waiting. */
export const AI_JOB_BUDGET_MS = 90_000;
/** Each "Keep waiting" buys another budget window. */
export const AI_JOB_KEEP_WAITING_MS = 90_000;
/** Time constant for within-stage progress creep. */
const STAGE_EXPECT_MS = 12_000;

/** How long a completed result stays on the panel before retiring itself. */
export const SUCCESS_VISIBLE_MS = 2 * 60 * 1000;

const MAX_JOBS = 20;
const JOB_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const AI_JOB_STORAGE_KEY = 'lantern-ai-jobs';

/**
 * Resolves localStorage per call rather than once at module load.
 *
 * zustand's default (`createJSONStorage(() => localStorage)`) is evaluated
 * when the store is created, so a throwing or absent localStorage at that
 * instant — private mode, storage disabled, or simply a non-browser import —
 * disables persistence permanently for the session. Reading it lazily and
 * swallowing failures means job history survives wherever storage works, and
 * degrades to memory-only where it does not, instead of all-or-nothing.
 */
const lazyLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Quota or private mode — the in-memory store is still correct.
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // As above.
    }
  },
};

// ───────────────────────── pure helpers (unit-tested) ─────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isJobRunning(job: AiJob): boolean {
  return job.status === 'running';
}

/**
 * Percent for the progress bar.
 *
 * Monotonic and honest-ish: it advances a full step per completed stage, and
 * creeps asymptotically inside the current stage so a slow model still looks
 * alive without the bar ever reaching 100 before the work actually lands.
 */
export function computeJobPercent(job: AiJob, now: number): number {
  if (job.status === 'succeeded') return 100;
  const stageCount = Math.max(1, job.stages.length);
  const base = clamp(job.stageIndex, 0, stageCount - 1) / stageCount;
  const span = 1 / stageCount;
  const stageElapsed = Math.max(0, now - job.stageStartedAt);
  const creep = 1 - Math.exp(-stageElapsed / STAGE_EXPECT_MS);
  return clamp(Math.round((base + span * creep) * 100), 1, 99);
}

export function computeJobElapsedMs(job: AiJob, now: number): number {
  const end = job.status === 'running' ? now : (job.finishedAt ?? job.updatedAt);
  return Math.max(0, end - job.startedAt);
}

/** "1m 04s" / "12s" — stable width-ish, no library. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** True once the student has waited past the current budget window. */
export function isJobOverBudget(job: AiJob, now: number): boolean {
  return job.status === 'running' && now >= job.budgetUntil;
}

export function getCurrentStageLabel(job: AiJob): string {
  if (job.status === 'succeeded') return 'Done';
  if (job.status === 'failed') return 'Failed';
  if (job.status === 'orphaned') return 'Still running on our servers';
  return job.stages[clamp(job.stageIndex, 0, job.stages.length - 1)] ?? 'Working…';
}

export function pruneJobs(jobs: AiJob[], now: number): AiJob[] {
  const cutoff = now - JOB_TTL_MS;
  return jobs
    .filter((job) => isJobRunning(job) || job.updatedAt >= cutoff)
    .slice(0, MAX_JOBS);
}

/**
 * A reload drops the in-memory promise, so a job that was running can no
 * longer be observed from this tab. It is NOT lost — the server keeps working
 * and the artefact appears in the library — so it becomes `orphaned` with a
 * truthful label, never `failed`.
 */
export function reconcileOrphanedJobs(jobs: AiJob[], now: number): AiJob[] {
  let changed = false;
  const next = jobs.map((job) => {
    if (!isJobRunning(job)) return job;
    changed = true;
    return {
      ...job,
      status: 'orphaned' as const,
      updatedAt: now,
      finishedAt: now,
    };
  });
  return changed ? next : jobs;
}

export function getJobsForUser(jobs: AiJob[], userId: string | null | undefined): AiJob[] {
  if (!userId) return [];
  return jobs.filter((job) => job.userId === userId);
}

export function getActiveJobs(jobs: AiJob[], userId: string | null | undefined): AiJob[] {
  return getJobsForUser(jobs, userId).filter(isJobRunning);
}

/**
 * What the progress panel shows: everything in flight, plus finished work the
 * student has not dismissed.
 *
 * A *success* self-retires after SUCCESS_VISIBLE_MS — the result has landed and
 * the artefact is in their library, so leaving the card up for three days just
 * turns the panel into clutter nobody reads. Failures and orphans stay until
 * dismissed, because those are the ones carrying information the student has
 * not seen yet (an error, or credits spent on a result this tab lost).
 */
export function getVisibleJobs(
  jobs: AiJob[],
  userId: string | null | undefined,
  now: number = Date.now()
): AiJob[] {
  return getJobsForUser(jobs, userId)
    .filter((job) => {
      if (job.dismissed) return false;
      if (job.status !== 'succeeded') return true;
      return now - (job.finishedAt ?? job.updatedAt) < SUCCESS_VISIBLE_MS;
    })
    .slice(0, 6);
}

export function countInFlight(jobs: AiJob[], userId: string | null | undefined): number {
  return getActiveJobs(jobs, userId).length;
}

// ───────────────────────────────── store ─────────────────────────────────

export interface StartAiJobInput {
  userId: string;
  kind: AiJobKind;
  title: string;
  stages: string[];
  creditCost: number;
  target?: AiJobTarget;
}

interface AiJobState {
  jobs: AiJob[];
  /** Bumped by the module-level ticker so elapsed/percent re-render. */
  tick: number;
  startJob: (input: StartAiJobInput) => string;
  advanceStage: (id: string, stageIndex: number) => void;
  attachJobId: (id: string, jobId: string) => void;
  succeedJob: (id: string, target?: AiJobTarget) => void;
  failJob: (id: string, error: string) => void;
  keepWaiting: (id: string) => void;
  markNotified: (id: string) => void;
  dismissJob: (id: string) => void;
  dismissFinished: (userId: string) => void;
  bumpTick: () => void;
}

function patch(jobs: AiJob[], id: string, update: Partial<AiJob>): AiJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...update, updatedAt: Date.now() } : job));
}

export const useAiJobStore = create<AiJobState>()(
  persist(
    (set) => ({
      jobs: [],
      tick: 0,

      startJob: ({ userId, kind, title, stages, creditCost, target }) => {
        const now = Date.now();
        const id = `aijob-${now}-${Math.random().toString(36).slice(2, 9)}`;
        const job: AiJob = {
          id,
          userId,
          kind,
          title,
          stages: stages.length > 0 ? stages : ['Working…'],
          stageIndex: 0,
          stageStartedAt: now,
          status: 'running',
          startedAt: now,
          updatedAt: now,
          budgetUntil: now + AI_JOB_BUDGET_MS,
          creditCost,
          target,
          dismissed: false,
          notified: false,
        };
        set((state) => ({ jobs: pruneJobs([job, ...state.jobs], now) }));
        return id;
      },

      advanceStage: (id, stageIndex) => {
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || !isJobRunning(job)) return job;
            // Never step backwards — the bar must not rewind mid-run.
            const next = clamp(stageIndex, job.stageIndex, job.stages.length - 1);
            if (next === job.stageIndex) return job;
            return { ...job, stageIndex: next, stageStartedAt: Date.now(), updatedAt: Date.now() };
          }),
        }));
      },

      attachJobId: (id, jobId) => set((state) => ({ jobs: patch(state.jobs, id, { jobId }) })),

      succeedJob: (id, target) => {
        const now = Date.now();
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id
              ? {
                  ...job,
                  status: 'succeeded' as const,
                  stageIndex: Math.max(0, job.stages.length - 1),
                  error: undefined,
                  target: target ?? job.target,
                  finishedAt: now,
                  updatedAt: now,
                }
              : job
          ),
        }));
      },

      failJob: (id, error) => {
        const now = Date.now();
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id
              ? { ...job, status: 'failed' as const, error, finishedAt: now, updatedAt: now }
              : job
          ),
        }));
      },

      keepWaiting: (id) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id && isJobRunning(job)
              ? { ...job, budgetUntil: Date.now() + AI_JOB_KEEP_WAITING_MS, updatedAt: Date.now() }
              : job
          ),
        }));
      },

      markNotified: (id) => set((state) => ({ jobs: patch(state.jobs, id, { notified: true }) })),

      dismissJob: (id) => set((state) => ({ jobs: patch(state.jobs, id, { dismissed: true }) })),

      dismissFinished: (userId) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.userId === userId && !isJobRunning(job) ? { ...job, dismissed: true } : job
          ),
        }));
      },

      bumpTick: () => set((state) => ({ tick: state.tick + 1 })),
    }),
    {
      name: AI_JOB_STORAGE_KEY,
      storage: createJSONStorage(() => lazyLocalStorage),
      partialize: (state) => ({ jobs: state.jobs }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = Date.now();
        state.jobs = pruneJobs(reconcileOrphanedJobs(state.jobs, now), now);
      },
    }
  )
);
