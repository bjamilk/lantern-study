import React, { useCallback, useEffect, useState } from "react";
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_POSTING_STATUS_LABELS,
  formatJobCompensation,
  formatJobLocation,
  formatJobPostedDate,
  type JobPosting,
} from "@lantern/shared";
import { fetchMyJobPostings, updateJobPosting } from "../services/jobsBoard";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";

const STATUS_STYLES: Record<JobPosting["status"], string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  closed: "bg-slate-100 text-slate-700",
  pending_school_approval: "bg-amber-100 text-amber-800",
  suspended_by_admin: "bg-red-100 text-red-800",
  removed_by_admin: "bg-red-100 text-red-800",
};

export default function MyJobPostingsScreen({
  onNavigate,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyJobPostings();
      setJobs(response.data || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load job posts",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeJob = async (jobId: string) => {
    setClosingId(jobId);
    setError(null);
    try {
      await updateJobPosting(jobId, { status: "closed" });
      await load();
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "Could not close job",
      );
    } finally {
      setClosingId(null);
    }
  };

  const activeCount = jobs.filter((job) => job.status === "active").length;
  const totalViews = jobs.reduce((sum, job) => sum + (job.viewsCount || 0), 0);
  const totalApplicants = jobs.reduce(
    (sum, job) => sum + (job.applicationsCount || 0),
    0,
  );
  const totalNeedsReview = jobs.reduce(
    (sum, job) => sum + (job.newApplicationsCount || 0),
    0,
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-5xl mx-auto px-4 py-4 pb-20 md:pb-8 space-y-5">
        <JobsWorkspaceNav
          active="my_jobs"
          onNavigate={onNavigate}
          onPostJob={() => onNavigate("CreateMarketplaceJob")}
        />

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-lantern-primary">
              Poster workspace
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-lantern-text">
              Manage job posts
            </h1>
            <p className="mt-1 text-sm text-lantern-text-secondary">
              Review performance and move applicants through your hiring
              pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("CreateMarketplaceJob")}
            className="rounded-lg bg-lantern-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            Post a new job
          </button>
        </header>

        <section
          aria-label="Job post summary"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Total posts
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {jobs.length}
            </p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Active
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {activeCount}
            </p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Total views
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {totalViews}
            </p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Applicants
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {totalApplicants}
            </p>
            {totalNeedsReview > 0 ? (
              <p className="mt-1 text-xs font-medium text-lantern-primary">
                {totalNeedsReview} awaiting review
              </p>
            ) : null}
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-3" aria-label="Loading job posts">
            {[0, 1].map((item) => (
              <div
                key={item}
                className="h-40 animate-pulse rounded-lantern-xl border border-lantern-border bg-lantern-surface"
              />
            ))}
          </div>
        ) : jobs.length ? (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="text-left text-base font-semibold text-lantern-text hover:text-lantern-primary"
                        onClick={() =>
                          onNavigate("MarketplaceJobDetail", { jobId: job.id })
                        }
                      >
                        {job.title}
                      </button>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[job.status]}`}
                      >
                        {JOB_POSTING_STATUS_LABELS[job.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-lantern-text-secondary">
                      {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} ·{" "}
                      {formatJobLocation(job)}
                    </p>
                    <p className="mt-3 text-sm font-medium text-lantern-text">
                      {formatJobCompensation(job.compensation)}
                    </p>
                    <p className="mt-2 text-xs text-lantern-text-tertiary">
                      {formatJobPostedDate(job.createdAt)} ·{" "}
                      {job.viewsCount || 0} views · {job.applicationsCount || 0}{" "}
                      {job.applicationsCount === 1 ? "applicant" : "applicants"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg bg-lantern-primary px-3 py-2 text-sm font-semibold text-white"
                      onClick={() =>
                        onNavigate("JobEmployerPipeline", { jobId: job.id })
                      }
                    >
                      Review applicants
                      {job.newApplicationsCount ? (
                        <span
                          className="rounded-full bg-white/25 px-1.5 py-0.5 text-xs font-bold"
                          aria-label={`${job.newApplicationsCount} awaiting review`}
                        >
                          {job.newApplicationsCount}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text"
                      onClick={() =>
                        onNavigate("MarketplaceJobDetail", { jobId: job.id })
                      }
                    >
                      View post
                    </button>
                    {job.status === "active" ? (
                      <button
                        type="button"
                        disabled={closingId === job.id}
                        className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text-secondary disabled:opacity-50"
                        onClick={() => void closeJob(job.id)}
                      >
                        {closingId === job.id ? "Closing…" : "Close post"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lantern-xl border border-dashed border-lantern-border bg-lantern-surface/70 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-lantern-text">
              Post your first opportunity
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-lantern-text-secondary">
              Reach candidates for full-time, part-time, internship, contract,
              and local work.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("CreateMarketplaceJob")}
              className="mt-5 rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Create job post
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
