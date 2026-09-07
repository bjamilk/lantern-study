/**
 * Non-blocking AI progress panel.
 *
 * Docked bottom-right, above nothing modal: the student can keep reading,
 * navigate, or start something else while generation runs. It is mounted once
 * by App, so it survives every route change.
 *
 * Past the 90s budget it stops pretending and asks: Keep waiting, or Retry.
 * Retry is labelled with its credit cost because it really does issue a second,
 * separately-charged request; "Keep waiting" costs nothing because the original
 * request is still running.
 */

import React, { useEffect } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useVisibleAiJobs, type AiJobView } from '../../hooks/useAiJobs';
import { useAiJobStore } from '../../stores/aiJobStore';
import {
  canRetryAiJob,
  isSaveRetry,
  navigateToAiJobTarget,
  retryAiJob,
  startAiJobNotificationRouting,
} from '../../stores/aiJobRunner';
import { resumeAiJobs } from '../../stores/aiJobResume';

/**
 * The Wave-T feature accent for AI. These live only as CSS custom properties
 * (index.css) — they are not in tailwind.config's colour map, and a
 * `text-feature-ai-ink` class would compile to nothing at all — so they are
 * applied as inline styles. Both flip automatically under `.dark`.
 */
const AI_INK = 'rgb(var(--color-feature-ai-ink))';
const AI_TINT = 'rgb(var(--color-feature-ai-tint))';

const AiJobRow: React.FC<{ view: AiJobView }> = ({ view }) => {
  const { job, percent, elapsedLabel, stageLabel, overBudget } = view;
  const dismissJob = useAiJobStore((s) => s.dismissJob);
  const keepWaiting = useAiJobStore((s) => s.keepWaiting);

  const running = job.status === 'running';
  const succeeded = job.status === 'succeeded';
  const orphaned = job.status === 'orphaned';
  const retryable = !running && canRetryAiJob(job.id);
  // A held save costs nothing to finish — the generation is already paid for —
  // so the button must not warn about credits it is not going to spend.
  const savingRetry = retryable && isSaveRetry(job.id);

  return (
    <li className="p-3 border-b border-lantern-border last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {succeeded ? (
            <CheckCircleIcon className="w-4 h-4" style={{ color: AI_INK }} />
          ) : job.status === 'failed' ? (
            <ExclamationTriangleIcon className="w-4 h-4 text-lantern-error" />
          ) : (
            <SparklesIcon
              className={`w-4 h-4 ${running ? 'animate-pulse' : ''}`}
              style={{ color: AI_INK }}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-lantern-text truncate">{job.title}</p>
          <p className="text-caption text-lantern-text-secondary">
            {stageLabel}
            {running && <span> · {elapsedLabel}</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={() => dismissJob(job.id)}
          className="shrink-0 p-1 rounded hover:bg-lantern-background text-lantern-text-secondary"
          aria-label={running ? `Hide progress for ${job.title}` : `Dismiss ${job.title}`}
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {running && (
        <div
          className="mt-2 h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: AI_TINT }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${job.title}: ${stageLabel}`}
        >
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%`, backgroundColor: AI_INK }}
          />
        </div>
      )}

      {/* Past budget: honest choice, no silent spinning. */}
      {running && overBudget && (
        <div className="mt-2">
          <p className="text-caption text-lantern-text-secondary">
            This is taking longer than usual. Your request is still running — nothing has been
            lost, and waiting costs no extra credits.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => keepWaiting(job.id)}
              className="px-2.5 py-1 rounded-lg text-caption font-medium text-white"
              style={{ backgroundColor: AI_INK }}
            >
              Keep waiting
            </button>
            {/*
              No Retry while the request is still in flight. A second attempt
              cannot cancel the first — the original would land anyway — so the
              student would be charged twice and get two copies of the same
              deck or quiz. Retry appears below once the job has actually
              failed, where there is nothing left to duplicate.
            */}
          </div>
        </div>
      )}

      {orphaned && (
        <p className="mt-1 text-caption text-lantern-text-secondary">
          Started before you reloaded, so this tab lost track of it. Your credits were already
          used — check your library before generating this again.
        </p>
      )}

      {job.status === 'failed' && (
        <div className="mt-1">
          <p className="text-caption text-lantern-error">{job.error}</p>
          {retryable && (
            <button
              type="button"
              onClick={() => retryAiJob(job.id)}
              className="mt-2 px-2.5 py-1 rounded-lg text-caption font-medium border border-lantern-border text-lantern-text"
            >
              <ArrowPathIcon className="w-3.5 h-3.5 inline-block mr-1 align-[-2px]" />
              {savingRetry ? (
                'Save to your library (no extra credits)'
              ) : (
                <>
                  Try again (costs {job.creditCost}{' '}
                  {job.creditCost === 1 ? 'credit' : 'credits'})
                </>
              )}
            </button>
          )}
        </div>
      )}

      {succeeded && job.target && (
        <button
          type="button"
          onClick={() => {
            navigateToAiJobTarget(job.target);
            dismissJob(job.id);
          }}
          className="mt-2 px-2.5 py-1 rounded-lg text-caption font-medium"
          style={{ backgroundColor: AI_TINT, color: AI_INK }}
        >
          {job.target.label}
        </button>
      )}
    </li>
  );
};

export const AiJobProgressPanel: React.FC = () => {
  const views = useVisibleAiJobs();

  // App mounts this once, so this is the app's single subscription to
  // service-worker notification clicks for AI jobs.
  useEffect(() => startAiJobNotificationRouting(), []);

  // …and the one place that reattaches to work the last page left running.
  useEffect(() => {
    resumeAiJobs();
  }, []);

  if (views.length === 0) return null;

  const runningCount = views.filter((v) => v.job.status === 'running').length;

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-lantern-border bg-lantern-surface shadow-lantern-lg"
      role="status"
      aria-live="polite"
    >
      <div className="px-3 py-2 border-b border-lantern-border flex items-center gap-2">
        <SparklesIcon className="w-4 h-4" style={{ color: AI_INK }} aria-hidden />
        <p className="text-label uppercase text-lantern-text-secondary flex-1">
          {runningCount > 0 ? `AI working · ${runningCount}` : 'AI results'}
        </p>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto">
        {views.map((view) => (
          <AiJobRow key={view.job.id} view={view} />
        ))}
      </ul>
    </div>
  );
};

export default AiJobProgressPanel;
