import React from "react";
import {
  JOB_FUNNEL_STAGE_LABELS,
  jobFunnelStageEntries,
  type JobHiringFunnel,
} from "@lantern/shared";

interface Props {
  funnel: JobHiringFunnel;
  /** Compact strip for embedding above a pipeline. */
  compact?: boolean;
}

/** Horizontal hiring funnel: views → applied → review → interview → offer → hired. */
export function JobHiringFunnelStrip({ funnel, compact }: Props) {
  const entries = jobFunnelStageEntries(funnel);
  const max = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <div
      className={
        compact
          ? "grid grid-cols-3 gap-1.5 sm:grid-cols-6"
          : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      }
      role="list"
      aria-label="Hiring funnel"
    >
      {entries.map(([stage, value]) => {
        const fill = Math.max(8, Math.round((value / max) * 100));
        return (
          <div
            key={stage}
            role="listitem"
            className="rounded-lg border border-lantern-border bg-lantern-background p-2.5"
          >
            <p className="text-[11px] font-medium text-lantern-text-secondary">
              {JOB_FUNNEL_STAGE_LABELS[stage]}
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-lantern-text">
              {value}
            </p>
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-lantern-border"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-lantern-primary/80"
                style={{ width: `${fill}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default JobHiringFunnelStrip;
