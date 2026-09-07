import { getApiBaseUrl } from '@lantern/shared';
import { createJobClient, JobStillRunningError } from '@lantern/shared/jobs/jobClient';
import { JOB_STALE_TIMEOUT_MS } from '@lantern/shared/jobs/jobState';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

/**
 * One watcher for every 202 the web client receives.
 *
 * Built on the shared JobClient rather than a blind status loop, so the
 * polling backs off (1s → 2s → 4s → 5s) and a server-reported failure comes
 * back with its real message. The shared watcher yields `still_running` every
 * 90s; that is a progress signal, not a verdict, so this keeps watching until
 * the job is actually terminal. The server stamps a job `timed_out` (and
 * refunds it) once it has sat idle for JOB_STALE_TIMEOUT_MS, so the loop ends
 * with a truthful outcome in every case except an unreachable server — and
 * then it throws JobStillRunningError, never "timed out": the work may well
 * still be running and the student has already been charged for it once.
 */
const jobs = createJobClient({
  getBaseUrl: () => API_BASE_URL,
  getAuthHeaders,
});

export { JobStillRunningError, isJobStillRunningError } from '@lantern/shared/jobs/jobClient';

export async function pollApiJob<T>(
  jobId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<T> {
  const deadline = Date.now() + (options?.timeoutMs ?? JOB_STALE_TIMEOUT_MS);

  for (;;) {
    const outcome = await jobs.watchJob<T>(jobId);
    if (outcome.status === 'done') {
      if (outcome.result === undefined) throw new Error('AI job completed without a result.');
      return outcome.result;
    }
    if (outcome.status === 'failed') {
      throw new Error(outcome.error.message || 'AI job failed.');
    }
    // still_running / cancelled: the job is not over. Keep watching until the
    // caller's own deadline, then hand back the jobId rather than a lie.
    if (outcome.status === 'cancelled' || Date.now() >= deadline) {
      throw new JobStillRunningError(jobId);
    }
  }
}
