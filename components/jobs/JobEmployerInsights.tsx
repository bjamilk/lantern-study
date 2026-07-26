import React, { useEffect, useState } from "react";
import {
  describeJobConversion,
  type JobEmployerAnalytics,
} from "@lantern/shared";
import { fetchJobEmployerAnalytics } from "../../services/jobsBoard";
import { JobHiringFunnelStrip } from "./JobHiringFunnelStrip";

interface Props {
  onOpenPosting?: (postingId: string) => void;
}

/**
 * Poster-wide hiring performance. Kept on the manage-posts screen so inventory
 * stays primary and analytics is one scroll away, not a separate destination.
 */
export function JobEmployerInsights({ onOpenPosting }: Props) {
  const [analytics, setAnalytics] = useState<JobEmployerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobEmployerAnalytics()
      .then((res) => {
        if (active) setAnalytics(res.data);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load hiring analytics",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section
        aria-label="Hiring analytics"
        className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
      >
        <p className="text-sm text-lantern-text-tertiary">
          Loading hiring analytics…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-label="Hiring analytics"
        className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
      >
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      </section>
    );
  }

  if (!analytics || analytics.totals.postings === 0) {
    return null;
  }

  const {
    totals,
    funnel,
    conversion,
    avgTimeToFillDays,
    topPostings,
    attention,
  } = analytics;

  return (
    <section
      aria-label="Hiring analytics"
      className="space-y-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-lantern-text">
            Hiring performance
          </h2>
          <p className="mt-0.5 text-xs text-lantern-text-secondary">
            Views through to hires across your posts.
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
          <span>
            Offer→hire{" "}
            <strong className="text-lantern-text">
              {describeJobConversion(conversion.offerToHirePercent)}
            </strong>
          </span>
          {avgTimeToFillDays != null ? (
            <span>
              Avg time to fill{" "}
              <strong className="text-lantern-text">
                {avgTimeToFillDays}d
              </strong>
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Active posts" value={totals.activePostings} />
        <Metric label="Total views" value={totals.views} />
        <Metric label="Applicants" value={totals.applications} />
        <Metric label="Hired" value={totals.hired} accent />
      </div>

      <JobHiringFunnelStrip funnel={funnel} />

      {topPostings.length ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Top posts
          </h3>
          <ul className="mt-2 divide-y divide-lantern-border rounded-lg border border-lantern-border">
            {topPostings.slice(0, 5).map((posting) => (
              <li key={posting.id}>
                <button
                  type="button"
                  onClick={() => onOpenPosting?.(posting.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-lantern-background"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-lantern-text">
                    {posting.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-lantern-text-secondary">
                    {posting.views} views · {posting.applications} apps ·{" "}
                    {posting.hired} hired
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {attention.highViewsLowApply.length || attention.staleActive.length ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Needs attention
          </h3>
          {attention.highViewsLowApply.map((item) => (
            <AttentionRow
              key={`views-${item.id}`}
              title={item.title}
              detail={`${item.views} views but only ${item.applications} applicant${item.applications === 1 ? "" : "s"} — refresh the brief or compensation.`}
              onOpen={() => onOpenPosting?.(item.id)}
            />
          ))}
          {attention.staleActive.map((item) => (
            <AttentionRow
              key={`stale-${item.id}`}
              title={item.title}
              detail={`Open ${item.daysOpen} days with ${item.applications} applicant${item.applications === 1 ? "" : "s"}. Consider pausing or rewriting.`}
              onOpen={() => onOpenPosting?.(item.id)}
            />
          ))}
        </div>
      ) : null}

      {funnel.needsReview > 0 ? (
        <p className="text-xs text-amber-700">
          {funnel.needsReview} applicant
          {funnel.needsReview === 1 ? "" : "s"} still awaiting review.
        </p>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-lantern-border bg-lantern-background p-3">
      <p className="text-[11px] font-medium text-lantern-text-secondary">
        {label}
      </p>
      <p
        className={`mt-0.5 text-xl font-bold tabular-nums ${
          accent ? "text-lantern-primary" : "text-lantern-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function AttentionRow({
  title,
  detail,
  onOpen,
}: {
  title: string;
  detail: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left hover:bg-amber-100"
    >
      <p className="text-sm font-medium text-lantern-text">{title}</p>
      <p className="mt-0.5 text-xs text-lantern-text-secondary">{detail}</p>
    </button>
  );
}

export default JobEmployerInsights;
