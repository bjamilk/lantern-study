/**
 * Watching a queued job to its real end (mobile).
 *
 * The shared JobClient's `watchJob` yields `still_running` after its 90 s
 * budget. That is the right signal for a UI that wants to stop promising and
 * offer a way out — and the sheet's own clock does exactly that — but it is
 * not the right answer for the runner that has to SAVE the result: for it,
 * `still_running` means "keep watching". So every 202 the mobile app receives
 * is watched here until the job is terminal. The server stamps an idle job
 * `timed_out` (and refunds it once) after JOB_STALE_TIMEOUT_MS, so the loop
 * always ends in a truthful outcome unless the server cannot be reached at
 * all — and then it throws JobStillRunningError rather than claiming the
 * work failed, because the student has already been charged once and the job
 * may well land.
 */
import {
  createJobClient,
  isJobStillRunningError,
  JobStillRunningError,
} from '@lantern/shared/jobs/jobClient';
import { JOB_STALE_TIMEOUT_MS } from '@lantern/shared/jobs/jobState';
import { API_BASE_URL, getAuthHeaders } from './supabase';

export { JobStillRunningError, isJobStillRunningError } from '@lantern/shared/jobs/jobClient';

const jobs = createJobClient({
  getBaseUrl: () => API_BASE_URL,
  getAuthHeaders,
});

/** Watch `jobId` until it is done or failed; backoff-polled, never blind. */
export async function awaitJobResult<T>(
  jobId: string,
  deadlineMs: number = JOB_STALE_TIMEOUT_MS
): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const outcome = await jobs.watchJob<T>(jobId);
    if (outcome.status === 'done') {
      if (outcome.result === undefined) throw new Error('AI job completed without a result.');
      return outcome.result;
    }
    if (outcome.status === 'failed') {
      throw new Error(outcome.error.message || 'AI job failed.');
    }
    if (outcome.status === 'cancelled' || Date.now() >= deadline) {
      throw new JobStillRunningError(jobId);
    }
  }
}

/**
 * Run a shared-client call whose 202 path throws JobStillRunningError at the
 * 90 s budget, and carry it through to the real result instead.
 */
export async function settleJob<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isJobStillRunningError(err) || !err.jobId) throw err;
    return awaitJobResult<T>(err.jobId);
  }
}
