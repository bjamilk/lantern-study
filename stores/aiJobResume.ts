/**
 * Reattaching to work that outlived the page.
 *
 * A reload throws away the promise, not the job. Before this, every in-flight
 * job was flatly relabelled "this tab lost track of it — check your library":
 * true only in the one case where the client never learned a server job id.
 * With the id persisted (`serverJobId`), the server can still be asked how the
 * run ended, and the answer is authoritative — so a deck that finished while
 * the student was away is claimed, opened at its own route, and never reported
 * as a loss.
 *
 * The rules themselves are pure and live in stores/aiJobStore (`planResume`,
 * `planServerSettle`), mirroring apps/mobile/src/stores/jobsCore.ts. This
 * module is the I/O: one watcher per resumable job, and the held save finished
 * the moment the server says the generation is done.
 */
import { createJobClient } from '@lantern/shared/jobs/jobClient';
import { getApiBaseUrl } from '@lantern/shared';
import { getAuthHeaders } from '../services/supabase';
import { retrySaveJob } from '../services/jobArtifacts';
import { ensureAiJobTicker } from './aiJobRunner';
import {
  hasUnsavedGeneration,
  planServerSettle,
  useAiJobStore,
  type AiJob,
} from './aiJobStore';

const jobs = createJobClient({
  getBaseUrl: () => getApiBaseUrl(),
  getAuthHeaders,
});

/** jobs already being watched by this page, so a second call is a no-op. */
const watching = new Set<string>();

/** Test/teardown helper. */
export function __resetAiJobResumeForTests(): void {
  watching.clear();
}

function settle(job: AiJob, patch: Partial<AiJob>): void {
  const store = useAiJobStore.getState();
  if (patch.status === 'succeeded') {
    // Persist the artefact the server pointed at, not only the route derived
    // from it: `resultRef` is the save-once guard and what a later reload
    // reads, and `claimSave` refuses to overwrite one this client made.
    if (patch.resultRef) store.claimSave(job.id, patch.resultRef, job.savedCount ?? 0);
    store.succeedJob(job.id, patch.target);
    return;
  }
  if (patch.status === 'failed') {
    store.failJob(job.id, patch.error || 'That did not finish.');
    return;
  }
  if (patch.status === 'orphaned') {
    store.orphanJob(job.id);
  }
}

/**
 * Watch one resumable job through to a real answer.
 *
 * The server's `done` is not the end of the story for work this client files:
 * when the job is still holding generated material, the save is finished here
 * — at no further charge — and only then is the job called succeeded.
 */
async function resumeOne(clientId: string): Promise<void> {
  const job = useAiJobStore.getState().jobs.find((j) => j.id === clientId);
  if (!job?.serverJobId || watching.has(clientId)) return;
  watching.add(clientId);

  try {
    for (;;) {
      const outcome = await jobs.watchJob(job.serverJobId, (progress) => {
        useAiJobStore.getState().reportServerProgress(clientId, {
          stage: progress.stage,
          percent: progress.percent,
        });
      });

      // `still_running` is a progress signal, not a verdict: the shared watcher
      // hands the page back every 90s so it can decide whether to keep going.
      // Nothing is charged for waiting, so it does.
      if (outcome.status === 'still_running') continue;
      if (outcome.status === 'cancelled') return;

      const current = useAiJobStore.getState().jobs.find((j) => j.id === clientId);
      if (!current) return;

      const record = outcome.record;
      const snapshot = {
        stage: outcome.status === 'done' ? 'done' : record?.stage,
        percent: record?.percent,
        resultRef: record?.resultRef,
        error: outcome.status === 'failed' ? outcome.error.message : record?.error?.message,
      };

      // The generation landed but this page never filed it. Finish the save
      // before settling, so the job reports the deck it actually produced.
      if (snapshot.stage === 'done' && hasUnsavedGeneration(current)) {
        try {
          await retrySaveJob(clientId);
          return;
        } catch {
          // retrySaveJob already recorded the honest failure and kept the
          // material, so "Try again" still finishes the save.
          return;
        }
      }

      const patch = planServerSettle(current, snapshot);
      if (patch) settle(current, patch);
      return;
    }
  } catch {
    // An unreachable server proves nothing about the job. Leave it as it is —
    // the next load will ask again — rather than inventing a failure.
  } finally {
    watching.delete(clientId);
  }
}

/**
 * Reattach to everything this student left running, and finish anything that
 * generated but never saved.
 *
 * Called once by the progress panel, which App mounts for the whole session.
 * Safe to call repeatedly: jobs already being watched are skipped.
 */
export function resumeAiJobs(): void {
  const state = useAiJobStore.getState();
  for (const job of state.jobs) {
    if (job.status === 'running' && job.serverJobId) {
      ensureAiJobTicker();
      void resumeOne(job.id);
      continue;
    }
    // A reload found generated material that never reached the library. It is
    // already reported honestly (`planResume` marks it failed with copy that
    // says so); finishing it needs a network the page may not have, so it is
    // left to the student's "Try again" rather than retried silently here.
  }
}
