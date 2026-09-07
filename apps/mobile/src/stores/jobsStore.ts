/**
 * In-flight AI generation jobs (Wave G).
 *
 * The delivery half of every generate button: the work is owned by this store,
 * not by the screen that started it. A student can swipe the progress sheet
 * away, leave the screen, or background the app — the job keeps going, the
 * result is persisted, and a local notification with a deep link is posted when
 * it lands. That is the column StudyFetch loses on both platforms: its web
 * client hangs on work the server already finished, and its Android app hides
 * the wait behind a screen you cannot leave and never notifies at all.
 *
 * All rules that can be stated without I/O live in jobsCore.ts (reducers, the
 * one-shot credit and notification claims, the resume plan) and in
 * components/jobs/jobSheetModel.ts (copy). Those are unit-tested; this file is
 * the wiring, which mobile jest never imports.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  claimNotification,
  claimSave,
  claimUsage,
  createJob,
  dismissJob as dismissJobIn,
  findJob,
  findJobByAnyId,
  isTerminal,
  planSave,
  planServerSettle,
  jobsKey,
  jobsOwnedBy,
  parseJobs,
  patchJob,
  planHydration,
  pruneJobs,
  upsertJob,
  toJobStatusSnapshot,
  UNSAVED_GENERATION_ERROR,
  type JobArtifactRef,
  type JobKind,
  type PendingSave,
  type JobStatusSnapshot,
  type ServerJobStatus,
  type WireJobRecord,
} from './jobsCore';
import type { TrackedJob } from './jobsCore';
import { jobArtifactLink, jobNotification, jobResultLink } from '../components/jobs/jobSheetModel';
import {
  postLocalNotification,
  ensureLocalNotificationPermission,
  markJobPushDelivered,
  resetJobPushDeliveries,
} from '../services/localNotifications';
import { API_BASE_URL, getAuthHeaders } from '../services/supabase';
import { fetchAIUsage } from '../services/ai';
import { isJobStillRunningError } from '../services/jobWatch';
import { useAuthStore } from './authStore';

// ─────────────────────────────────────────────────────────────
// Lane A's job client, as the minimum this store needs.
//
// Written as an injectable interface rather than a direct import so the two
// lanes can land in either order: the default implementation below speaks to
// `GET /api/v1/jobs/:id`, which is the shape that route already serves, and
// `setJobClient` lets the shared client replace it verbatim once it exists.
// ─────────────────────────────────────────────────────────────

export type { JobStatusSnapshot, ServerJobStatus } from './jobsCore';

export interface JobClient {
  getJobStatus(jobId: string): Promise<JobStatusSnapshot>;
}

const defaultJobClient: JobClient = {
  async getJobStatus(jobId: string): Promise<JobStatusSnapshot> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}`, { headers });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: WireJobRecord;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || `Job status check failed (${response.status})`);
    }
    return toJobStatusSnapshot(payload.data ?? (payload as WireJobRecord));
  },
};

let jobClient: JobClient = defaultJobClient;

/** Swap in lane A's client. */
export function setJobClient(client: JobClient): void {
  jobClient = client;
}

// ─────────────────────────────────────────────────────────────
// Runners
// ─────────────────────────────────────────────────────────────

/** What a runner tells the store while it works. */
export interface JobRunContext {
  /**
   * This job's client id. Save paths key their save-once guard on it, so a
   * generation that is interrupted and comes back re-opens the artefact it
   * already wrote instead of writing a second one.
   */
  jobId: string;
  /**
   * Call as soon as the server hands back a job id. From that moment the job
   * survives a cold start: the store can poll the id back to an answer instead
   * of admitting it lost track.
   */
  onServerJob: (serverJobId: string) => void;
  /** Report a stage the client knows about (e.g. "Saving to your deck"). */
  onStage: (stage: string, progress?: number) => void;
}

/** What a finished runner reports. Counts are of artefacts actually SAVED. */
export interface JobOutcome {
  artifact?: JobArtifactRef;
  resultCount?: number;
}

export interface StartJobSpec {
  kind: JobKind;
  /** The material this came from — shown in the sheet and the notification. */
  sourceTitle: string;
  requestedCount?: number;
  /**
   * Whether to open the progress sheet. Default true.
   *
   * Set false where the entry point already has its own visible confirmation
   * and is itself a modal — stacking a second RN Modal on top of the first is
   * the one thing this sheet must not do. Those jobs still run, still notify,
   * and still appear on the Home card, which is where the sheet is reachable.
   */
  watch?: boolean;
  run: (ctx: JobRunContext) => Promise<JobOutcome>;
}

/**
 * Runners cannot be serialised, so they live here rather than in the record.
 * A job whose runner is gone (app restarted) can still be polled by server id
 * and can still be retried from the screen, but the store will not re-run it
 * by itself.
 */
const runners = new Map<string, StartJobSpec>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Which account the persisted list was last loaded for. */
let hydratedFor: string | null = null;

const POLL_INTERVAL_MS = 1500;

interface JobsState {
  jobs: TrackedJob[];
  userId: string | null;
  /** The job whose progress sheet is open, if any. */
  sheetJobId: string | null;
  hydrate: (userId: string) => Promise<void>;
  clear: () => void;
  startJob: (spec: StartJobSpec) => string;
  attachJob: (id: string, serverJobId: string) => void;
  /** Where this job's output landed. Recorded once; a second call is refused. */
  recordSave: (id: string, ref: JobArtifactRef, count: number) => boolean;
  /** What this job has already saved, if anything. */
  savedRefFor: (id: string) => { ref: JobArtifactRef; count: number } | null;
  /**
   * Hold what the AI produced, before trying to save it.
   *
   * Written first so that a save which never lands — no signal, a 500, the
   * process dying — leaves the material on the job record instead of taking
   * it down with it. "Try again" is then a second SAVE, not a second charge.
   */
  recordPendingSave: (id: string, payload: PendingSave) => void;
  /** The generated material this job is still holding, if any. */
  pendingSaveFor: (id: string) => PendingSave | null;
  /** A save landed: record it, drop the held material, finish the job. */
  settleSaved: (id: string, ref: JobArtifactRef, count: number) => void;
  /** A save failed: the job fails, and the material is KEPT for a re-save. */
  settleSaveFailed: (id: string, message: string) => void;
  /** A push arrived about `serverOrClientJobId` — dedupe it and catch up. */
  onJobPush: (serverOrClientJobId: string) => Promise<void>;
  /** Resolve `lanternstudy://jobs/<id>` to the artefact link, if there is one. */
  resolveJobLink: (serverOrClientJobId: string) => Promise<string | null>;
  dismissJob: (id: string) => void;
  /**
   * Run the whole generation again — a fresh AI call, and a fresh charge.
   *
   * Only correct when there is nothing to save: see `planRetry`, and the
   * `retrySaveJob` in services/jobArtifacts.ts that it defers to.
   */
  retryGenerate: (id: string) => string | null;
  stopWatching: (id: string) => void;
  openSheet: (id: string) => void;
  closeSheet: () => void;
}

export const useJobsStore = create<JobsState>((set, get) => {
  const persist = () => {
    const { userId, jobs } = get();
    if (!userId) return;
    void AsyncStorage.setItem(jobsKey(userId), JSON.stringify(jobsOwnedBy(jobs, userId))).catch(
      () => {
        // A failed cache write must not surface as a generation failure.
      }
    );
  };

  const update = (mutate: (jobs: TrackedJob[]) => TrackedJob[]) => {
    set((state) => ({ jobs: mutate(state.jobs) }));
    persist();
  };

  const stopPolling = (id: string) => {
    const timer = pollTimers.get(id);
    if (timer) {
      clearInterval(timer);
      pollTimers.delete(id);
    }
  };

  /**
   * Everything that must happen exactly once when a job stops.
   *
   * The credit reconcile and the notification are both claimed through the
   * pure guards, so the in-process await, a poll response and a resume after a
   * cold start can all reach this without charging twice or notifying twice.
   */
  const settle = (id: string, patch: Partial<TrackedJob>) => {
    stopPolling(id);
    const now = Date.now();
    // Settling twice is normal — the in-process runner, a poll, a push and a
    // resume can all reach the same finish. `patchJob` already keeps the
    // outcome; this keeps the ARTEFACT, so a second settle can never point the
    // notification and the Open button at a different deck than the first one
    // saved. The persisted savedRef is preferred over anything a late caller
    // brings, since it is the one written by the save itself.
    const settled = findJob(get().jobs, id);
    const artifact = settled?.artifact ?? settled?.savedRef ?? patch.artifact;
    update((jobs) =>
      patchJob(jobs, id, { ...patch, ...(artifact ? { artifact } : {}), watching: false }, now)
    );

    const usage = claimUsage(get().jobs, id, now);
    if (usage.claimed) {
      set({ jobs: usage.jobs });
      persist();
      // Read the counter back from the server rather than guessing: a failed
      // async job is refunded server-side, and the badge must show that.
      void fetchAIUsage().catch(() => {
        // Non-fatal: the badge refreshes on its own schedule too.
      });
    }

    const job = findJob(get().jobs, id);
    if (!job) return;
    const notice = jobNotification(job);
    if (!notice) return;
    const claim = claimNotification(get().jobs, id, now);
    if (!claim.claimed) return;
    set({ jobs: claim.jobs });
    persist();
    // `jobId` both dedupes this against a push that already said it and gives
    // the tap something to resolve when the link is only the job itself.
    // Both ids: a server push names the SERVER job, the local one the client
    // job, and the dedupe has to recognise either as "already told".
    void postLocalNotification({ ...notice, jobId: job.id, serverJobId: job.serverJobId });
  };

  /** Fold a server snapshot into a job whose runner is not in this process. */
  const settleFromServer = (id: string, snapshot: JobStatusSnapshot) => {
    const job = findJob(get().jobs, id);
    if (!job) return false;
    const plan = planServerSettle(job, snapshot);
    if (!plan) return false;
    settle(id, plan);
    return true;
  };

  const poll = (id: string) => {
    stopPolling(id);
    const tick = async () => {
      const job = findJob(get().jobs, id);
      if (!job || isTerminal(job.status) || !job.serverJobId) {
        stopPolling(id);
        return;
      }
      try {
        const snapshot = await jobClient.getJobStatus(job.serverJobId);
        // The runner that would have saved it is gone, so the artefact can
        // only be what the SERVER says it saved (`resultRef`) or what this
        // job already recorded saving — and a completion with neither is
        // `lost`, never a "ready" over nothing (planServerSettle).
        if (settleFromServer(id, snapshot)) return;
        update((jobs) =>
          patchJob(
            jobs,
            id,
            // The machine word goes to `serverStage`; `stage` is the student's
            // wording and belongs to the runner alone.
            { status: 'running', serverStage: snapshot.stage, progress: snapshot.progress },
            Date.now()
          )
        );
      } catch {
        // A transient status-check failure is NOT a generation failure. Keep
        // polling; the 90 s budget is what gives the student a way out.
      }
    };
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    pollTimers.set(id, timer);
    void tick();
  };

  return {
    jobs: [],
    userId: null,
    sheetJobId: null,

    hydrate: async (userId: string) => {
      if (hydratedFor === userId) return;
      hydratedFor = userId;
      let stored: TrackedJob[] = [];
      try {
        stored = parseJobs(await AsyncStorage.getItem(jobsKey(userId)));
      } catch {
        stored = [];
      }
      // Jobs already in memory are live in this process and win over the
      // persisted copy (planHydration): a generation started before Home
      // mounted must not be re-read from disk and declared lost mid-run.
      const plan = planHydration(get().jobs, stored, userId, Date.now());
      set({ userId, jobs: plan.jobs });
      persist();
      for (const id of plan.resume) poll(id);
      // A job marked `lost` still owes the student a reconciled credit count.
      for (const id of plan.lost) settle(id, { status: 'lost' });
      // Generated, never saved. The material came back with the record, so
      // this is a failure the student can finish rather than one they have to
      // pay to repeat — the sheet offers "Save to library" (jobSheetModel).
      for (const id of plan.unsaved) {
        settle(id, { status: 'failed', error: UNSAVED_GENERATION_ERROR });
      }
    },

    clear: () => {
      for (const id of Array.from(pollTimers.keys())) stopPolling(id);
      runners.clear();
      resetJobPushDeliveries();
      hydratedFor = null;
      set({ jobs: [], userId: null, sheetJobId: null });
    },

    startJob: (spec: StartJobSpec) => {
      // A generate button can be pressed before Home has hydrated the store,
      // so the owner is resolved here too — an unowned job would be filtered
      // out of its own persisted list on the next load.
      let userId = get().userId;
      if (!userId) {
        userId = useAuthStore.getState().user?.id ?? null;
        if (userId) set({ userId });
      }
      // Home normally hydrates, but a generation can start from a restored
      // note editor first; hydrate now so persisted jobs are reattached and
      // this one is merged (not clobbered) when the read lands.
      if (userId && hydratedFor !== userId) void get().hydrate(userId);
      const now = Date.now();
      const id = `job_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const job = createJob({
        id,
        userId: userId || '',
        kind: spec.kind,
        sourceTitle: spec.sourceTitle,
        requestedCount: spec.requestedCount,
        now,
      });
      const watch = spec.watch !== false;
      runners.set(id, spec);
      update((jobs) => pruneJobs(upsertJob(jobs, { ...job, watching: watch }), now));
      if (watch) set({ sheetJobId: id });

      // Ask for notification permission the first time a job runs, not at
      // boot, and never block on the answer.
      void ensureLocalNotificationPermission();

      void (async () => {
        try {
          update((jobs) => patchJob(jobs, id, { status: 'running' }, Date.now()));
          const outcome = await spec.run({
            jobId: id,
            onServerJob: (serverJobId) => get().attachJob(id, serverJobId),
            onStage: (stage, progress) =>
              update((jobs) => patchJob(jobs, id, { stage, progress }, Date.now())),
          });
          settle(id, {
            status: 'done',
            artifact: outcome.artifact,
            resultCount: outcome.resultCount,
          });
        } catch (error: unknown) {
          if (isJobStillRunningError(error)) {
            // The watcher lost the SERVER, not the job: it may still land and
            // has been charged once. That is `lost` — the honest "check your
            // library" state — never `failed`, which offers a second charge.
            settle(id, {
              status: 'lost',
              error: "We couldn't reach the server to check on it.",
            });
            return;
          }
          settle(id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'The generation failed.',
          });
        }
      })();

      return id;
    },

    recordSave: (id: string, ref: JobArtifactRef, count: number) => {
      const now = Date.now();
      const claim = claimSave(get().jobs, id, ref, count, now);
      if (!claim.claimed) return false;
      // The material is filed; there is nothing left to re-save, and holding
      // it would leave a "Save to library" button over work already in the
      // library.
      set({ jobs: patchJob(claim.jobs, id, { pendingSave: undefined }, now) });
      persist();
      return true;
    },

    savedRefFor: (id: string) => {
      const plan = planSave(findJob(get().jobs, id));
      return plan.action === 'reuse' ? { ref: plan.ref, count: plan.count } : null;
    },

    recordPendingSave: (id: string, payload: PendingSave) => {
      update((jobs) => patchJob(jobs, id, { pendingSave: payload }, Date.now()));
    },

    pendingSaveFor: (id: string) => findJob(get().jobs, id)?.pendingSave ?? null,

    settleSaved: (id: string, ref: JobArtifactRef, count: number) => {
      get().recordSave(id, ref, count);
      // Cleared only now. Until this line the material is the student's only
      // copy, and a crash between the two leaves them a Save button, not a
      // second bill.
      update((jobs) => patchJob(jobs, id, { pendingSave: undefined }, Date.now()));
      settle(id, { status: 'done', artifact: ref, resultCount: count });
    },

    settleSaveFailed: (id: string, message: string) => {
      settle(id, { status: 'failed', error: message });
    },

    /**
     * A push about a job.
     *
     * Two things follow. First, the student has now been told, so the local
     * notification for the same job must not be posted on top of it. Second,
     * this is NEWS: the JS poller does not run while the app is backgrounded,
     * so the server record is read back and the job is settled from it — the
     * store would otherwise still be showing it as running.
     */
    onJobPush: async (serverOrClientJobId: string) => {
      markJobPushDelivered(serverOrClientJobId);
      const job = findJobByAnyId(get().jobs, serverOrClientJobId);
      if (job) markJobPushDelivered(job.id);
      if (!job || isTerminal(job.status)) return;
      // A runner still awaiting this job in-process will save the result and
      // settle it itself; settling here first would report "done" before the
      // cards were written (and swallow a save failure behind a sticky done).
      // The push has been recorded, so that runner's notification is deduped.
      if (runners.has(job.id)) return;
      const serverJobId = job.serverJobId ?? serverOrClientJobId;
      try {
        const snapshot = await jobClient.getJobStatus(serverJobId);
        settleFromServer(job.id, snapshot);
      } catch {
        // The push stands on its own; a failed read is not a failed job.
      }
    },

    resolveJobLink: async (serverOrClientJobId: string) => {
      // A cold start reaches here before Home has hydrated, so the persisted
      // list is loaded first — otherwise every tap after a restart would fall
      // back to Home even though the artefact is on disk.
      const userId = get().userId ?? useAuthStore.getState().user?.id ?? null;
      if (userId) await get().hydrate(userId);
      let job = findJobByAnyId(get().jobs, serverOrClientJobId);
      if (job && !isTerminal(job.status)) {
        await get().onJobPush(serverOrClientJobId);
        job = findJobByAnyId(get().jobs, serverOrClientJobId);
      }
      if (job) {
        const link = jobResultLink(job);
        // A job with no artefact resolves to itself; the caller then shows the
        // in-flight card rather than navigating somewhere it cannot justify.
        return link.includes('://jobs/') ? null : link;
      }
      // Not a job this device knows: ask the server what it produced.
      try {
        const snapshot = await jobClient.getJobStatus(serverOrClientJobId);
        if (snapshot.status === 'completed' && snapshot.artifact) {
          return jobArtifactLink(snapshot.artifact);
        }
      } catch {
        // Offline, or someone else's job. Home's card is the honest answer.
      }
      return null;
    },

    attachJob: (id: string, serverJobId: string) => {
      // The watcher reports the same id on every poll; write it once.
      if (findJob(get().jobs, id)?.serverJobId === serverJobId) return;
      update((jobs) => patchJob(jobs, id, { serverJobId }, Date.now()));
      // The runner is still awaiting the same work in-process; polling only
      // matters once that process is gone, and resume starts it then. Starting
      // a poll here too would double the status traffic for no gain.
    },

    dismissJob: (id: string) => {
      stopPolling(id);
      runners.delete(id);
      update((jobs) => dismissJobIn(jobs, id));
      if (get().sheetJobId === id) set({ sheetJobId: null });
    },

    retryGenerate: (id: string) => {
      const spec = runners.get(id);
      if (!spec) return null;
      get().dismissJob(id);
      return get().startJob(spec);
    },

    stopWatching: (id: string) => {
      update((jobs) => patchJob(jobs, id, { watching: false }, Date.now()));
      if (get().sheetJobId === id) set({ sheetJobId: null });
    },

    openSheet: (id: string) => set({ sheetJobId: id }),
    closeSheet: () => set({ sheetJobId: null }),
  };
});
