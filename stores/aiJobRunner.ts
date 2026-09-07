/**
 * Module-level runner for AI jobs.
 *
 * Everything here deliberately lives outside React. A generate call started
 * from a modal must keep running when that modal closes, when the student
 * navigates to another screen, and when the component tree that started it has
 * been unmounted entirely — so the promise, the clock and the completion
 * handler are all held by this module, not by an effect.
 *
 * Call sites do:
 *
 *   await runAiJob({ ... }, async (report) => { report(1); return doWork(); });
 *
 * Awaiting is optional. The store already knows about the job, so a caller
 * that walks away loses nothing.
 */

import {
  useAiJobStore,
  SUCCESS_VISIBLE_MS,
  planRetry,
  type AiJobKind,
  type AiJobTarget,
  type StartAiJobInput,
} from './aiJobStore';
import { isJobStillRunningError } from '@lantern/shared/jobs/jobClient';
import { retrySaveJob } from '../services/jobArtifacts';
import { appNavigate } from '../utils/appNavigation';
import {
  getWebNotificationPermission,
  requestWebNotificationPermission,
  showWebNotification,
  onWebNotificationClick,
} from '../utils/webNotifications';

/** Reports that the job has moved on to stage `index`. */
export type StageReporter = (index: number) => void;

/**
 * What a generator is handed so its work can outlive this tab.
 *
 * `clientJobId` is the idempotency key every save is made under — the same id
 * the store keys the job on — so a retried save replays the first write rather
 * than creating a second deck. `onServerJob` records the id from the 202,
 * which is the only thing that lets a reload ask how the run ended.
 */
export interface AiJobHooks {
  clientJobId: string;
  onServerJob: (serverJobId: string) => void;
  onServerProgress: (snapshot: { stage?: string; percent?: number }) => void;
}

export interface RunAiJobInput extends Omit<StartAiJobInput, 'userId'> {
  userId: string;
}

export interface RunAiJobExtras<T> {
  /** Derives the click target from the result (e.g. the new deck's route). */
  resolveTarget?: (result: T) => AiJobTarget | undefined;
}

// ───────────────────────────── the ticker ─────────────────────────────

let tickHandle: ReturnType<typeof setInterval> | null = null;

/**
 * One interval for the whole app, running only while something is in flight.
 * It exists so elapsed time and the progress creep stay live; the store is the
 * single source of truth, components just re-render off `tick`.
 */
function ensureTicker(): void {
  if (tickHandle !== null) return;
  tickHandle = setInterval(() => {
    const { jobs, bumpTick } = useAiJobStore.getState();
    const now = Date.now();
    // Keep ticking while anything is running, and for as long as a completed
    // result is still on screen — otherwise the clock stops the moment the
    // last job lands and its card never retires itself.
    const stillInteresting = jobs.some(
      (job) =>
        job.status === 'running' ||
        (job.status === 'succeeded' &&
          !job.dismissed &&
          now - (job.finishedAt ?? job.updatedAt) < SUCCESS_VISIBLE_MS)
    );
    bumpTick();
    if (!stillInteresting) stopTicker();
  }, 1000);
}

function stopTicker(): void {
  if (tickHandle === null) return;
  clearInterval(tickHandle);
  tickHandle = null;
}

/**
 * Start the clock for a job this process did not launch — a run resumed after
 * a reload. Without it the panel's elapsed time sits frozen at the moment the
 * page loaded while the job really is still going.
 */
export function ensureAiJobTicker(): void {
  ensureTicker();
}

/** Test/teardown helper. */
export function __stopAiJobTickerForTests(): void {
  stopTicker();
}

// ─────────────────────────── navigation bridge ───────────────────────────

/**
 * Navigation from outside React. `appNavigate` is the app's existing
 * module-level router handle (utils/appNavigation), already registered by
 * useAppNavigation — so a notification click or a panel button can reach the
 * router without this module holding a component reference.
 */
let notificationClickUnsub: (() => void) | null = null;

/** Called once by App: routes service-worker notification clicks. */
export function startAiJobNotificationRouting(): () => void {
  if (notificationClickUnsub) return () => {};
  notificationClickUnsub = onWebNotificationClick((data) => {
    const url = typeof data.url === 'string' ? data.url : null;
    // Only in-app paths — never follow a URL into another origin.
    if (url && url.startsWith('/') && !url.startsWith('//')) appNavigate(url);
  });
  return () => {
    notificationClickUnsub?.();
    notificationClickUnsub = null;
  };
}

export function navigateToAiJobTarget(target: AiJobTarget | undefined): void {
  if (target) appNavigate(target.path);
}

// ───────────────────────────── notifications ─────────────────────────────

let permissionAsked = false;

/**
 * Asked at the moment the student kicks off long work — never at app boot,
 * where a permission prompt has no context and gets denied for good.
 */
function requestPermissionLazily(): void {
  if (permissionAsked) return;
  permissionAsked = true;
  if (getWebNotificationPermission() !== 'default') return;
  void requestWebNotificationPermission();
}

const DONE_TITLE: Record<AiJobKind, string> = {
  smart_notes: 'Smart Notes ready',
  flashcards: 'Flashcards ready',
  // A 'quiz' job files a personal TEST (`writeTest`), and the row it lands on
  // is titled "Test · <source>": one name for one thing.
  quiz: 'Test ready',
  import_study: 'Study set ready',
  narration: 'Ready to read aloud',
};

function notifyDone(jobId: string): void {
  const job = useAiJobStore.getState().jobs.find((j) => j.id === jobId);
  if (!job || job.notified) return;
  useAiJobStore.getState().markNotified(jobId);

  const succeeded = job.status === 'succeeded';
  void showWebNotification({
    title: succeeded ? DONE_TITLE[job.kind] : 'AI generation failed',
    body: succeeded
      ? `${job.title} — tap to open.`
      : job.error || `${job.title} could not be generated.`,
    tag: `ai-job-${job.id}`,
    // The SW forwards `url` back to the page on click; see public/sw.js.
    data: job.target ? { url: job.target.path } : undefined,
    onClick: () => navigateToAiJobTarget(job.target),
  });
}

// ────────────────────────────── the runner ──────────────────────────────

/**
 * Lets the panel's Retry button re-run the *original* work.
 *
 * Session-scoped on purpose: a closure cannot be persisted, so after a reload
 * there is nothing to re-run and the panel hides Retry rather than offering a
 * button that would silently do nothing.
 */
const retryRegistry = new Map<string, () => Promise<unknown>>();

export function canRetryAiJob(id: string): boolean {
  // A held save is retryable even after a reload: the material is on the
  // record, not in a closure this page no longer has.
  if (planRetry(useAiJobStore.getState().jobs.find((j) => j.id === id)) === 'save') return true;
  return retryRegistry.has(id);
}

/**
 * Re-runs the work behind a finished job as a NEW request, which the server
 * charges again — the UI must say so before calling this. Returns the new
 * job's promise, or null when the closure is gone (post-reload).
 */
export function retryAiJob(id: string): Promise<unknown> | null {
  // Retry the SAVE, not the generation, whenever the material still exists.
  // The AI call has already happened and has already been charged; only the
  // write to the library failed, and repeating that costs nothing.
  if (planRetry(useAiJobStore.getState().jobs.find((j) => j.id === id)) === 'save') {
    return retrySaveJob(id).catch(() => undefined);
  }
  const again = retryRegistry.get(id);
  if (!again) return null;
  retryRegistry.delete(id);
  useAiJobStore.getState().dismissJob(id);
  return again().catch(() => undefined);
}

/** True when Try again would finish a save rather than buy a new generation. */
export function isSaveRetry(id: string): boolean {
  return planRetry(useAiJobStore.getState().jobs.find((j) => j.id === id)) === 'save';
}

export async function runAiJob<T>(
  input: RunAiJobInput,
  executor: (report: StageReporter, hooks: AiJobHooks) => Promise<T>,
  extras: RunAiJobExtras<T> = {}
): Promise<T> {
  const store = useAiJobStore.getState();
  const id = store.startJob(input);
  retryRegistry.set(id, () => runAiJob(input, executor, extras));
  ensureTicker();
  requestPermissionLazily();

  const report: StageReporter = (index) => {
    useAiJobStore.getState().advanceStage(id, index);
  };

  const hooks: AiJobHooks = {
    clientJobId: id,
    onServerJob: (serverJobId) => {
      useAiJobStore.getState().attachServerJob(id, serverJobId);
    },
    onServerProgress: (snapshot) => {
      useAiJobStore.getState().reportServerProgress(id, snapshot);
    },
  };

  try {
    const result = await executor(report, hooks);
    const target = extras.resolveTarget?.(result) ?? input.target;
    useAiJobStore.getState().succeedJob(id, target);
    notifyDone(id);
    // Succeeded work must never be re-issued — that would double-charge.
    retryRegistry.delete(id);
    return result;
  } catch (error: unknown) {
    if (isJobStillRunningError(error)) {
      // The watcher gave up reaching the server, not the job: it may still
      // finish and it has already been charged once. Say exactly that — and
      // never "failed", which would invite a second, double-charged attempt.
      useAiJobStore
        .getState()
        .failJob(
          id,
          "We couldn't reach the server to check on this. It may still finish — check your library before generating it again."
        );
      throw error;
    }
    const message =
      error instanceof Error ? error.message : 'AI generation failed. Please try again.';
    useAiJobStore.getState().failJob(id, message);
    notifyDone(id);
    throw error;
  }
}
