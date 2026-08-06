/**
 * The canonical browse-filter set for the jobs board, plus the rules for
 * saving one and deciding whether a new posting matches it. Shared so the
 * board UI, the list API, and the alert job all agree on what a search means.
 */
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  isJobEmploymentType,
  type JobEmploymentType,
} from "./employmentTypes";
import type { JobCompensationKind, JobPosting } from "./types";

export type JobSearchSort = "newest" | "closing" | "trending";

export interface JobSearchFilters {
  search?: string;
  employmentType?: JobEmploymentType;
  campusId?: string;
  companyOnly?: boolean;
  /** `true` for remote-only, `false` for on-site only, absent for either. */
  remote?: boolean;
  compensationKind?: JobCompensationKind;
  sort?: JobSearchSort;
}

export interface JobSavedSearch {
  id: string;
  name: string;
  filters: JobSearchFilters;
  /** Whether new matches should notify the owner. */
  notify: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const JOB_SAVED_SEARCH_NAME_MAX_LENGTH = 80;

/** Keeps one account from turning the alert job into an unbounded fan-out. */
export const JOB_SAVED_SEARCH_LIMIT_PER_USER = 20;

/** Matches per search per alert run, so one busy day cannot flood the bell. */
export const JOB_SAVED_SEARCH_MAX_MATCHES_PER_RUN = 5;

const SEARCH_MAX_LENGTH = 120;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function isCompensationKind(value: unknown): value is JobCompensationKind {
  return value === "paid" || value === "unpaid" || value === "discuss";
}

/**
 * Drops unknown keys and invalid values instead of rejecting the whole filter
 * set: a saved search that loses one stale field is more useful to its owner
 * than an error, and the API must never persist arbitrary client JSON.
 */
export function normalizeJobSearchFilters(input: unknown): JobSearchFilters {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const filters: JobSearchFilters = {};

  const search = cleanText(raw.search, SEARCH_MAX_LENGTH);
  if (search) filters.search = search;

  if (isJobEmploymentType(raw.employmentType)) {
    filters.employmentType = raw.employmentType;
  }

  const campusId = cleanText(raw.campusId, 64);
  if (campusId) filters.campusId = campusId;

  if (raw.companyOnly === true) filters.companyOnly = true;
  if (typeof raw.remote === "boolean") filters.remote = raw.remote;
  if (isCompensationKind(raw.compensationKind)) {
    filters.compensationKind = raw.compensationKind;
  }
  if (raw.sort === "closing" || raw.sort === "newest" || raw.sort === "trending") {
    filters.sort = raw.sort;
  }

  return filters;
}

export function isEmptyJobSearchFilters(filters: JobSearchFilters): boolean {
  return (
    !filters.search &&
    !filters.employmentType &&
    !filters.campusId &&
    !filters.companyOnly &&
    filters.remote === undefined &&
    !filters.compensationKind
  );
}

const COMPENSATION_LABELS: Record<JobCompensationKind, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  discuss: "Pay negotiable",
};

/** Human summary of a filter set, e.g. `"tutor" · Remote · Part-time`. */
export function describeJobSearchFilters(filters: JobSearchFilters): string {
  const parts: string[] = [];
  if (filters.search) parts.push(`"${filters.search}"`);
  if (filters.employmentType) {
    parts.push(JOB_EMPLOYMENT_TYPE_LABELS[filters.employmentType]);
  }
  if (filters.remote === true) parts.push("Remote");
  if (filters.remote === false) parts.push("On-site");
  if (filters.compensationKind) {
    parts.push(COMPENSATION_LABELS[filters.compensationKind]);
  }
  if (filters.companyOnly) parts.push("Companies only");
  return parts.length ? parts.join(" · ") : "All jobs";
}

/** Default name offered when saving, derived from the filters themselves. */
export function suggestJobSavedSearchName(filters: JobSearchFilters): string {
  return describeJobSearchFilters(filters).slice(
    0,
    JOB_SAVED_SEARCH_NAME_MAX_LENGTH,
  );
}

type MatchablePosting = Pick<
  JobPosting,
  "title" | "description" | "employmentType" | "isRemote"
> & {
  campusId?: string | null;
  companyId?: string | null;
  compensation?: JobPosting["compensation"] | null;
};

/**
 * Whether a posting satisfies a saved search. The alert job re-checks matches
 * here rather than rebuilding the list query, so a filter added to the board
 * cannot silently stop narrowing alerts.
 */
export function jobPostingMatchesSearch(
  posting: MatchablePosting,
  filters: JobSearchFilters,
): boolean {
  if (
    filters.employmentType &&
    posting.employmentType !== filters.employmentType
  ) {
    return false;
  }
  if (filters.campusId && posting.campusId !== filters.campusId) return false;
  if (filters.companyOnly && !posting.companyId) return false;
  if (filters.remote !== undefined && !!posting.isRemote !== filters.remote) {
    return false;
  }
  if (
    filters.compensationKind &&
    posting.compensation?.kind !== filters.compensationKind
  ) {
    return false;
  }
  if (filters.search) {
    // Substring rather than the API's full-text search: the alert job compares
    // a handful of fresh rows, and a missed alert is worse than a loose one.
    const term = filters.search.toLowerCase();
    const haystack =
      `${posting.title || ""} ${posting.description || ""}`.toLowerCase();
    if (!haystack.includes(term)) return false;
  }
  return true;
}
