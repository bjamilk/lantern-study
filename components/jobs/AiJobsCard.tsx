/**
 * Dashboard "AI in progress" card.
 *
 * A student who kicked off a generation and then went home to the dashboard
 * should still be able to see it running — before this, the dashboard was the
 * one place that looked like nothing had happened. Renders nothing when there
 * is no in-flight work, so it never becomes dashboard furniture.
 */

import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { useActiveAiJobs } from '../../hooks/useAiJobs';

const AI_INK = 'rgb(var(--color-feature-ai-ink))';
const AI_TINT = 'rgb(var(--color-feature-ai-tint))';

export const AiJobsCard: React.FC = () => {
  const views = useActiveAiJobs();
  if (views.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-lantern-border bg-lantern-surface p-4"
      aria-label="AI work in progress"
    >
      <div className="flex items-center gap-2 mb-3">
        <AppIcon name="sparkles" size={16} className="animate-pulse" style={{ color: AI_INK }} aria-hidden />
        <h3 className="text-heading text-lantern-text">
          AI is working on {views.length} {views.length === 1 ? 'thing' : 'things'}
        </h3>
      </div>

      <ul className="space-y-3">
        {views.map(({ job, percent, stageLabel, elapsedLabel }) => (
          <li key={job.id}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-body text-lantern-text truncate">{job.title}</p>
              <p className="text-caption text-lantern-text-secondary shrink-0">{elapsedLabel}</p>
            </div>
            <div
              className="mt-1.5 h-1.5 rounded-full overflow-hidden"
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
            <p className="mt-1 text-caption text-lantern-text-secondary">{stageLabel}</p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-caption text-lantern-text-secondary">
        You can keep studying and move around the app — these keep running. Leave this tab open
        so the results can be saved.
      </p>
    </section>
  );
};

export default AiJobsCard;
