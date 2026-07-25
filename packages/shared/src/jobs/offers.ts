/**
 * Offer and hire close-out. The pipeline previously ended at the interview: an
 * employer could mark someone "hired" but nothing recorded what was actually
 * offered, and the candidate had no way to accept or decline on the record.
 *
 * An offer carries the terms, the candidate answers it, and accepting is what
 * marks the application hired — and, when the employer asked for it, closes the
 * posting so a filled job stops collecting applications.
 */
import { formatJobCompensation } from "./compensation";
import type { JobPostingStatus } from "./types";
import type { JobCompensation, JobEngagementDuration } from "./types";

export type JobOfferStatus =
  | "sent"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "expired";

export interface JobOffer {
  id: string;
  applicationId: string;
  postingId: string;
  applicantId: string;
  /** Employer or company member who sent it. */
  createdBy: string;
  status: JobOfferStatus;
  /** Terms being offered. Reuses the posting's compensation shape. */
  compensation: JobCompensation;
  /** Proposed first day, ISO 8601. */
  startDate?: string | null;
  /** How long the engagement runs, when it is not open-ended. */
  engagementDuration?: JobEngagementDuration | null;
  /** Where the work happens, or "Remote". */
  locationText?: string | null;
  /** Anything else the candidate should weigh before answering. */
  details?: string | null;
  /** Respond-by deadline. A sent offer past this is treated as expired. */
  expiresAt?: string | null;
  /** Whether accepting should also close the posting. */
  closePostingOnAccept: boolean;
  respondedAt?: string | null;
  /** Optional candidate note when declining. */
  declineReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const JOB_OFFER_STATUS_LABELS: Record<JobOfferStatus, string> = {
  sent: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export const JOB_OFFER_DETAILS_MAX_LENGTH = 2000;
export const JOB_OFFER_LOCATION_MAX_LENGTH = 500;
export const JOB_OFFER_DECLINE_REASON_MAX_LENGTH = 500;
export const JOB_OFFER_DEFAULT_EXPIRY_DAYS = 7;
export const JOB_OFFER_MAX_EXPIRY_DAYS = 90;
export const JOB_OFFER_MIN_EXPIRY_MINUTES = 60;

export function isJobOfferStatus(value: unknown): value is JobOfferStatus {
  return (
    typeof value === "string" &&
    value in (JOB_OFFER_STATUS_LABELS as Record<string, string>)
  );
}

/**
 * A deadline that has passed leaves the stored status as "sent" until someone
 * touches the row, so every read goes through this to get the truth.
 */
export function isJobOfferExpired(
  offer: Pick<JobOffer, "status" | "expiresAt">,
  options?: { now?: Date },
): boolean {
  if (offer.status !== "sent" || !offer.expiresAt) return false;
  const deadline = new Date(offer.expiresAt).getTime();
  if (!Number.isFinite(deadline)) return false;
  return deadline <= (options?.now ?? new Date()).getTime();
}

/** The status to show, accounting for a deadline that has quietly passed. */
export function effectiveJobOfferStatus(
  offer: Pick<JobOffer, "status" | "expiresAt">,
  options?: { now?: Date },
): JobOfferStatus {
  return isJobOfferExpired(offer, options) ? "expired" : offer.status;
}

/** Statuses where the offer is still a live decision for the candidate. */
export function isJobOfferOpen(
  offer: Pick<JobOffer, "status" | "expiresAt">,
  options?: { now?: Date },
): boolean {
  return effectiveJobOfferStatus(offer, options) === "sent";
}

export function canApplicantRespondToJobOffer(
  offer: Pick<JobOffer, "status" | "expiresAt">,
  options?: { now?: Date },
): boolean {
  return isJobOfferOpen(offer, options);
}

/** An employer can pull an offer back until the candidate answers it. */
export function canEmployerWithdrawJobOffer(
  offer: Pick<JobOffer, "status" | "expiresAt">,
): boolean {
  return offer.status === "sent";
}

/**
 * Guards every status write. `actor` matters because withdrawing and declining
 * are different moves from the same starting point, and only the candidate may
 * accept.
 */
export function canSetJobOfferStatus(
  from: JobOfferStatus,
  to: JobOfferStatus,
  actor: "employer" | "applicant",
): boolean {
  if (from === to) return false;
  if (from !== "sent") return false;
  if (actor === "applicant") return to === "accepted" || to === "declined";
  return to === "withdrawn";
}

/**
 * Only one offer per application may be outstanding: two live offers would let
 * a candidate accept terms the employer had already replaced.
 */
export function hasOpenJobOffer(
  offers: Array<Pick<JobOffer, "status" | "expiresAt">>,
  options?: { now?: Date },
): boolean {
  return offers.some((offer) => isJobOfferOpen(offer, options));
}

/**
 * Clamps a respond-by deadline into a sane window. Too soon is unfair to the
 * candidate and too far out leaves the posting in limbo, so both ends are
 * bounded; a missing or unparseable value falls back to the default.
 */
export function normalizeJobOfferExpiry(
  input: unknown,
  options?: { now?: Date },
): string {
  const now = options?.now ?? new Date();
  const earliest = now.getTime() + JOB_OFFER_MIN_EXPIRY_MINUTES * 60000;
  const latest = now.getTime() + JOB_OFFER_MAX_EXPIRY_DAYS * 86400000;
  const fallback = now.getTime() + JOB_OFFER_DEFAULT_EXPIRY_DAYS * 86400000;

  const parsed =
    typeof input === "string" || input instanceof Date
      ? new Date(input as string).getTime()
      : NaN;
  const chosen = Number.isFinite(parsed) ? parsed : fallback;
  return new Date(Math.min(latest, Math.max(earliest, chosen))).toISOString();
}

/**
 * Accepts a date-only string or a timestamp and returns date-only, since a
 * start date has no meaningful time of day and storing one invites timezone
 * drift. Past dates are allowed: backdating a start is legitimate.
 */
export function normalizeJobOfferStartDate(input: unknown): string | null {
  if (typeof input !== "string" && !(input instanceof Date)) return null;
  const parsed = input instanceof Date ? input : new Date(input);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Whether accepting an offer should take the posting out of search. */
export function canAutoCloseJobPostingOnHire(
  status: JobPostingStatus,
): boolean {
  return status === "active" || status === "paused";
}

/**
 * One-line terms summary, e.g. "NGN 150000 / month · starts Aug 3". Locale
 * formatting is left to the runtime so each client renders in its own timezone.
 */
export function describeJobOffer(
  offer: Pick<JobOffer, "compensation" | "startDate">,
  options?: { locale?: string },
): string {
  const parts = [formatJobCompensation(offer.compensation)];
  if (offer.startDate) {
    const start = new Date(offer.startDate);
    if (Number.isFinite(start.getTime())) {
      parts.push(
        `starts ${start.toLocaleDateString(options?.locale, {
          month: "short",
          day: "numeric",
          // A start date is date-only, so render it as written rather than
          // shifting it a day in timezones behind UTC.
          timeZone: "UTC",
        })}`,
      );
    }
  }
  return parts.join(" · ");
}

/** How long the candidate has left, e.g. "3 days left" or "Expired". */
export function describeJobOfferDeadline(
  offer: Pick<JobOffer, "status" | "expiresAt">,
  options?: { now?: Date },
): string | null {
  if (offer.status !== "sent" || !offer.expiresAt) return null;
  const deadline = new Date(offer.expiresAt).getTime();
  if (!Number.isFinite(deadline)) return null;
  const remaining = deadline - (options?.now ?? new Date()).getTime();
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / 3600000);
  if (hours < 1) return "Less than an hour left";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} left`;
}
