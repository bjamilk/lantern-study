import React, { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  JOB_APPLICANT_SORT_LABELS,
  JOB_APPLICATION_STATUS_LABELS,
  filterJobApplicants,
  sortJobApplicants,
  summarizeJobApplicants,
  type JobApplicantSort,
  type JobApplication,
  type JobApplicationStatus,
  type JobPosting,
} from "@lantern/shared";
import {
  fetchJobApplicants,
  fetchJobApplicationResumeUrl,
  fetchJobPosting,
  updateJobApplicationStatus,
} from "../services/jobsBoard";
import { useAuthStore } from "../stores/authStore";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";
import { JobApplicantDetailModal } from "./jobs/JobApplicantDetailModal";

const COLUMNS: JobApplicationStatus[] = [
  "interested",
  "new",
  "chatting",
  "reviewing",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
];
const EMPLOYER_STATUSES = COLUMNS.filter((status) => status !== "withdrawn");
const SORTS: JobApplicantSort[] = ["newest", "oldest", "name"];

export default function JobEmployerPipelineScreen({
  jobId,
  onNavigate,
  onOpenDm,
}: {
  jobId: string;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [posting, setPosting] = useState<JobPosting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingResumeId, setOpeningResumeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<JobApplicantSort>("newest");
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(
    null,
  );

  // Resumes live in a private bucket, so each view needs a fresh signed link.
  const openResume = async (applicationId: string) => {
    setOpeningResumeId(applicationId);
    setError(null);
    try {
      const response = await fetchJobApplicationResumeUrl(applicationId);
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : "Could not open the resume",
      );
    } finally {
      setOpeningResumeId(null);
    }
  };

  const load = () =>
    fetchJobApplicants(jobId)
      .then((res) => setApps(res.data || []))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load applicants"),
      );

  useEffect(() => {
    void load();
    // Screening prompts live on the posting, so answers can be labelled.
    fetchJobPosting(jobId)
      .then((res) => setPosting(res.data || null))
      .catch(() => setPosting(null));
  }, [jobId]);

  const changeStatus = async (
    applicationId: string,
    status: JobApplicationStatus,
  ) => {
    const previous = apps;
    setApps((current) =>
      current.map((app) =>
        app.id === applicationId ? { ...app, status } : app,
      ),
    );
    try {
      await updateJobApplicationStatus(applicationId, { status });
      await load();
    } catch (e) {
      setApps(previous);
      setError(e instanceof Error ? e.message : "Could not update the stage");
    }
  };

  const applyNotesCount = (applicationId: string, count: number) =>
    setApps((current) =>
      current.map((app) =>
        app.id === applicationId ? { ...app, notesCount: count } : app,
      ),
    );

  const visible = useMemo(
    () => sortJobApplicants(filterJobApplicants(apps, search), sort),
    [apps, search, sort],
  );

  const byStatus = useMemo(() => {
    const map: Record<string, JobApplication[]> = {};
    for (const col of COLUMNS) map[col] = [];
    for (const app of visible) {
      const key = COLUMNS.includes(app.status as JobApplicationStatus)
        ? app.status
        : "new";
      map[key] = map[key] || [];
      map[key].push(app);
    }
    return map;
  }, [visible]);

  const summary = useMemo(() => summarizeJobApplicants(apps), [apps]);
  const openApplication =
    apps.find((app) => app.id === openApplicationId) || null;
  const filtering = !!search.trim();

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-6xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
        <JobsWorkspaceNav active="employer" onNavigate={onNavigate} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-lantern-primary">
              Hiring workflow
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-lantern-text">
              Applicant pipeline
            </h1>
            <p className="mt-1 text-sm text-lantern-text-secondary">
              {summary.total} {summary.total === 1 ? "candidate" : "candidates"}{" "}
              across all stages
              {summary.needsReview > 0
                ? ` · ${summary.needsReview} awaiting review`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text"
            onClick={() => onNavigate("MarketplaceJobDetail", { jobId })}
          >
            View job
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-lantern-text-tertiary"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search candidates"
              aria-label="Search candidates by name"
              className="w-full rounded-lg border border-lantern-border bg-lantern-surface py-2 pl-9 pr-3 text-sm text-lantern-text placeholder:text-lantern-text-tertiary focus:border-lantern-primary focus:outline-none"
            />
          </div>
          <label htmlFor="applicant-sort" className="sr-only">
            Sort candidates
          </label>
          <select
            id="applicant-sort"
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as JobApplicantSort)
            }
            className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
          >
            {SORTS.map((option) => (
              <option key={option} value={option}>
                {JOB_APPLICANT_SORT_LABELS[option]}
              </option>
            ))}
          </select>
          {filtering ? (
            <p className="text-xs text-lantern-text-tertiary" role="status">
              {visible.length} of {summary.total} shown
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {filtering && visible.length === 0 ? (
          <p className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-6 text-center text-sm text-lantern-text-secondary">
            No candidates match “{search.trim()}”.
          </p>
        ) : null}

        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3 min-w-max">
            {COLUMNS.map((col) => (
              <div
                key={col}
                className="w-64 shrink-0 rounded-lantern-xl border border-lantern-border bg-lantern-background-secondary/40 p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-secondary">
                    {JOB_APPLICATION_STATUS_LABELS[col]}
                  </h2>
                  <span className="rounded-full bg-lantern-surface px-2 py-0.5 text-xs font-semibold text-lantern-text-tertiary">
                    {byStatus[col]?.length || 0}
                  </span>
                </div>
                <ul className="space-y-2">
                  {(byStatus[col] || []).map((app) => (
                    <li key={app.id}>
                      <button
                        type="button"
                        onClick={() => setOpenApplicationId(app.id)}
                        className="w-full space-y-1 rounded-lg border border-lantern-border bg-lantern-surface p-3 text-left shadow-sm transition hover:border-lantern-primary/40"
                      >
                        <p className="truncate text-sm font-medium text-lantern-text">
                          {app.applicant?.name ||
                            app.applicant?.username ||
                            "Applicant"}
                        </p>
                        <p className="text-[11px] text-lantern-text-tertiary">
                          Applied{" "}
                          {new Date(app.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {app.resumePath || app.resumeUrl ? (
                            <span className="rounded bg-lantern-background px-1.5 py-0.5 text-[10px] font-medium text-lantern-text-secondary">
                              Resume
                            </span>
                          ) : null}
                          {app.notesCount ? (
                            <span className="rounded bg-lantern-background px-1.5 py-0.5 text-[10px] font-medium text-lantern-text-secondary">
                              {app.notesCount}{" "}
                              {app.notesCount === 1 ? "note" : "notes"}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {openApplication ? (
        <JobApplicantDetailModal
          application={openApplication}
          posting={posting}
          currentUserId={currentUser?.id}
          statuses={EMPLOYER_STATUSES}
          openingResume={openingResumeId === openApplication.id}
          onClose={() => setOpenApplicationId(null)}
          onChangeStatus={(status) =>
            void changeStatus(openApplication.id, status)
          }
          onOpenResume={() => void openResume(openApplication.id)}
          onOpenDm={
            openApplication.dmThreadId && onOpenDm
              ? () => onOpenDm(openApplication.dmThreadId!)
              : undefined
          }
          onNotesCountChange={applyNotesCount}
        />
      ) : null}
    </div>
  );
}
