import React, { useEffect, useState } from "react";
import {
  describeJobConversion,
  type JobPostingAnalytics,
} from "@lantern/shared";
import { fetchJobPostingAnalytics } from "../../services/jobsBoard";
import { JobHiringFunnelStrip } from "./JobHiringFunnelStrip";

interface Props {
  postingId: string;
}

/** Per-posting funnel shown above the applicant pipeline. */
export function JobPostingInsights({ postingId }: Props) {
  const [analytics, setAnalytics] = useState<JobPostingAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAnalytics(null);
    setError(null);
    fetchJobPostingAnalytics(postingId)
      .then((res) => {
        if (active) setAnalytics(res.data);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load posting analytics",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [postingId]);

  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  }

  if (!analytics) {
    return (
      <p className="text-xs text-lantern-text-tertiary">
        Loading posting analytics…
      </p>
    );
  }

  const {
    funnel,
    conversion,
    timeToFillDays,
    medianTimeToHireDays,
    interviews,
    offers,
  } = analytics;

  return (
    <section
      aria-label="Posting analytics"
      className="space-y-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-lantern-text">
            This role’s funnel
          </h2>
          <p className="mt-0.5 text-xs text-lantern-text-secondary">
            {funnel.saved} saved · {funnel.externalClicks} external apply clicks
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-lantern-text-secondary">
          <span>
            View→apply{" "}
            <strong className="text-lantern-text">
              {describeJobConversion(conversion.viewToApplyPercent)}
            </strong>
          </span>
          <span>
            Apply→interview{" "}
            <strong className="text-lantern-text">
              {describeJobConversion(conversion.applyToInterviewPercent)}
            </strong>
          </span>
          {timeToFillDays != null ? (
            <span>
              Time to fill{" "}
              <strong className="text-lantern-text">{timeToFillDays}d</strong>
            </span>
          ) : null}
          {medianTimeToHireDays != null ? (
            <span>
              Median hire{" "}
              <strong className="text-lantern-text">
                {medianTimeToHireDays}d
              </strong>
            </span>
          ) : null}
        </div>
      </div>

      <JobHiringFunnelStrip funnel={funnel} compact />

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat
          label="Interviews confirmed"
          value={interviews.confirmed + interviews.completed}
        />
        <Stat label="Interviews done" value={interviews.completed} />
        <Stat label="Offers out" value={offers.sent} />
        <Stat label="Offers accepted" value={offers.accepted} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-lantern-border bg-lantern-background px-2.5 py-2">
      <p className="text-lantern-text-secondary">{label}</p>
      <p className="mt-0.5 text-base font-bold tabular-nums text-lantern-text">
        {value}
      </p>
    </div>
  );
}

export default JobPostingInsights;
