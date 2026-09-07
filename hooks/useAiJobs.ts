/**
 * Read-side bridge between the module-level AI job store and React.
 *
 * Components only ever read through this hook. Nothing here starts, cancels or
 * owns a job — that is the runner's business — which is exactly why unmounting
 * a screen mid-generation cannot lose a student's work.
 */

import { useMemo } from 'react';
import {
  useAiJobStore,
  computeJobElapsedMs,
  computeJobPercent,
  countInFlight,
  formatElapsed,
  getActiveJobs,
  getCurrentStageLabel,
  getVisibleJobs,
  isJobOverBudget,
  type AiJob,
} from '../stores/aiJobStore';
import { useAuthStore } from '../stores/authStore';

export interface AiJobView {
  job: AiJob;
  percent: number;
  elapsedLabel: string;
  stageLabel: string;
  overBudget: boolean;
}

function toView(job: AiJob, now: number): AiJobView {
  return {
    job,
    percent: computeJobPercent(job, now),
    elapsedLabel: formatElapsed(computeJobElapsedMs(job, now)),
    stageLabel: getCurrentStageLabel(job),
    overBudget: isJobOverBudget(job, now),
  };
}

/** Running + recently finished jobs for the signed-in student. */
export function useVisibleAiJobs(): AiJobView[] {
  const jobs = useAiJobStore((s) => s.jobs);
  const tick = useAiJobStore((s) => s.tick);
  const userId = useAuthStore((s) => s.currentUser?.id);

  return useMemo(() => {
    const now = Date.now();
    return getVisibleJobs(jobs, userId, now).map((job) => toView(job, now));
    // `tick` is the clock: it is what makes elapsed/percent advance.
  }, [jobs, userId, tick]);
}

/** Just the in-flight ones — what the dashboard card counts. */
export function useActiveAiJobs(): AiJobView[] {
  const jobs = useAiJobStore((s) => s.jobs);
  const tick = useAiJobStore((s) => s.tick);
  const userId = useAuthStore((s) => s.currentUser?.id);

  return useMemo(() => {
    const now = Date.now();
    return getActiveJobs(jobs, userId).map((job) => toView(job, now));
  }, [jobs, userId, tick]);
}

export function useAiJobCount(): number {
  const jobs = useAiJobStore((s) => s.jobs);
  const userId = useAuthStore((s) => s.currentUser?.id);
  return useMemo(() => countInFlight(jobs, userId), [jobs, userId]);
}

/** The id the runner needs to attribute a job to its owner. */
export function useAiJobUserId(): string | undefined {
  return useAuthStore((s) => s.currentUser?.id);
}
