/**
 * Employer hiring analytics. Shared so the API aggregation, the overview
 * dashboard, and the per-posting pipeline cannot disagree on what "applied"
 * or "view-to-apply" means.
 */
import { isUnreviewedJobApplication } from "./pipeline";
import type { JobApplicationStatus, JobPostingStatus } from "./types";

/** Ordered stages shown in the hiring funnel strip. */
export const JOB_FUNNEL_STAGES = [
  "views",
  "applied",
  "reviewing",
  "interview",
  "offer",
  "hired",
] as const;

export type JobFunnelStage = (typeof JOB_FUNNEL_STAGES)[number];

export const JOB_FUNNEL_STAGE_LABELS: Record<JobFunnelStage, string> = {
  views: "Views",
  applied: "Applied",
  reviewing: "In review",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

/**
 * Point-in-time funnel. Application stages use current status (we do not keep
 * a stage history), so a candidate in `offer` counts only under Offer — not
 * also under Interview. Views / saved / external clicks sit above applications.
 */
export interface JobHiringFunnel {
  views: number;
  saved: number;
  externalClicks: number;
  applied: number;
  needsReview: number;
  reviewing: number;
  interview: number;
  offer: number;
  hired: number;
  rejected: number;
  withdrawn: number;
}

export interface JobConversionRates {
  /** Applications per view. Null when there are no views yet. */
  viewToApplyPercent: number | null;
  /** Candidates currently at interview or later, over applications. */
  applyToInterviewPercent: number | null;
  /** Candidates currently at offer or hired, over those at interview+. */
  interviewToOfferPercent: number | null;
  /** Hired over candidates currently at offer or hired. */
  offerToHirePercent: number | null;
}

export interface JobInterviewAnalyticsCounts {
  proposed: number;
  confirmed: number;
  completed: number;
  declined: number;
  cancelled: number;
}

export interface JobOfferAnalyticsCounts {
  sent: number;
  accepted: number;
  declined: number;
  withdrawn: number;
  expired: number;
}

export interface JobPostingAnalytics {
  postingId: string;
  title: string;
  status: JobPostingStatus;
  createdAt: string;
  funnel: JobHiringFunnel;
  conversion: JobConversionRates;
  /** Days from posting create to the earliest hire; null until someone is hired. */
  timeToFillDays: number | null;
  /** Median days from application create to hire among hired candidates. */
  medianTimeToHireDays: number | null;
  interviews: JobInterviewAnalyticsCounts;
  offers: JobOfferAnalyticsCounts;
}

export interface JobEmployerAnalyticsTotals {
  postings: number;
  activePostings: number;
  views: number;
  applications: number;
  needsReview: number;
  hired: number;
  openOffers: number;
}

export interface JobEmployerTopPosting {
  id: string;
  title: string;
  status: JobPostingStatus;
  views: number;
  applications: number;
  hired: number;
  viewToApplyPercent: number | null;
}

export interface JobEmployerAttentionItem {
  id: string;
  title: string;
  views: number;
  applications: number;
  daysOpen: number;
}

export interface JobEmployerAnalytics {
  totals: JobEmployerAnalyticsTotals;
  funnel: JobHiringFunnel;
  conversion: JobConversionRates;
  avgTimeToFillDays: number | null;
  topPostings: JobEmployerTopPosting[];
  attention: {
    /** Active posts with enough views but almost no applications. */
    highViewsLowApply: JobEmployerAttentionItem[];
    /** Active posts open a while with little recent traction. */
    staleActive: JobEmployerAttentionItem[];
  };
  generatedAt: string;
}

export type JobApplicationStatusCounts = Record<JobApplicationStatus, number>;

export function emptyJobApplicationStatusCounts(): JobApplicationStatusCounts {
  return {
    interested: 0,
    chatting: 0,
    new: 0,
    reviewing: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

export function countJobApplicationStatuses(
  statuses: readonly JobApplicationStatus[],
): JobApplicationStatusCounts {
  const counts = emptyJobApplicationStatusCounts();
  for (const status of statuses) {
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

/**
 * Builds the funnel from raw counters. `reviewing` folds in `chatting` because
 * both mean the employer has engaged the candidate past the inbox.
 */
export function buildJobHiringFunnel(input: {
  views?: number;
  saved?: number;
  externalClicks?: number;
  statusCounts: JobApplicationStatusCounts;
}): JobHiringFunnel {
  const c = input.statusCounts;
  const applied =
    c.interested +
    c.chatting +
    c.new +
    c.reviewing +
    c.interview +
    c.offer +
    c.hired +
    c.rejected +
    c.withdrawn;
  const needsReview = c.interested + c.new;
  return {
    views: Math.max(0, input.views || 0),
    saved: Math.max(0, input.saved || 0),
    externalClicks: Math.max(0, input.externalClicks || 0),
    applied,
    needsReview,
    reviewing: c.reviewing + c.chatting,
    interview: c.interview,
    offer: c.offer,
    hired: c.hired,
    rejected: c.rejected,
    withdrawn: c.withdrawn,
  };
}

/** Whole-number percent, or null when the denominator is zero. */
export function jobPercent(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

export function jobConversionRates(
  funnel: JobHiringFunnel,
): JobConversionRates {
  const interviewPlus = funnel.interview + funnel.offer + funnel.hired;
  const offerPlus = funnel.offer + funnel.hired;
  return {
    viewToApplyPercent: jobPercent(funnel.applied, funnel.views),
    applyToInterviewPercent: jobPercent(interviewPlus, funnel.applied),
    interviewToOfferPercent: jobPercent(offerPlus, interviewPlus),
    offerToHirePercent: jobPercent(funnel.hired, offerPlus),
  };
}

export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function medianNumber(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function averageNumber(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / values.length);
}

/**
 * Active posting with views but almost no applications — usually means the
 * listing copy or compensation is scaring people off after they click.
 */
export function isHighViewsLowApply(input: {
  status: JobPostingStatus;
  views: number;
  applications: number;
}): boolean {
  if (input.status !== "active") return false;
  if (input.views < 20) return false;
  return input.applications <= Math.max(1, Math.floor(input.views * 0.05));
}

/**
 * Active posting open at least two weeks with thin traction. A nudge to
 * refresh the brief or pause it rather than leave it rotting in search.
 */
export function isStaleActivePosting(input: {
  status: JobPostingStatus;
  createdAt: string;
  applications: number;
  now?: Date;
}): boolean {
  if (input.status !== "active") return false;
  const openDays = daysBetween(
    input.createdAt,
    (input.now || new Date()).toISOString(),
  );
  if (openDays == null || openDays < 14) return false;
  return input.applications < 3;
}

export function describeJobConversion(percent: number | null): string {
  if (percent == null) return "—";
  return `${percent}%`;
}

/** Funnel stages as [label, value] pairs for UI strips. */
export function jobFunnelStageEntries(
  funnel: JobHiringFunnel,
): Array<[JobFunnelStage, number]> {
  return JOB_FUNNEL_STAGES.map((stage) => [stage, funnel[stage]]);
}

export { isUnreviewedJobApplication };
