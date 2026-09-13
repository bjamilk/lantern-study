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
import { buildTestDetailPath } from '../utils/appRoutes';

export type AiJobKind =
  | 'smart_notes'
  | 'flashcards'
  | 'quiz'
  | 'import_study'
  // Read-it-to-me writes a narration SCRIPT. No audio is produced or stored —
  // the device speaks it — so the job ends when the words exist.
  | 'narration';

export type AiJobStatus = 'running' | 'succeeded' | 'failed' | 'orphaned';

/** Where clicking a finished job should take the student. */
export interface AiJobTarget {
  /** Route path, e.g. `/notes/abc` — passed to navigateToPath. */
  path: string;
  label: string;
}

/**
 * Where a finished job's output actually landed, as the SERVER names it.
 *
 * `target` is a route the client guessed when the job started ("/flashcards");
 * `resultRef` is the artefact itself, recorded the moment the save landed and
 * persisted with the record. A reload can therefore reopen the exact deck or
 * test, and the same reference is the save-once guard: a job that has one is
 * never allowed to write a second artefact.
 */
export interface AiJobResultRef {
  type: 'deck' | 'test' | 'note' | 'quiz';
  id: string;
  /** In-app route, e.g. `/flashcards/deck/abc`. Always starts with `/`. */
  route: string;
  /** Deck/test name, for the Open button and the notification. */
  name?: string;
}

/** One generated card, in the only two fields every generator produces. */
export interface GeneratedCard {
  front: string;
  back: string;
}

/**
 * Generated material waiting to be written to the library.
 *
 * Serialisable by construction — it is persisted with the job record and read
 * back after a reload, so nothing here may be a function or a class. Its whole
 * purpose is that generating costs a credit and saving does not: a save that
 * failed (offline, a 500, the tab closing between the two) can be finished
 * later without paying for the generation again.
 */
export type PendingAiSave =
  | {
      kind: 'deck';
      deckName: string;
      description?: string;
      /** Save into a deck the student already has, instead of making one. */
      deckId?: string;
      /** File the deck under a course/topic, as the door that opened it promised. */
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
      cards: GeneratedCard[];
    }
  | {
      kind: 'test';
      title: string;
      sourceNoteId?: string;
      /** A test built from a deck's cards. Mutually exclusive with the note. */
      sourceDeckId?: string;
      courseId?: string | null;
      studySetId?: string | null;
      topicId?: string | null;
      questions: unknown[];
      /**
       * The builder's choices (attempt kind, timer) as they will be stored on
       * the test. Kept on the pending save so a retried save after a reload
       * still writes the test the student actually asked for.
       */
      config?: Record<string, unknown>;
      /**
       * When set, Open / the notification stay on this note instead of
       * launching the full test screen.
       */
      stayOnNoteId?: string;
    };

/** What the panel says when a reload finds generated work that never saved. */
export const UNSAVED_GENERATION_ERROR =
  "We made this but hadn't saved it to your library yet.";

/** Routes for each artefact type this client knows how to open. */
export function routeForResultRef(
  type: AiJobResultRef['type'],
  id: string
): string | undefined {
  switch (type) {
    case 'deck':
      return id ? `/flashcards/deck/${encodeURIComponent(id)}` : '/flashcards';
    case 'note':
      return id ? `/notes/${encodeURIComponent(id)}` : '/notes';
    case 'test':
    case 'quiz':
      // A generated test is a place now (`/study/tests/:testId`), so "Open"
      // and the push notification land ON the test rather than on the list
      // with the student left to find it. Without an id there is nothing to
      // open, and the list is the honest fallback.
      return id ? buildTestDetailPath(id) : '/tests';
    default:
      return undefined;
  }
}

const RESULT_REF_LABEL: Record<AiJobResultRef['type'], string> = {
  deck: 'Open deck',
  note: 'Open note',
  test: 'Open test',
  quiz: 'Open test',
};

/**
 * The click target for a finished job, derived from the artefact the server
 * (or the save) actually produced — never from the guess made at start time.
 *
 * An unroutable or id-less reference yields `undefined` rather than a button
 * that would land the student on a list and call it "Open deck".
 */
export function targetForResultRef(
  ref: AiJobResultRef | undefined
): AiJobTarget | undefined {
  if (!ref || !ref.id) return undefined;
  const path = ref.route || routeForResultRef(ref.type, ref.id);
  if (!path || !path.startsWith('/')) return undefined;
  return { path, label: RESULT_REF_LABEL[ref.type] ?? 'Open' };
}

/**
 * Normalise a server `resultRef` (shared JobResultRef) into one this client
 * can route to. Types web has no screen for yield `undefined`.
 */
export function toAiJobResultRef(raw: unknown): AiJobResultRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ref = raw as { type?: unknown; id?: unknown; route?: unknown; name?: unknown };
  const type = ref.type;
  if (type !== 'deck' && type !== 'test' && type !== 'note' && type !== 'quiz') return undefined;
  const id = typeof ref.id === 'string' ? ref.id : '';
  if (!id) return undefined;
  // A server-supplied route is only trusted when it is an in-app path.
  const serverRoute =
    typeof ref.route === 'string' && ref.route.startsWith('/') && !ref.route.startsWith('//')
      ? ref.route
      : undefined;
  const route = serverRoute ?? routeForResultRef(type, id);
  if (!route) return undefined;
  return { type, id, route, name: typeof ref.name === 'string' ? ref.name : undefined };
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
  /**
   * The server's job id, from the 202. Without it a reload has nothing to ask
   * about and every in-flight job could only ever be called orphaned.
   */
  serverJobId?: string;
  /** The server's machine stage word (`reading` | `generating` | `saving` …). */
  serverStage?: string;
  /** The server's monotonic 0..100. The ONLY thing that moves the bar. */
  serverPercent?: number;
  /**
   * Where this job's output landed. Set when the write finishes — earlier than
   * `status: 'succeeded'` and surviving everything after it — so it is both the
   * Open target and the save-once guard.
   */
  resultRef?: AiJobResultRef;
  /** How many cards/questions that save actually persisted. */
  savedCount?: number;
  /** What the AI produced, held until it is safely in the library. */
  pendingSave?: PendingAiSave;
  dismissed: boolean;
  /** Set once the browser notification for this job has fired. */
  notified: boolean;
}

/** How long a student waits before we offer Retry / Keep waiting. */
export const AI_JOB_BUDGET_MS = 90_000;
/** Each "Keep waiting" buys another budget window. */
export const AI_JOB_KEEP_WAITING_MS = 90_000;
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
 * Percent for the progress bar — from the server, or from a stage that really
 * happened. Never from the clock.
 *
 * The old bar crept asymptotically inside each stage on a timer, so a request
 * that had not moved for a minute still showed a bar sliding towards 90%, and
 * a tab with no network at all looked like work in progress. Progress is now
 * reported: the server's monotonic `percent` when there is one, otherwise the
 * floor of the stage the client has actually observed. Between reports the bar
 * holds still, which is the truth.
 */
export function computeJobPercent(job: AiJob, _now?: number): number {
  if (job.status === 'succeeded') return 100;
  const stageCount = Math.max(1, job.stages.length);
  // The floor of the current stage, plus nothing: a stage that has started is
  // the last thing we can honestly claim has happened.
  const base = clamp(job.stageIndex, 0, stageCount - 1) / stageCount;
  const stageFloor = Math.round(base * 100);
  // The server's percent is taken, but never below a stage this client has
  // already observed: the client reports "Writing flashcards" (stage 1 of 3,
  // 33%) BEFORE the request goes out, and the server's first poll answers
  // `queued` at 0 — which used to rewind the bar to 1% for a second.
  const serverPercent =
    typeof job.serverPercent === 'number' && Number.isFinite(job.serverPercent)
      ? Math.round(job.serverPercent)
      : 0;
  return clamp(Math.max(stageFloor, serverPercent), 1, 99);
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

/** Is there generated material on this job that never reached the library? */
export function hasUnsavedGeneration(job: AiJob | undefined): boolean {
  return Boolean(job?.pendingSave) && !job?.resultRef;
}

/**
 * What "Try again" should actually do.
 *
 * Regenerating spends a second credit and makes the student wait again for
 * cards the AI has already written. A job that generated something and failed
 * on the way to the library only ever needs the second half repeating.
 */
export type AiRetryPlan = 'save' | 'generate' | 'none';

export function planRetry(job: AiJob | undefined): AiRetryPlan {
  if (!job) return 'none';
  if (job.resultRef) return 'none';
  return job.pendingSave ? 'save' : 'generate';
}

/** What a reload should do with what was persisted. */
export interface AiResumePlan {
  /** The list as it should now be held in memory. */
  jobs: AiJob[];
  /** Client ids whose server job should be polled again. */
  resume: string[];
  /** Client ids that hold generated material still waiting to be saved. */
  unsaved: string[];
  /** Client ids there is genuinely nothing left to ask about. */
  orphaned: string[];
}

/**
 * A reload drops the in-memory promise — but not the job.
 *
 * Before this, every running job was flatly marked `orphaned`: the panel said
 * "this tab lost track of it, check your library", the Open button pointed at
 * a list, and a deck the server had already finished was never claimed. Three
 * different situations were being collapsed into one:
 *
 *  1. Generated material sat unsaved on the record. Nothing is missing and the
 *     student is one button away from having it, at no further charge — so it
 *     is `failed` with copy that says exactly that, and `planRetry` returns
 *     `save`.
 *  2. The job carries a server id. The server can still be asked how it ended,
 *     so it stays `running` and is handed to `resumeAiJobs` to be watched.
 *  3. Neither. There is nothing left to ask, and claiming failure would be a
 *     lie — that is the one case that is really `orphaned`.
 */
export function planResume(jobs: AiJob[], now: number): AiResumePlan {
  const resume: string[] = [];
  const unsaved: string[] = [];
  const orphaned: string[] = [];
  const next = jobs.map((job) => {
    if (!isJobRunning(job)) return job;
    // Generated material outranks a poll: the work is in this browser, and
    // asking the server about it cannot put it in the library.
    if (hasUnsavedGeneration(job)) {
      unsaved.push(job.id);
      return {
        ...job,
        status: 'failed' as const,
        error: UNSAVED_GENERATION_ERROR,
        updatedAt: now,
        finishedAt: now,
      };
    }
    if (job.serverJobId) {
      resume.push(job.id);
      return job;
    }
    orphaned.push(job.id);
    return { ...job, status: 'orphaned' as const, updatedAt: now, finishedAt: now };
  });
  return { jobs: next, resume, unsaved, orphaned };
}

/**
 * What a server snapshot means for a job whose runner is gone (a resumed watch
 * after a reload).
 *
 * The server's `done` is not the whole story for work the CLIENT files: the
 * promise that would have written the deck died with the old page, so unless
 * the job already recorded a save, or the server itself points at an artefact,
 * nothing is in the library. That is `orphaned` — "check your library" — never
 * `succeeded`, which would put an Open button on a deck that does not exist.
 *
 * Returns `null` while the job is still moving.
 */
export function planServerSettle(
  job: AiJob,
  snapshot: { stage?: string; percent?: number; resultRef?: unknown; error?: string }
): Partial<AiJob> | null {
  const stage = snapshot.stage;
  if (stage === 'done') {
    const ref = job.resultRef ?? toAiJobResultRef(snapshot.resultRef);
    if (ref) {
      return {
        status: 'succeeded',
        resultRef: ref,
        target: targetForResultRef(ref),
        error: undefined,
        pendingSave: undefined,
      };
    }
    if (hasUnsavedGeneration(job)) {
      return { status: 'failed', error: UNSAVED_GENERATION_ERROR };
    }
    return { status: 'orphaned', error: undefined };
  }
  if (stage === 'failed' || stage === 'timed_out') {
    return { status: 'failed', error: snapshot.error || 'That did not finish.' };
  }
  return null;
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
  /** Record the server's job id from the 202, so a reload can reattach. */
  attachServerJob: (id: string, serverJobId: string) => void;
  /** Record a server progress report. The only thing that moves the bar. */
  reportServerProgress: (id: string, snapshot: { stage?: string; percent?: number }) => void;
  /** Hold generated material on the record, BEFORE the save is attempted. */
  recordPendingSave: (id: string, pending: PendingAiSave) => void;
  /**
   * Claim the single save for this job. Returns the reference already
   * recorded when there is one, so a second attempt never mints a second
   * artefact; otherwise records this one and returns null.
   */
  claimSave: (id: string, ref: AiJobResultRef, count: number) => AiJobResultRef | null;
  /** The reference this job already saved, if any. */
  savedRefFor: (id: string) => { ref: AiJobResultRef; count: number } | null;
  succeedJob: (id: string, target?: AiJobTarget) => void;
  failJob: (id: string, error: string) => void;
  /** The server could not say how it ended and there is nothing left to ask. */
  orphanJob: (id: string) => void;
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
    (set, get) => ({
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

      attachServerJob: (id, serverJobId) =>
        set((state) => ({ jobs: patch(state.jobs, id, { serverJobId }) })),

      reportServerProgress: (id, snapshot) =>
        set((state) => ({
          jobs: state.jobs.map((job) => {
            if (job.id !== id || !isJobRunning(job)) return job;
            // Monotonic: a late poll must never rewind the bar.
            const percent =
              typeof snapshot.percent === 'number' && Number.isFinite(snapshot.percent)
                ? Math.max(snapshot.percent, job.serverPercent ?? 0)
                : job.serverPercent;
            if (percent === job.serverPercent && snapshot.stage === job.serverStage) return job;
            return {
              ...job,
              serverStage: snapshot.stage ?? job.serverStage,
              serverPercent: percent,
              updatedAt: Date.now(),
            };
          }),
        })),

      recordPendingSave: (id, pending) =>
        set((state) => ({ jobs: patch(state.jobs, id, { pendingSave: pending }) })),

      claimSave: (id, ref, count) => {
        const existing = get().jobs.find((job) => job.id === id)?.resultRef;
        if (existing) return existing;
        set((state) => ({
          jobs: patch(state.jobs, id, {
            resultRef: ref,
            savedCount: count,
            target: targetForResultRef(ref),
            pendingSave: undefined,
          }),
        }));
        return null;
      },

      savedRefFor: (id) => {
        const job = get().jobs.find((j) => j.id === id);
        return job?.resultRef ? { ref: job.resultRef, count: job.savedCount ?? 0 } : null;
      },

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
                  // The artefact the save actually produced outranks the route
                  // guessed when the job started ("/flashcards"), which is what
                  // used to land Open on a list instead of the new deck.
                  target: targetForResultRef(job.resultRef) ?? target ?? job.target,
                  pendingSave: undefined,
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

      orphanJob: (id) => {
        const now = Date.now();
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id && isJobRunning(job)
              ? { ...job, status: 'orphaned' as const, finishedAt: now, updatedAt: now }
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
        // Non-terminal jobs are settled from the SERVER, not from the fact of
        // a reload: `planResume` keeps the ones that can be reattached alive,
        // and `resumeAiJobs` (aiJobRunner) then watches them.
        state.jobs = pruneJobs(planResume(state.jobs, now).jobs, now);
      },
    }
  )
);
