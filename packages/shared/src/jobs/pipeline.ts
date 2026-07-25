/**
 * Recruiter-side triage rules. Shared so the dashboard badge, the pipeline
 * columns, and the API's counts cannot drift apart on what "needs review" means.
 */
import type { JobApplication, JobApplicationStatus } from "./types";

/**
 * Statuses that represent an untouched candidate. `interested` and `new` are
 * both applicant-initiated; every later status is set by the employer, so
 * reaching one of them is what marks an application as triaged.
 */
export const JOB_UNREVIEWED_APPLICATION_STATUSES: readonly JobApplicationStatus[] =
  ["interested", "new"];

export function isUnreviewedJobApplication(
  status: JobApplicationStatus,
): boolean {
  return JOB_UNREVIEWED_APPLICATION_STATUSES.includes(status);
}

export const JOB_APPLICATION_NOTE_MAX_LENGTH = 2000;

export type JobApplicantSort = "newest" | "oldest" | "name";

export const JOB_APPLICANT_SORT_LABELS: Record<JobApplicantSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name (A–Z)",
};

export function isJobApplicantSort(value: unknown): value is JobApplicantSort {
  return value === "newest" || value === "oldest" || value === "name";
}

type SearchableApplication = Pick<JobApplication, "status" | "createdAt"> & {
  applicant?: JobApplication["applicant"];
};

function applicantLabel(app: SearchableApplication): string {
  return (app.applicant?.name || app.applicant?.username || "").trim();
}

/** Case- and accent-insensitive so "Bío" matches a search for "bio". */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Matches on candidate name or username. An empty query keeps everything. */
export function filterJobApplicants<T extends SearchableApplication>(
  apps: T[],
  query: string,
): T[] {
  const needle = normalize(query);
  if (!needle) return apps;
  return apps.filter((app) => {
    const haystack = normalize(
      [app.applicant?.name, app.applicant?.username].filter(Boolean).join(" "),
    );
    return haystack.includes(needle);
  });
}

export function sortJobApplicants<T extends SearchableApplication>(
  apps: T[],
  sort: JobApplicantSort,
): T[] {
  const sorted = [...apps];
  if (sort === "name") {
    sorted.sort((a, b) => {
      const left = applicantLabel(a);
      const right = applicantLabel(b);
      // Unnamed candidates sort last rather than jumping to the top.
      if (!left !== !right) return left ? -1 : 1;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const left = new Date(a.createdAt).getTime();
    const right = new Date(b.createdAt).getTime();
    return sort === "oldest" ? left - right : right - left;
  });
  return sorted;
}

/** Total and untriaged counts for a set of applications. */
export function summarizeJobApplicants(
  apps: Array<Pick<JobApplication, "status">>,
): { total: number; needsReview: number } {
  let needsReview = 0;
  for (const app of apps) {
    if (isUnreviewedJobApplication(app.status)) needsReview += 1;
  }
  return { total: apps.length, needsReview };
}
