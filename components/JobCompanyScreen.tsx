import React, { useEffect, useMemo, useState } from "react";
import {
  JOB_COMPANY_VERIFICATION_LABELS,
  JOB_EMPLOYMENT_TYPE_LABELS,
  buildJobCompanySeo,
  formatJobCompensation,
  formatJobLocation,
  getJobEmployerTrustPresentation,
  type JobCompany,
  type JobCompanyMemberRole,
  type JobPosting,
} from "@lantern/shared";
import { JobTrustBadge } from "./jobs/JobTrustBadge";
import { fetchJobCompanyProfile } from "../services/jobsBoard";
import { usePageSeo } from "../hooks/usePageSeo";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";

interface Props {
  companyId: string;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  guestMode?: boolean;
}

export default function JobCompanyScreen({
  companyId,
  onNavigate,
  guestMode,
}: Props) {
  const [company, setCompany] = useState<JobCompany | null>(null);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [myRole, setMyRole] = useState<JobCompanyMemberRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void fetchJobCompanyProfile(companyId)
      .then((res) => {
        const data = res.data as {
          company: JobCompany;
          jobs: JobPosting[];
          myRole: JobCompanyMemberRole | null;
        };
        setCompany(data.company);
        setJobs(data.jobs || []);
        setMyRole(data.myRole || null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Company not found"),
      );
  }, [companyId]);

  const pageSeo = useMemo(
    () => (company ? buildJobCompanySeo(company, jobs.length) : null),
    [company, jobs.length],
  );
  usePageSeo(pageSeo);

  // Loading and error keep the loaded screen's shell — same wrapper width and
  // the workspace nav — so the page doesn't reflow once the company arrives.
  if (error || !company) {
    return (
      <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
        <div className="max-w-3xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
          {!guestMode ? (
            <JobsWorkspaceNav active="jobs" onNavigate={onNavigate} />
          ) : null}
          {error ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => onNavigate("MarketplaceJobs")}
                className="text-sm font-semibold text-lantern-primary"
              >
                Back to jobs
              </button>
            </div>
          ) : (
            <p className="text-sm text-lantern-text-tertiary">
              Loading company…
            </p>
          )}
        </div>
      </div>
    );
  }

  const statusLabel =
    JOB_COMPANY_VERIFICATION_LABELS[
      company.verificationStatus as keyof typeof JOB_COMPANY_VERIFICATION_LABELS
    ] || company.verificationStatus;

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-3xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
        {!guestMode ? (
          <JobsWorkspaceNav active="jobs" onNavigate={onNavigate} />
        ) : null}

        <section className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-5 space-y-4">
          <div className="flex items-start gap-4">
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-xl border border-lantern-border bg-white object-contain p-2"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-lantern-primary/10 text-2xl font-bold text-lantern-primary"
              >
                {company.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <JobTrustBadge
                  trust={getJobEmployerTrustPresentation({
                    companyId: company.id,
                    company,
                  })}
                />
                {company.verificationStatus !== "verified" &&
                company.verificationStatus !== "pending" ? (
                  <span className="text-[11px] text-lantern-text-tertiary">
                    {statusLabel}
                  </span>
                ) : null}
                {myRole ? (
                  <span className="text-[11px] text-lantern-text-tertiary">
                    Your role: {myRole}
                  </span>
                ) : null}
              </div>
              {myRole &&
              company.verificationStatus === "rejected" &&
              company.verificationNote ? (
                <p className="mt-2 text-sm text-red-700">
                  Verification note: {company.verificationNote}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-lantern-text">
                  {company.displayName}
                </h1>
                {pageSeo ? (
                  <button
                    type="button"
                    onClick={() => {
                      const url = pageSeo.canonicalUrl;
                      const text = `Jobs at ${company.displayName} on Lantern Study`;
                      if (navigator.share) {
                        void navigator
                          .share({ title: company.displayName, text, url })
                          .catch(() => {});
                      } else {
                        void navigator.clipboard
                          .writeText(`${text}: ${url}`)
                          .then(
                            () => setShareMessage("Link copied."),
                            () => setShareMessage("Could not copy link."),
                          );
                      }
                    }}
                    className="text-xs font-semibold text-lantern-primary hover:underline"
                  >
                    Share
                  </button>
                ) : null}
              </div>
              {shareMessage ? (
                <p className="mt-1 text-xs text-lantern-text-tertiary">
                  {shareMessage}
                </p>
              ) : null}
              {company.tagline ? (
                <p className="mt-1 text-sm text-lantern-text-secondary">
                  {company.tagline}
                </p>
              ) : null}
              <p className="mt-2 text-sm text-lantern-text-tertiary">
                {[company.industry, company.hqLocation]
                  .filter(Boolean)
                  .join(" · ") || "Nigeria"}
                {company.website ? (
                  <>
                    {" · "}
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-lantern-primary hover:underline"
                    >
                      Website
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {company.about ? (
            <div>
              <h2 className="text-sm font-semibold text-lantern-text">About</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-lantern-text-secondary">
                {company.about}
              </p>
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-lantern-text">Open roles</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-lantern-text-tertiary">
              No open roles right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate("MarketplaceJobDetail", { jobId: job.id })
                    }
                    className="w-full text-left rounded-lg border border-lantern-border bg-lantern-surface/95 p-3 hover:border-lantern-primary/40"
                  >
                    <p className="font-medium text-lantern-text">
                      {job.title}
                      {job.hasApplied ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-label font-bold uppercase tracking-wide text-emerald-800">
                          Already applied
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-lantern-text-tertiary">
                      {formatJobLocation(job)} ·{" "}
                      {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} ·{" "}
                      {formatJobCompensation(job.compensation)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
