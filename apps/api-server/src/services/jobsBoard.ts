/**
 * Jobs board service — employment listings sibling of marketplace goods.
 * Mutations use the service-role Supabase client.
 */
import { randomUUID } from "crypto";
import { bestEffortWrite } from "./data/writeResult";
import {
  JOBS_DEFAULT_COUNTRY,
  JOBS_MAX_SCREENERS_PHASE1,
  JOBS_MAX_SCREENERS_PHASE2,
  JOB_APPLICATION_NOTE_MAX_LENGTH,
  JOB_INTERVIEW_DETAILS_MAX_LENGTH,
  JOB_INTERVIEW_LOCATION_MAX_LENGTH,
  JOB_INTERVIEW_MAX_SLOTS,
  JOB_OFFER_DECLINE_REASON_MAX_LENGTH,
  JOB_OFFER_DETAILS_MAX_LENGTH,
  JOB_OFFER_LOCATION_MAX_LENGTH,
  JOB_POSTING_STATUS_LABELS,
  JOB_RESUME_MAX_BYTES,
  JOB_SAVED_SEARCH_LIMIT_PER_USER,
  JOB_SAVED_SEARCH_NAME_MAX_LENGTH,
  JOB_BULK_STATUS_MAX,
  JOB_COMPANY_ABOUT_MAX_LENGTH,
  JOB_COMPANY_INDUSTRY_MAX_LENGTH,
  JOB_COMPANY_LOCATION_MAX_LENGTH,
  JOB_COMPANY_LOGO_MAX_BYTES,
  JOB_COMPANY_MEMBER_LIMIT,
  JOB_COMPANY_NAME_MAX_LENGTH,
  JOB_COMPANY_TAGLINE_MAX_LENGTH,
  averageNumber,
  buildJobApplicantsCsv,
  buildJobHiringFunnel,
  canAutoCloseJobPostingOnHire,
  canEditJobCompanyProfile,
  canEmployerRescheduleJobInterview,
  canEmployerSetJobPostingStatus,
  canManageJobCompanyMembers,
  canRemoveJobCompanyMember,
  canSetJobInterviewStatus,
  canSetJobOfferStatus,
  clampJobCompanyText,
  clampJobInterviewDuration,
  countJobApplicationStatuses,
  daysBetween,
  describeJobOffer,
  describeJobTemplateLeftovers,
  JOB_APPLICATION_STATUS_LABELS,
  emptyJobApplicationStatusCounts,
  formatJobInterviewSlotList,
  hasOpenJobOffer,
  isHighViewsLowApply,
  isJobEmployerBulkStatus,
  isJobInterviewMode,
  isJobOfferExpired,
  isStaleActivePosting,
  jobApplicantsCsvFilename,
  jobConversionRates,
  matchJobInterviewSlot,
  medianNumber,
  normalizeBulkApplicationIds,
  normalizeJobCompanyDomain,
  normalizeJobCompanyWebsite,
  normalizeJobInterviewSlots,
  normalizeJobOfferExpiry,
  normalizeJobOfferStartDate,
  normalizeJobSearchFilters,
  suggestJobSavedSearchName,
  isJobCompensationPeriod,
  isJobPostingEditable,
  isJobPostingStatus,
  isUnreviewedJobApplication,
  jobResumeExtension,
  jobResumeMimeType,
  isValidJobEngagementDuration,
  jobRequiresEngagementDuration,
  textFailsJobScamCheck,
  type JobApplicationStatus,
  type JobCompanyMemberRole,
  type JobCompensation,
  type JobEmployerAnalytics,
  type JobEmploymentType,
  type JobEngagementDuration,
  type JobInterview,
  type JobInterviewMode,
  type JobInterviewStatus,
  type JobOffer,
  type JobOfferStatus,
  type JobPosting,
  type JobPostingAnalytics,
  type JobPostingStatus,
  type JobSavedSearch,
  type JobSearchFilters,
} from "@lantern/shared/jobs";
import type { DataLayer } from "./data";
import { detectImageMime } from "../utils/fileValidation";
import { logger } from "../utils/logger";
import {
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  processImageForUpload,
} from "./imageProcessing";

export type CreateJobPostingInput = {
  title: string;
  description: string;
  employmentType: JobEmploymentType;
  campusId?: string | null;
  campusIds?: string[];
  locationText?: string | null;
  isRemote?: boolean;
  compensation: JobCompensation;
  engagementDuration?: JobEngagementDuration | null;
  deadline?: string | null;
  applyMode?: "in_app" | "external" | "both";
  externalUrl?: string | null;
  companyId?: string | null;
  status?: JobPostingStatus;
  requiresSchoolApproval?: boolean;
  screeningQuestions?: Array<{
    prompt: string;
    questionType?: "text" | "single_choice";
    options?: string[];
    required?: boolean;
  }>;
  isSponsored?: boolean;
  sponsoredUntil?: string | null;
  atsProvider?: string | null;
  atsExternalId?: string | null;
  atsWebhookUrl?: string | null;
};

const RESUME_BUCKET = "job-resumes";
const RESUME_SIGNED_URL_TTL_SECONDS = 60 * 10;
const COMPANY_LOGO_BUCKET = "job-company-logos";

function httpError(message: string, statusCode = 400): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = statusCode;
  return err;
}

// ─── Input validation (helpers exported for the regression tests) ───────────

/**
 * ATS webhooks POST the full applicant record to this URL, so the destination
 * must be a real, public, credential-free https endpoint. Anything else —
 * plain http, embedded credentials, IP literals, localhost, or internal-only
 * names — turns the webhook into an SSRF primitive against our own network.
 * Returns the problem as a string, or null when the URL is acceptable.
 */
const PRIVATE_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
];

export function atsWebhookUrlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "atsWebhookUrl must be a valid URL";
  }
  if (url.protocol !== "https:") {
    return "atsWebhookUrl must be an https:// URL";
  }
  if (url.username || url.password) {
    return "atsWebhookUrl must not embed credentials";
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIpV6 = host.includes(":") || host.startsWith("[");
  const isIpV4Like = host
    .split(".")
    .every((label) => /^\d+$/.test(label) || /^0x[0-9a-f]+$/i.test(label));
  if (
    isIpV6 ||
    isIpV4Like ||
    host === "localhost" ||
    !host.includes(".") ||
    PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return "atsWebhookUrl must point at a public host, not an IP address or internal name";
  }
  return null;
}

/** Normalizes an incoming atsWebhookUrl: null/empty clears it, anything else must pass atsWebhookUrlError. */
function normalizeAtsWebhookUrl(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw httpError("atsWebhookUrl must be a URL string");
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const problem = atsWebhookUrlError(trimmed);
  if (problem) throw httpError(problem);
  return trimmed;
}

/** External apply links must actually be clickable web URLs. */
export function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const JOB_APPLY_MODES = ["in_app", "external", "both"] as const;

function isJobApplyMode(
  value: unknown,
): value is (typeof JOB_APPLY_MODES)[number] {
  return (
    typeof value === "string" &&
    (JOB_APPLY_MODES as readonly string[]).includes(value)
  );
}

/**
 * A posting with applyMode external/both but no working externalUrl is a dead
 * end nobody can apply to, so both create and patch refuse to store one.
 */
function assertApplyModeReachable(
  applyMode: unknown,
  externalUrl: string | null,
) {
  if (applyMode !== "external" && applyMode !== "both") return;
  if (!externalUrl?.trim()) {
    throw httpError("externalUrl is required when applyMode is external or both");
  }
  if (!isValidHttpUrl(externalUrl.trim())) {
    throw httpError(
      "externalUrl must be a valid http(s) link when applyMode is external or both",
    );
  }
}

/**
 * The ATS wiring (webhook URL, provider, external id) is employer
 * configuration: the webhook URL alone lets anyone POST forged applicants
 * into the poster's ATS. It must never ride along on public or
 * candidate-facing payloads; the owner's surfaces (my-postings and the edit
 * form's GET /postings/:id) keep it so the edit form can round-trip it.
 */
export function stripPrivatePostingFields<T>(posting: T): T {
  if (!posting || typeof posting !== "object") return posting;
  const clean = { ...(posting as Record<string, unknown>) };
  delete clean.atsProvider;
  delete clean.atsExternalId;
  delete clean.atsWebhookUrl;
  return clean as unknown as T;
}

/** True when the posting has a deadline and it is already behind us. */
export function jobPostingDeadlinePassed(
  deadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false;
  const cutoff = new Date(deadline).getTime();
  return Number.isFinite(cutoff) && cutoff < now.getTime();
}

function deadlineClosedError(deadline: string): Error {
  const day = new Date(deadline).toISOString().slice(0, 10);
  return httpError(`Applications for this job closed on ${day}`);
}

/**
 * Stages that proposing an interview may advance an application from. Later
 * stages (offer, hired) and terminal ones (rejected, withdrawn) must never be
 * rewound by a follow-up interview invite.
 */
const JOB_PRE_INTERVIEW_STATUSES: readonly JobApplicationStatus[] = [
  "interested",
  "chatting",
  "new",
  "reviewing",
];

export function shouldAdvanceApplicationToInterview(status: unknown): boolean {
  return (
    typeof status === "string" &&
    (JOB_PRE_INTERVIEW_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * `withdrawn` is the candidate's own exit and `interested`/`chatting` are
 * applicant- or system-initiated inbox states — an employer forcing any of
 * them would fake a candidate action. Employers may only place an application
 * in a hiring-stage status; applicants keep their withdraw path.
 */
const JOB_CANDIDATE_OWNED_STATUSES: ReadonlySet<string> = new Set([
  "withdrawn",
  "interested",
  "chatting",
]);

export function applicationStatusUpdateError(
  status: unknown,
  opts?: { asApplicant?: boolean },
): string | null {
  if (
    typeof status !== "string" ||
    !(status in JOB_APPLICATION_STATUS_LABELS)
  ) {
    return "Unknown application status";
  }
  if (!opts?.asApplicant && JOB_CANDIDATE_OWNED_STATUSES.has(status)) {
    return `Employers cannot set an application to "${status}"`;
  }
  return null;
}

/** Amounts, when present, must be real non-negative numbers — not NaN, Infinity, negatives, or strings. */
function assertValidPayAmount(value: unknown, field: string) {
  if (value == null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw httpError(`${field} must be a number of at least 0`);
  }
}

// Exported for the regression tests covering pay sanity checks.
export function normalizeCompensation(
  compensation: JobCompensation | null | undefined,
): JobCompensation {
  const c = compensation || { kind: "discuss" as const };
  // NGN is the only currency this product supports end to end (payouts,
  // filters, formatting); junk currencies would render as real offers.
  if (c.currency && c.currency !== "NGN") {
    throw httpError("Only NGN compensation is supported");
  }
  if (c.kind !== "paid") {
    return {
      kind: c.kind,
      currency: c.currency || "NGN",
      notes: c.notes || null,
    };
  }
  assertValidPayAmount(c.amountMin, "amountMin");
  assertValidPayAmount(c.amountMax, "amountMax");
  if (
    c.amountMin != null &&
    c.amountMax != null &&
    c.amountMax < c.amountMin
  ) {
    throw httpError("amountMax must be greater than or equal to amountMin");
  }
  if (c.amountMin != null && !isJobCompensationPeriod(c.period)) {
    throw httpError("Pay period is required when a paid amount is set");
  }
  if (c.amountMin == null && !c.period) {
    throw httpError("Paid jobs need an amount and pay period, or use Discuss");
  }
  if (!isJobCompensationPeriod(c.period)) {
    throw httpError("Pay period is required for paid jobs");
  }
  return {
    kind: "paid",
    currency: c.currency || "NGN",
    amountMin: c.amountMin ?? null,
    amountMax: c.amountMax ?? null,
    period: c.period,
    notes: c.notes || null,
  };
}

function normalizeEngagementDuration(
  employmentType: JobEmploymentType,
  duration: JobEngagementDuration | null | undefined,
): JobEngagementDuration | null {
  if (!jobRequiresEngagementDuration(employmentType)) {
    return null;
  }
  if (!isValidJobEngagementDuration(duration)) {
    throw httpError(
      "Role duration is required for non–full-time jobs (ongoing or a fixed length)",
    );
  }
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  return {
    kind: "fixed",
    value: Number(duration.value),
    unit: duration.unit,
  };
}

function mapPosting(
  row: any,
  savedPostingIds?: ReadonlySet<string>,
  appliedPostingIds?: ReadonlySet<string>,
) {
  if (!row) return null;
  const campus = Array.isArray(row.campus) ? row.campus[0] : row.campus;
  const company = Array.isArray(row.company) ? row.company[0] : row.company;
  const poster = Array.isArray(row.poster) ? row.poster[0] : row.poster;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    employmentType: row.employment_type,
    campusId: row.campus_id,
    campusIds: row.campus_ids || [],
    locationText: row.location_text,
    isRemote: !!row.is_remote,
    compensation: row.compensation || { kind: "discuss" },
    engagementDuration: row.engagement_duration || null,
    deadline: row.deadline,
    applyMode: row.apply_mode,
    externalUrl: row.external_url,
    posterUserId: row.poster_user_id,
    companyId: row.company_id,
    status: row.status,
    viewsCount: row.views_count ?? 0,
    // PostgREST count embed: applications:job_applications(count) -> [{count}]
    applicationsCount: Array.isArray(row.applications)
      ? Number(row.applications[0]?.count ?? 0)
      : undefined,
    isSponsored: !!row.is_sponsored,
    sponsoredUntil: row.sponsored_until,
    atsProvider: row.ats_provider,
    atsExternalId: row.ats_external_id,
    atsWebhookUrl: row.ats_webhook_url,
    requiresSchoolApproval: !!row.requires_school_approval,
    countryCode: row.country_code || JOBS_DEFAULT_COUNTRY,
    campusName: campus?.name || null,
    isSaved: savedPostingIds ? savedPostingIds.has(row.id) : undefined,
    hasApplied: appliedPostingIds
      ? appliedPostingIds.has(row.id)
      : undefined,
    company: mapCompany(company),
    poster: poster
      ? {
          id: poster.id,
          name: poster.name,
          username: poster.username,
          avatarUrl: poster.avatar_url,
        }
      : null,
    screeningQuestions: Array.isArray(row.screening_questions)
      ? row.screening_questions
          .map((q: any) => ({
            id: q.id,
            postingId: q.posting_id,
            sortOrder: q.sort_order,
            prompt: q.prompt,
            questionType: q.question_type,
            options: q.options,
            required: !!q.required,
          }))
          .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplication(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    postingId: row.posting_id,
    applicantId: row.applicant_id,
    answers: row.answers || {},
    resumeUrl: row.resume_url,
    resumePath: row.resume_path || null,
    resumeFilename: row.resume_filename || null,
    status: row.status,
    dmThreadId: row.dm_thread_id,
    source: row.source,
    profileSnapshot: row.profile_snapshot,
    // Application payloads go to candidates (and employer pipelines that have
    // their own posting surface) — the embedded posting never needs ATS wiring.
    posting: row.posting
      ? stripPrivatePostingFields(mapPosting(row.posting))
      : undefined,
    applicant: row.applicant
      ? {
          id: row.applicant.id,
          name: row.applicant.name,
          username: row.applicant.username,
          avatarUrl: row.applicant.avatar_url,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplicationNote(row: any) {
  if (!row) return null;
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  return {
    id: row.id,
    applicationId: row.application_id,
    authorId: row.author_id,
    body: row.body,
    author: author
      ? {
          id: author.id,
          name: author.name,
          username: author.username,
          avatarUrl: author.avatar_url,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplicantProfile(row: any) {
  if (!row) return null;
  return {
    userId: row.user_id,
    headline: row.headline,
    phone: row.phone,
    locationText: row.location_text,
    resumePath: row.resume_path,
    resumeFilename: row.resume_filename,
    resumeSizeBytes: row.resume_size_bytes,
    resumeUploadedAt: row.resume_uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInterview(row: any): JobInterview {
  return {
    id: row.id,
    applicationId: row.application_id,
    postingId: row.posting_id,
    applicantId: row.applicant_id,
    createdBy: row.created_by,
    mode: row.mode,
    status: row.status,
    durationMinutes: row.duration_minutes,
    locationText: row.location_text ?? null,
    details: row.details ?? null,
    proposedSlots: Array.isArray(row.proposed_slots) ? row.proposed_slots : [],
    scheduledAt: row.scheduled_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOffer(row: any): JobOffer {
  return {
    id: row.id,
    applicationId: row.application_id,
    postingId: row.posting_id,
    applicantId: row.applicant_id,
    createdBy: row.created_by,
    status: row.status,
    compensation: row.compensation || { kind: "discuss" },
    startDate: row.start_date ?? null,
    engagementDuration: row.engagement_duration ?? null,
    locationText: row.location_text ?? null,
    details: row.details ?? null,
    expiresAt: row.expires_at ?? null,
    closePostingOnAccept: row.close_posting_on_accept !== false,
    respondedAt: row.responded_at ?? null,
    declineReason: row.decline_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedSearch(row: any): JobSavedSearch {
  return {
    id: row.id,
    name: row.name,
    filters: normalizeJobSearchFilters(row.filters),
    notify: !!row.notify,
    lastCheckedAt: row.last_checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCompany(
  row: any,
  opts?: { includePrivate?: boolean },
) {
  if (!row) return null;
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    website: row.website,
    logoUrl: row.logo_url,
    industry: row.industry,
    tagline: row.tagline ?? null,
    about: row.about ?? null,
    hqLocation: row.hq_location ?? null,
    countryCode: row.country_code,
    verificationStatus: row.verification_status,
    verificationDomain: row.verification_domain,
    // Rejection notes are for the employer team only — never on public payloads.
    ...(opts?.includePrivate
      ? { verificationNote: row.verification_note ?? null }
      : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCompanyMember(row: any) {
  if (!row) return null;
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    role: row.role as JobCompanyMemberRole,
    user: user
      ? {
          id: user.id,
          name: user.name ?? null,
          username: user.username ?? null,
          avatarUrl: user.avatar_url ?? null,
        }
      : null,
    createdAt: row.created_at,
  };
}

function companyLogoPublicUrl(filePath: string): string {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
  return `${base}/storage/v1/object/public/${COMPANY_LOGO_BUCKET}/${filePath}`;
}

export class JobsBoardService {
  constructor(private readonly data: DataLayer) {}

  private client() {
    return this.data.getClient();
  }

  async listPostings(filters: {
    page?: number;
    limit?: number;
    search?: string;
    employmentType?: string;
    campusId?: string;
    companyOnly?: boolean;
    remote?: boolean;
    compensationKind?: "paid" | "unpaid" | "discuss";
    minPay?: number;
    sort?: "newest" | "closing" | "trending";
    sponsoredFirst?: boolean;
    viewerId?: string | null;
  }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const minPay =
      typeof filters.minPay === "number" && Number.isFinite(filters.minPay) && filters.minPay > 0
        ? filters.minPay
        : undefined;
    // The trending ranking runs in a SQL function that has no pay parameter,
    // so a pay-filtered browse degrades to newest-first rather than silently
    // ignoring the filter.
    const sort = minPay && (filters.sort || "trending") === "trending"
      ? "newest"
      : filters.sort || "trending";

    if (sort === "trending") {
      return this.listPostingsTrending(filters, page, limit);
    }

    let query = this.client()
      .from("job_postings")
      .select(
        `
        *,
        applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url)
      `,
        { count: "exact" },
      )
      .eq("status", "active")
      .eq("country_code", JOBS_DEFAULT_COUNTRY);

    if (filters.employmentType)
      query = query.eq("employment_type", filters.employmentType);
    if (filters.campusId) query = query.eq("campus_id", filters.campusId);
    if (filters.companyOnly) query = query.not("company_id", "is", null);
    if (filters.remote !== undefined)
      query = query.eq("is_remote", filters.remote);
    if (filters.compensationKind) {
      query = query.contains("compensation", {
        kind: filters.compensationKind,
      });
    }
    if (minPay) {
      // Only paid roles are comparable; match when the top (or only) figure
      // clears the bar. JSONB `->` comparisons are numeric, unlike `->>`.
      query = query
        .contains("compensation", { kind: "paid" })
        .or(
          `compensation->amountMax.gte.${minPay},compensation->amountMin.gte.${minPay}`,
        );
    }
    if (filters.search?.trim()) {
      query = query.textSearch("search_vector", filters.search.trim(), {
        type: "websearch",
        config: "english",
      });
    }

    if (sort === "closing") {
      query = query
        .not("deadline", "is", null)
        .gte("deadline", new Date().toISOString())
        .order("deadline", { ascending: true });
    } else if (filters.sponsoredFirst !== false) {
      query = query
        .order("is_sponsored", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const ids = (data || []).map((row: any) => row.id as string);
    const { savedIds, appliedIds } = await this.viewerPostingFlags(
      filters.viewerId,
      ids,
    );
    return {
      // Browse is a public surface: ATS wiring never ships on it.
      data: (data || []).map((row: any) =>
        stripPrivatePostingFields(mapPosting(row, savedIds, appliedIds)),
      ),
      pagination: { page, limit, total: count ?? 0 },
    };
  }

  private async listPostingsTrending(
    filters: {
      search?: string;
      employmentType?: string;
      campusId?: string;
      companyOnly?: boolean;
      remote?: boolean;
      compensationKind?: "paid" | "unpaid" | "discuss";
      sponsoredFirst?: boolean;
      viewerId?: string | null;
    },
    page: number,
    limit: number,
  ) {
    const { data: ranked, error: rankError } = await this.client().rpc(
      "jobs_board_trending_ids",
      {
        p_page: page,
        p_limit: limit,
        p_search: filters.search?.trim() || null,
        p_employment_type: filters.employmentType || null,
        p_campus_id: filters.campusId || null,
        p_company_only: !!filters.companyOnly,
        p_remote: filters.remote ?? null,
        p_compensation_kind: filters.compensationKind || null,
        p_country_code: JOBS_DEFAULT_COUNTRY,
        p_sponsored_first: filters.sponsoredFirst !== false,
      },
    );
    if (rankError) throw rankError;

    const rows = (ranked || []) as Array<{
      id: string;
      trending_score: number;
      total_count: number;
    }>;
    const total = rows.length > 0 ? Number(rows[0].total_count) || 0 : 0;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return { data: [], pagination: { page, limit, total: 0 } };
    }

    const { data, error } = await this.client()
      .from("job_postings")
      .select(
        `
        *,
        applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url)
      `,
      )
      .in("id", ids);
    if (error) throw error;

    const byId = new Map((data || []).map((row: any) => [row.id, row]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter(Boolean) as any[];
    const { savedIds, appliedIds } = await this.viewerPostingFlags(
      filters.viewerId,
      ordered.map((row) => row.id),
    );
    return {
      // Same public browse surface as the non-trending path: strip ATS wiring.
      data: ordered.map((row) =>
        stripPrivatePostingFields(mapPosting(row, savedIds, appliedIds)),
      ),
      pagination: { page, limit, total },
    };
  }

  /**
   * Saved-posting ids for a viewer, limited to the supplied postings so the
   * lookup stays proportional to the page being rendered.
   */
  private async savedPostingIds(
    viewerId: string | null | undefined,
    postingIds: string[],
  ): Promise<ReadonlySet<string> | undefined> {
    if (!viewerId) return undefined;
    if (!postingIds.length) return new Set<string>();
    const { data, error } = await this.client()
      .from("job_favorites")
      .select("posting_id")
      .eq("user_id", viewerId)
      .in("posting_id", postingIds);
    if (error) {
      logger.warn("Failed to load saved jobs for viewer", { error });
      return undefined;
    }
    return new Set((data || []).map((row: any) => row.posting_id));
  }

  /**
   * Posting ids the viewer has already applied to (any application row,
   * including external-click tracked applies).
   */
  private async appliedPostingIds(
    viewerId: string | null | undefined,
    postingIds: string[],
  ): Promise<ReadonlySet<string> | undefined> {
    if (!viewerId) return undefined;
    if (!postingIds.length) return new Set<string>();
    const { data, error } = await this.client()
      .from("job_applications")
      .select("posting_id")
      .eq("applicant_id", viewerId)
      .in("posting_id", postingIds);
    if (error) {
      logger.warn("Failed to load applied jobs for viewer", { error });
      return undefined;
    }
    return new Set((data || []).map((row: any) => row.posting_id));
  }

  private async viewerPostingFlags(
    viewerId: string | null | undefined,
    postingIds: string[],
  ): Promise<{
    savedIds?: ReadonlySet<string>;
    appliedIds?: ReadonlySet<string>;
  }> {
    const [savedIds, appliedIds] = await Promise.all([
      this.savedPostingIds(viewerId, postingIds),
      this.appliedPostingIds(viewerId, postingIds),
    ]);
    return { savedIds, appliedIds };
  }

  async savePosting(userId: string, postingId: string) {
    const posting = await this.getPosting(postingId);
    if (!posting) throw httpError("Job not found", 404);
    const { error } = await this.client()
      .from("job_favorites")
      .insert({ user_id: userId, posting_id: postingId });
    // 23505 = already saved, which is the desired end state.
    if (error && error.code !== "23505") throw error;
    return { postingId, isSaved: true };
  }

  async unsavePosting(userId: string, postingId: string) {
    const { error } = await this.client()
      .from("job_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("posting_id", postingId);
    if (error) throw error;
    return { postingId, isSaved: false };
  }

  /**
   * New-postings count for a saved search since it was last checked - the
   * in-app "job alert" badge. Checking is the acknowledgement: last_checked_at
   * advances so the badge is one-shot, same as the marketplace equivalent.
   */
  async savedSearchMatches(userId: string, searchId: string) {
    const { data: search, error } = await this.client()
      .from("job_saved_searches")
      .select("*")
      .eq("id", searchId)
      .eq("user_id", userId)
      .single();
    if (error || !search) {
      const err = new Error("Saved search not found") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const f = (search.filters || {}) as {
      search?: string;
      employmentType?: string;
      campusId?: string;
      companyOnly?: boolean;
      remote?: boolean;
      compensationKind?: "paid" | "unpaid" | "discuss";
    };
    let query = this.client()
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("country_code", JOBS_DEFAULT_COUNTRY)
      .gt("created_at", search.last_checked_at);
    if (f.employmentType) query = query.eq("employment_type", f.employmentType);
    if (f.campusId) query = query.eq("campus_id", f.campusId);
    if (f.companyOnly) query = query.not("company_id", "is", null);
    if (f.remote !== undefined) query = query.eq("is_remote", f.remote);
    if (f.compensationKind)
      query = query.contains("compensation", { kind: f.compensationKind });
    if (f.search?.trim()) {
      query = query.textSearch("search_vector", f.search.trim(), {
        type: "websearch",
        config: "english",
      });
    }
    const { count, error: countError } = await query;
    if (countError) throw countError;
    // BEST EFFORT (#108): the watermark only narrows the next scan, and the
    // next run re-stamps it.
    bestEffortWrite(
      await this.client()
        .from("job_saved_searches")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", searchId),
      { table: "job_saved_searches", op: "update", searchId, reason: "scan_watermark" },
    );
    return { count: count ?? 0 };
  }

  async listSavedPostings(userId: string) {
    const { data, error } = await this.client()
      .from("job_favorites")
      .select(
        `
        posting_id,
        created_at,
        posting:job_postings(
          *,
          applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
          company:job_companies(*),
          poster:profiles!poster_user_id(id, name, username, avatar_url)
        )
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const postings = (data || [])
      .map((row: any) =>
        Array.isArray(row.posting) ? row.posting[0] : row.posting,
      )
      .filter(
        (posting: any) => posting && posting.status !== "removed_by_admin",
      );
    const savedIds = new Set(postings.map((posting: any) => posting.id));
    const appliedIds = await this.appliedPostingIds(
      userId,
      postings.map((posting: any) => posting.id),
    );
    return postings.map((posting: any) =>
      // Saved postings are (usually other people's) public postings: no ATS wiring.
      stripPrivatePostingFields(mapPosting(posting, savedIds, appliedIds)),
    );
  }

  // ─── Saved searches ──────────────────────────────────────────────────────

  async listSavedSearches(userId: string): Promise<JobSavedSearch[]> {
    const { data, error } = await this.client()
      .from("job_saved_searches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSavedSearch);
  }

  async createSavedSearch(
    userId: string,
    input: { name?: string; filters?: unknown; notify?: boolean },
  ): Promise<JobSavedSearch> {
    const filters: JobSearchFilters = normalizeJobSearchFilters(input.filters);
    const name =
      (input.name || "").trim().slice(0, JOB_SAVED_SEARCH_NAME_MAX_LENGTH) ||
      suggestJobSavedSearchName(filters);

    const { count, error: countError } = await this.client()
      .from("job_saved_searches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw countError;
    if ((count || 0) >= JOB_SAVED_SEARCH_LIMIT_PER_USER) {
      throw httpError(
        `You can keep up to ${JOB_SAVED_SEARCH_LIMIT_PER_USER} saved searches. Delete one to add another.`,
      );
    }

    const { data, error } = await this.client()
      .from("job_saved_searches")
      .insert({
        user_id: userId,
        name,
        filters,
        notify: input.notify !== false,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapSavedSearch(data);
  }

  async updateSavedSearch(
    id: string,
    userId: string,
    patch: { name?: string; filters?: unknown; notify?: boolean },
  ): Promise<JobSavedSearch> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof patch.name === "string") {
      const name = patch.name.trim().slice(0, JOB_SAVED_SEARCH_NAME_MAX_LENGTH);
      if (!name) throw httpError("Give the saved search a name");
      update.name = name;
    }
    if (patch.filters !== undefined) {
      update.filters = normalizeJobSearchFilters(patch.filters);
    }
    if (typeof patch.notify === "boolean") {
      update.notify = patch.notify;
      // Re-enabling alerts should not replay every posting since it was muted.
      if (patch.notify) update.last_checked_at = new Date().toISOString();
    }

    const { data, error } = await this.client()
      .from("job_saved_searches")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError("Saved search not found", 404);
    return mapSavedSearch(data);
  }

  async deleteSavedSearch(id: string, userId: string) {
    const { error } = await this.client()
      .from("job_saved_searches")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    return { id };
  }

  /**
   * `publicView` marks a requester-facing read (GET /postings/:id): private
   * ATS fields are stripped unless the viewer is the poster or a member of the
   * posting's company. Internal callers (create/update return values, apply
   * flow, webhook firing) omit it and keep the full row.
   */
  async getPosting(
    id: string,
    opts?: {
      incrementViews?: boolean;
      viewerId?: string | null;
      publicView?: boolean;
    },
  ) {
    const { data, error } = await this.client()
      .from("job_postings")
      .select(
        `
        *,
        applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url),
        screening_questions:job_screening_questions(*)
      `,
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (
      opts?.incrementViews &&
      data.status === "active" &&
      opts.viewerId &&
      opts.viewerId !== data.poster_user_id
    ) {
      const { data: counted, error: viewError } = await this.client().rpc(
        "increment_job_posting_views",
        { posting_id: id, viewer_id: opts.viewerId },
      );
      if (viewError) {
        logger.warn("Unique job view RPC failed", {
          postingId: id,
          viewerId: opts.viewerId,
          error: viewError.message,
        });
      } else if (counted === true) {
        data.views_count = (data.views_count || 0) + 1;
      }
    }

    const { savedIds, appliedIds } = await this.viewerPostingFlags(
      opts?.viewerId,
      [data.id],
    );
    const posting = mapPosting(data, savedIds, appliedIds);
    if (opts?.publicView && posting) {
      const canSeeAtsFields =
        !!opts.viewerId &&
        (opts.viewerId === data.poster_user_id ||
          !!(
            data.company_id &&
            (await this.getCompanyMembership(data.company_id, opts.viewerId))
          ));
      if (!canSeeAtsFields) return stripPrivatePostingFields(posting);
    }
    return posting;
  }

  async createPosting(userId: string, input: CreateJobPostingInput) {
    const combined = `${input.title}\n${input.description}`;
    if (textFailsJobScamCheck(combined)) {
      throw httpError(
        "This job text matches banned scam patterns (fees to start, BVN/NIN, crypto, etc.).",
      );
    }

    const compensation = normalizeCompensation(input.compensation);
    const engagementDuration = normalizeEngagementDuration(
      input.employmentType,
      input.engagementDuration,
    );

    if (input.applyMode != null && !isJobApplyMode(input.applyMode)) {
      throw httpError("Invalid applyMode");
    }
    const externalUrl = input.externalUrl?.trim() || null;
    assertApplyModeReachable(input.applyMode, externalUrl);
    const atsWebhookUrl = normalizeAtsWebhookUrl(input.atsWebhookUrl);

    const companyId = input.companyId || null;
    if (companyId) {
      const member = await this.getCompanyMembership(companyId, userId);
      if (!member) {
        const err = new Error("You are not a member of this company");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      const company = await this.getCompany(companyId);
      if (
        company?.verificationStatus !== "verified" &&
        input.status === "active"
      ) {
        // Unverified companies can draft; active company posts require verification
        const err = new Error(
          "Company must be verified before publishing jobs",
        );
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const maxScreeners = companyId
      ? JOBS_MAX_SCREENERS_PHASE2
      : JOBS_MAX_SCREENERS_PHASE1;
    const screeners = (input.screeningQuestions || []).slice(0, maxScreeners);

    const storedTitle = input.title.trim().slice(0, 200);
    const storedDescription = input.description.trim().slice(0, 10000);

    const requestedStatus: JobPostingStatus = input.status || "active";
    // Publishing must not ship template boilerplate ("[team / function]" and
    // friends); drafts may keep placeholders while the poster works on them.
    if (requestedStatus === "active") {
      const leftover = describeJobTemplateLeftovers(
        storedTitle,
        storedDescription,
      );
      if (leftover) throw httpError(leftover);
    }

    // School approval intercepts a *publication* — "Save as draft" stays a
    // draft rather than being routed into the approval queue.
    let status: JobPostingStatus = requestedStatus;
    if (input.requiresSchoolApproval && requestedStatus === "active") {
      status = "pending_school_approval";
    }

    const { data, error } = await this.client()
      .from("job_postings")
      .insert({
        title: storedTitle,
        description: storedDescription,
        employment_type: input.employmentType,
        campus_id: input.campusId || null,
        campus_ids: input.campusIds?.length
          ? input.campusIds
          : input.campusId
            ? [input.campusId]
            : [],
        location_text: input.locationText?.trim() || null,
        is_remote: !!input.isRemote,
        compensation,
        engagement_duration: engagementDuration,
        deadline: input.deadline || null,
        apply_mode: input.applyMode || "in_app",
        external_url: externalUrl,
        poster_user_id: userId,
        company_id: companyId,
        status,
        requires_school_approval: !!input.requiresSchoolApproval,
        is_sponsored: !!input.isSponsored,
        sponsored_until: input.sponsoredUntil || null,
        ats_provider: input.atsProvider || null,
        ats_external_id: input.atsExternalId || null,
        ats_webhook_url: atsWebhookUrl,
        country_code: JOBS_DEFAULT_COUNTRY,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (screeners.length) {
      const { error: qErr } = await this.client()
        .from("job_screening_questions")
        .insert(
          screeners.map((q, i) => ({
            posting_id: data.id,
            sort_order: i,
            prompt: q.prompt.trim().slice(0, 500),
            question_type: q.questionType || "text",
            options: q.options || null,
            required: q.required !== false,
          })),
        );
      if (qErr)
        logger.warn("Failed to insert job screening questions", {
          error: qErr,
        });
    }

    return this.getPosting(data.id);
  }

  async updatePosting(
    postingId: string,
    userId: string,
    updates: Partial<CreateJobPostingInput> & { status?: string },
    opts?: { asAdmin?: boolean },
  ) {
    const existing = await this.getPosting(postingId);
    if (!existing) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    if (!opts?.asAdmin) {
      const canEdit =
        existing.posterUserId === userId ||
        (existing.companyId &&
          (await this.getCompanyMembership(existing.companyId, userId)));
      if (!canEdit) {
        const err = new Error("Not allowed to edit this job");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      if (updates.status != null && !isJobPostingStatus(updates.status)) {
        throw httpError("Unknown job status");
      }
      if (!isJobPostingEditable(existing.status)) {
        throw httpError(
          "This job was removed by moderation and can no longer be edited",
          403,
        );
      }

      const currentStatus = existing.status as JobPostingStatus;
      const nextStatus = (updates.status || currentStatus) as JobPostingStatus;
      if (!canEmployerSetJobPostingStatus(currentStatus, nextStatus)) {
        // Without this an employer could hand themselves `active` out of an
        // admin suspension, or hide a post as `removed_by_admin`.
        throw httpError(
          `A ${JOB_POSTING_STATUS_LABELS[currentStatus].toLowerCase()} job cannot be changed to ${JOB_POSTING_STATUS_LABELS[nextStatus].toLowerCase()}`,
          403,
        );
      }

      // Publishing has to clear the same bar as creating an active post.
      if (nextStatus === "active" && currentStatus !== "active") {
        const companyId = existing.companyId;
        if (companyId) {
          const company = await this.getCompany(companyId);
          if (company?.verificationStatus !== "verified") {
            throw httpError(
              "Company must be verified before publishing jobs",
              403,
            );
          }
        }
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title != null) patch.title = updates.title.trim().slice(0, 200);
    if (updates.description != null)
      patch.description = updates.description.trim().slice(0, 10000);
    if (updates.employmentType != null)
      patch.employment_type = updates.employmentType;
    if (updates.campusId !== undefined) patch.campus_id = updates.campusId;
    if (updates.locationText !== undefined)
      patch.location_text = updates.locationText;
    if (updates.isRemote != null) patch.is_remote = updates.isRemote;
    if (updates.compensation != null) {
      patch.compensation = normalizeCompensation(updates.compensation);
    }
    if (
      updates.engagementDuration !== undefined ||
      updates.employmentType != null
    ) {
      const nextType = updates.employmentType || existing.employmentType;
      const nextDuration =
        updates.engagementDuration !== undefined
          ? updates.engagementDuration
          : existing.engagementDuration;
      patch.engagement_duration = normalizeEngagementDuration(
        nextType,
        nextDuration,
      );
    }
    if (updates.deadline !== undefined) patch.deadline = updates.deadline;
    if (updates.applyMode != null) {
      if (!isJobApplyMode(updates.applyMode)) {
        throw httpError("Invalid applyMode");
      }
      patch.apply_mode = updates.applyMode;
    }
    // A patch must not strand the posting in an unusable apply mode: whatever
    // combination of applyMode/externalUrl will be stored after this update
    // has to leave candidates a working way to apply.
    const nextExternalUrl =
      updates.externalUrl !== undefined
        ? (typeof updates.externalUrl === "string"
            ? updates.externalUrl.trim()
            : "") || null
        : ((existing.externalUrl as string | null) ?? null);
    const nextApplyMode = updates.applyMode ?? existing.applyMode;
    assertApplyModeReachable(nextApplyMode, nextExternalUrl);
    if (updates.externalUrl !== undefined) patch.external_url = nextExternalUrl;
    if (updates.status != null) patch.status = updates.status;
    if (updates.isSponsored != null) patch.is_sponsored = updates.isSponsored;
    if (updates.sponsoredUntil !== undefined)
      patch.sponsored_until = updates.sponsoredUntil;
    if (updates.atsProvider !== undefined)
      patch.ats_provider = updates.atsProvider;
    if (updates.atsExternalId !== undefined)
      patch.ats_external_id = updates.atsExternalId;
    if (updates.atsWebhookUrl !== undefined)
      patch.ats_webhook_url = normalizeAtsWebhookUrl(updates.atsWebhookUrl);
    if (updates.requiresSchoolApproval != null) {
      patch.requires_school_approval = updates.requiresSchoolApproval;
    }

    // Publishing (draft/paused/closed → active) a school-approval posting goes
    // through the approval queue, exactly as it would have on create. Admin
    // edits bypass this: moderation must be able to set statuses directly.
    if (
      !opts?.asAdmin &&
      patch.status === "active" &&
      existing.status !== "active" &&
      (updates.requiresSchoolApproval ?? existing.requiresSchoolApproval)
    ) {
      patch.status = "pending_school_approval";
    }

    const checkText = `${(patch.title as string) || existing.title}\n${(patch.description as string) || existing.description}`;
    if (textFailsJobScamCheck(checkText)) {
      const err = new Error("Updated text matches banned scam patterns.");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    // Same publish gate as create: whatever will be stored while the posting
    // is (or becomes) publicly visible must not be template boilerplate.
    if (!opts?.asAdmin) {
      const targetStatus = (updates.status ??
        existing.status) as JobPostingStatus;
      if (targetStatus === "active") {
        const leftover = describeJobTemplateLeftovers(
          (patch.title as string | undefined) ?? existing.title,
          (patch.description as string | undefined) ?? existing.description,
        );
        if (leftover) throw httpError(leftover);
      }
    }

    const { error } = await this.client()
      .from("job_postings")
      .update(patch)
      .eq("id", postingId);
    if (error) throw error;

    if (updates.screeningQuestions) {
      await this.replaceScreeningQuestions(
        postingId,
        existing.companyId,
        updates.screeningQuestions,
      );
    }

    return this.getPosting(postingId);
  }

  /**
   * Screening questions are rewritten wholesale, since the client edits them as
   * an ordered list and answers are keyed by question id rather than position.
   */
  private async replaceScreeningQuestions(
    postingId: string,
    companyId: string | null | undefined,
    questions: NonNullable<CreateJobPostingInput["screeningQuestions"]>,
  ) {
    const maxScreeners = companyId
      ? JOBS_MAX_SCREENERS_PHASE2
      : JOBS_MAX_SCREENERS_PHASE1;
    const trimmed = questions
      .filter((question) => question.prompt?.trim())
      .slice(0, maxScreeners);

    const { error: deleteError } = await this.client()
      .from("job_screening_questions")
      .delete()
      .eq("posting_id", postingId);
    if (deleteError) throw deleteError;

    if (!trimmed.length) return;
    const { error: insertError } = await this.client()
      .from("job_screening_questions")
      .insert(
        trimmed.map((question, index) => ({
          posting_id: postingId,
          sort_order: index,
          prompt: question.prompt.trim().slice(0, 500),
          question_type: question.questionType || "text",
          options: question.options || null,
          required: question.required !== false,
        })),
      );
    if (insertError) throw insertError;
  }

  /** Ids of every company the user is a member of (owner or recruiter). */
  private async userCompanyIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client()
      .from("job_company_members")
      .select("company_id")
      .eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((row: any) => row.company_id as string);
  }

  /**
   * The employer dashboard covers postings the user authored *and* postings
   * belonging to companies they are a member of — an invited recruiter must
   * see the team's jobs (and their pipelines/analytics), not an empty list.
   * This mirrors the membership rule updatePosting/listApplicantsForPosting
   * already use for writes and pipeline reads.
   */
  async listMyPostings(userId: string) {
    const companyIds = await this.userCompanyIds(userId);
    let query = this.client()
      .from("job_postings")
      .select(
        `
        *,
        applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*)
      `,
      )
      .neq("status", "removed_by_admin")
      .order("created_at", { ascending: false });
    query = companyIds.length
      ? query.or(
          `poster_user_id.eq.${userId},company_id.in.(${companyIds.join(",")})`,
        )
      : query.eq("poster_user_id", userId);
    const { data, error } = await query;
    if (error) throw error;
    const postings = (data || []).map((row: any) => mapPosting(row));
    return this.attachApplicationCounts(postings);
  }

  /**
   * Adds applicant counts to a poster's own postings. One grouped read for the
   * whole dashboard rather than a count query per posting.
   */
  private async attachApplicationCounts<T extends { id: string } | null>(
    postings: T[],
  ): Promise<T[]> {
    const ids = postings
      .map((posting) => posting?.id)
      .filter((id): id is string => !!id);
    if (!ids.length) return postings;

    const { data, error } = await this.client()
      .from("job_applications")
      .select("posting_id, status")
      .in("posting_id", ids);
    if (error) throw error;

    const totals = new Map<string, number>();
    const needsReview = new Map<string, number>();
    for (const row of data || []) {
      const key = (row as any).posting_id as string;
      totals.set(key, (totals.get(key) || 0) + 1);
      if (isUnreviewedJobApplication((row as any).status)) {
        needsReview.set(key, (needsReview.get(key) || 0) + 1);
      }
    }

    return postings.map((posting) =>
      posting
        ? {
            ...posting,
            applicationsCount: totals.get(posting.id) || 0,
            newApplicationsCount: needsReview.get(posting.id) || 0,
          }
        : posting,
    );
  }

  async expressApply(
    postingId: string,
    applicantId: string,
    payload: {
      message?: string;
      answers?: Record<string, string>;
      resumeUrl?: string | null;
      resumePath?: string | null;
      resumeFilename?: string | null;
    },
  ) {
    const posting = await this.getPosting(postingId);
    if (!posting || posting.status !== "active") {
      const err = new Error("Job is not open for applications");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (posting.posterUserId === applicantId) {
      const err = new Error("You cannot apply to your own job");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    // The deadline is a real cutoff, not decoration — clients hide the apply
    // form, but the API is the backstop.
    if (jobPostingDeadlinePassed(posting.deadline)) {
      throw deadlineClosedError(posting.deadline);
    }
    if (posting.applyMode === "external") {
      const err = new Error(
        "This job only accepts applications on the company site",
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const message = (payload.message || `I'm interested in "${posting.title}".`)
      .trim()
      .slice(0, 2000);
    if (textFailsJobScamCheck(message)) {
      const err = new Error("Application message contains banned content");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    // Company jobs: messaging unlocked only when verified
    if (
      posting.companyId &&
      posting.company?.verificationStatus !== "verified"
    ) {
      const err = new Error("This employer is not verified yet");
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    // Attach the resume the applicant chose, or fall back to the one saved on
    // their profile so they do not have to upload it again per application.
    let resumePath = payload.resumePath?.trim() || null;
    let resumeFilename = payload.resumeFilename?.trim() || null;
    if (resumePath) {
      this.assertOwnedResumePath(applicantId, resumePath);
    } else {
      const profile = await this.getApplicantProfile(applicantId);
      if (profile?.resumePath) {
        resumePath = profile.resumePath;
        resumeFilename = resumeFilename || profile.resumeFilename || null;
      }
    }

    const existing = await this.getApplicationByPostingAndApplicant(
      postingId,
      applicantId,
    );
    if (existing) {
      return {
        application: existing,
        existing: true,
        threadId: existing.dmThreadId,
      };
    }

    const posterId = posting.posterUserId;
    const threadId = [applicantId, posterId].sort().join("-");
    const sortedIds = [applicantId, posterId].sort();

    const { error: threadError } = await this.client()
      .from("dm_threads")
      .upsert(
        {
          id: threadId,
          participant_ids: sortedIds,
          participants: {},
          last_message: message,
          last_message_time: new Date().toISOString(),
          status: "open",
          requested_by: null,
        },
        { onConflict: "id" },
      );
    if (threadError)
      throw new Error(`Failed to create DM thread: ${threadError.message}`);

    const { data: profile } = await this.client()
      .from("profiles")
      .select("id, name, username, avatar_url")
      .eq("id", applicantId)
      .maybeSingle();

    const initialStatus: JobApplicationStatus = posting.companyId
      ? "new"
      : "interested";

    const { data, error } = await this.client()
      .from("job_applications")
      .insert({
        posting_id: postingId,
        applicant_id: applicantId,
        answers: payload.answers || {},
        resume_url: payload.resumeUrl || null,
        resume_path: resumePath,
        resume_filename: resumeFilename,
        status: initialStatus,
        dm_thread_id: threadId,
        source: "in_app",
        profile_snapshot: profile
          ? {
              name: profile.name,
              username: profile.username,
              avatarUrl: profile.avatar_url,
            }
          : null,
      })
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        const again = await this.getApplicationByPostingAndApplicant(
          postingId,
          applicantId,
        );
        return {
          application: again,
          existing: true,
          threadId: again?.dmThreadId,
        };
      }
      throw error;
    }

    const dmBody = `💼 Application for: "${posting.title}"\n\n${message}`;
    try {
      await this.data.directMessages.sendDirectMessage(applicantId, posterId, dmBody, {
        bypassPrivacy: true,
      });
    } catch (dmErr) {
      logger.warn("Job apply DM failed", {
        error: dmErr,
        postingId,
        applicantId,
      });
    }

    const applicantName = profile?.name || profile?.username || "An applicant";
    await this.data.notifications.createNotification(posterId, {
      type: "job_application",
      message: `${applicantName} applied to "${posting.title}"`,
      link: `/marketplace/employer/jobs/${postingId}`,
    });

    // Phase 3: optional ATS webhook fire-and-forget
    if (posting.atsWebhookUrl) {
      void this.fireAtsWebhook(posting, mapApplication(data));
    }

    return { application: mapApplication(data), existing: false, threadId };
  }

  async trackExternalApply(postingId: string, userId?: string | null) {
    const posting = await this.getPosting(postingId);
    if (!posting || posting.status !== "active") {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (!posting.externalUrl) {
      const err = new Error("This job has no external apply URL");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    if (jobPostingDeadlinePassed(posting.deadline)) {
      throw deadlineClosedError(posting.deadline);
    }

    // BEST EFFORT (#108): click analytics.
    bestEffortWrite(
      await this.client()
        .from("job_external_apply_clicks")
        .insert({
          posting_id: postingId,
          user_id: userId || null,
        }),
      { table: "job_external_apply_clicks", op: "insert", postingId, userId: userId || null },
    );

    if (userId) {
      const existing = await this.getApplicationByPostingAndApplicant(
        postingId,
        userId,
      );
      if (!existing) {
        // BEST EFFORT at ERROR level (#108): the candidate has already been
        // sent to the employer's site, so there is nothing to fail back to —
        // but losing this row means they applied and neither side has an
        // application to show for it, which someone has to repair by hand.
        bestEffortWrite(
          await this.client().from("job_applications").insert({
            posting_id: postingId,
            applicant_id: userId,
            answers: {},
            status: "new",
            source: "external_click",
          }),
          {
            table: "job_applications",
            op: "insert",
            postingId,
            userId,
            reason: "external_apply_application",
          },
          "error",
          "jobs-application-row-write-failed",
        );
      }
    }

    return { url: posting.externalUrl };
  }

  async getApplicationByPostingAndApplicant(
    postingId: string,
    applicantId: string,
  ) {
    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .eq("posting_id", postingId)
      .eq("applicant_id", applicantId)
      .maybeSingle();
    if (error) throw error;
    return mapApplication(data);
  }

  async listMyApplications(userId: string) {
    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        posting:job_postings(*, company:job_companies(*), campus:marketplace_campuses!campus_id(id, name))
      `,
      )
      .eq("applicant_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapApplication);
  }

  async listApplicantsForPosting(
    postingId: string,
    userId: string,
    opts?: { asAdmin?: boolean },
  ) {
    const posting = await this.getPosting(postingId);
    if (!posting) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (!opts?.asAdmin) {
      const allowed =
        posting.posterUserId === userId ||
        (posting.companyId &&
          (await this.getCompanyMembership(posting.companyId, userId)));
      if (!allowed) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .eq("posting_id", postingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const applications = (data || []).map(mapApplication);

    // Note counts let the pipeline show which candidates have been discussed
    // without fetching every note body up front.
    const ids = applications
      .map((app) => app?.id)
      .filter((id): id is string => !!id);
    if (!ids.length) return applications;
    const { data: noteRows, error: noteError } = await this.client()
      .from("job_application_notes")
      .select("application_id")
      .in("application_id", ids);
    if (noteError) throw noteError;
    const counts = new Map<string, number>();
    for (const row of noteRows || []) {
      const key = (row as any).application_id as string;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return applications.map((app) =>
      app ? { ...app, notesCount: counts.get(app.id) || 0 } : app,
    );
  }

  // ─── Private recruiter notes ──────────────────────────────────────────────

  /**
   * Resolves an application only if the viewer is on the hiring side of it.
   * Applicants are deliberately excluded: notes are about them, not for them.
   */
  private async assertCanReviewApplication(
    applicationId: string,
    viewerId: string,
  ) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select("id, posting:job_postings(id, poster_user_id, company_id)")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) throw httpError("Application not found", 404);

    const posting = Array.isArray(app.posting) ? app.posting[0] : app.posting;
    const allowed =
      posting?.poster_user_id === viewerId ||
      (posting?.company_id &&
        (await this.getCompanyMembership(posting.company_id, viewerId)));
    if (!allowed) throw httpError("Not allowed", 403);
    return app;
  }

  async listApplicationNotes(applicationId: string, viewerId: string) {
    await this.assertCanReviewApplication(applicationId, viewerId);
    const { data, error } = await this.client()
      .from("job_application_notes")
      .select("*, author:profiles!author_id(id, name, username, avatar_url)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapApplicationNote);
  }

  async createApplicationNote(
    applicationId: string,
    authorId: string,
    body: string,
  ) {
    await this.assertCanReviewApplication(applicationId, authorId);
    const trimmed = (body || "").trim();
    if (!trimmed) throw httpError("Write something first");
    if (trimmed.length > JOB_APPLICATION_NOTE_MAX_LENGTH) {
      throw httpError(
        `Notes are limited to ${JOB_APPLICATION_NOTE_MAX_LENGTH} characters`,
      );
    }

    const { data, error } = await this.client()
      .from("job_application_notes")
      .insert({
        application_id: applicationId,
        author_id: authorId,
        body: trimmed,
      })
      .select("*, author:profiles!author_id(id, name, username, avatar_url)")
      .single();
    if (error) throw error;
    return mapApplicationNote(data);
  }

  /** Only the author may remove their own note. */
  async deleteApplicationNote(noteId: string, viewerId: string) {
    const { data: note, error } = await this.client()
      .from("job_application_notes")
      .select("id, author_id, application_id")
      .eq("id", noteId)
      .maybeSingle();
    if (error) throw error;
    if (!note) throw httpError("Note not found", 404);
    if (note.author_id !== viewerId) {
      throw httpError("You can only delete your own notes", 403);
    }

    const { error: deleteError } = await this.client()
      .from("job_application_notes")
      .delete()
      .eq("id", noteId);
    if (deleteError) throw deleteError;
    return { id: noteId, applicationId: note.application_id };
  }

  // ─── Two-sided application records (interviews, offers) ───────────────────

  /**
   * Resolves an application for either side of it, reporting which side the
   * viewer is on. Interviews and offers differ from notes: the candidate has to
   * be able to read them in order to respond.
   */
  private async resolveApplicationParticipant(
    applicationId: string,
    viewerId: string,
  ) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select(
        "id, applicant_id, posting_id, status, posting:job_postings(id, title, poster_user_id, company_id)",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) throw httpError("Application not found", 404);

    const posting: any = Array.isArray(app.posting)
      ? app.posting[0]
      : app.posting;
    const isEmployer =
      posting?.poster_user_id === viewerId ||
      !!(
        posting?.company_id &&
        (await this.getCompanyMembership(posting.company_id, viewerId))
      );
    const isApplicant = app.applicant_id === viewerId;
    if (!isEmployer && !isApplicant) throw httpError("Not allowed", 403);

    return { app, posting, isEmployer, isApplicant };
  }

  private async getInterviewForActor(
    interviewId: string,
    actorId: string,
    actor: "employer" | "applicant",
  ) {
    const { data: row, error } = await this.client()
      .from("job_interviews")
      .select("*")
      .eq("id", interviewId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError("Interview not found", 404);

    const context = await this.resolveApplicationParticipant(
      row.application_id,
      actorId,
    );
    if (actor === "employer" && !context.isEmployer) {
      throw httpError("Not allowed", 403);
    }
    if (actor === "applicant" && !context.isApplicant) {
      throw httpError("Not allowed", 403);
    }
    return { row, ...context };
  }

  /**
   * Mirrors the record into the conversation so the arrangement is also where
   * both sides already talk. A DM failure must not lose the record itself, so
   * this warns rather than throws.
   */
  private async sendApplicationDm(
    fromUserId: string,
    toUserId: string,
    body: string,
  ) {
    try {
      await this.data.directMessages.sendDirectMessage(fromUserId, toUserId, body, {
        bypassPrivacy: true,
      });
    } catch (dmErr) {
      logger.warn("Job application DM failed", {
        error: dmErr,
        fromUserId,
        toUserId,
      });
    }
  }

  // ─── Interview scheduling ─────────────────────────────────────────────────

  private validateInterviewInput(input: {
    mode?: unknown;
    durationMinutes?: unknown;
    locationText?: unknown;
    details?: unknown;
    proposedSlots?: unknown;
  }) {
    const mode: JobInterviewMode = isJobInterviewMode(input.mode)
      ? input.mode
      : "video";
    const slots = normalizeJobInterviewSlots(input.proposedSlots);
    if (!slots.length) {
      throw httpError("Propose at least one future time");
    }
    if (
      Array.isArray(input.proposedSlots) &&
      input.proposedSlots.length > JOB_INTERVIEW_MAX_SLOTS
    ) {
      throw httpError(
        `You can propose at most ${JOB_INTERVIEW_MAX_SLOTS} times`,
      );
    }

    const locationText = String(input.locationText || "").trim();
    if (locationText.length > JOB_INTERVIEW_LOCATION_MAX_LENGTH) {
      throw httpError(
        `Location is limited to ${JOB_INTERVIEW_LOCATION_MAX_LENGTH} characters`,
      );
    }
    const details = String(input.details || "").trim();
    if (details.length > JOB_INTERVIEW_DETAILS_MAX_LENGTH) {
      throw httpError(
        `Details are limited to ${JOB_INTERVIEW_DETAILS_MAX_LENGTH} characters`,
      );
    }

    return {
      mode,
      slots,
      locationText: locationText || null,
      details: details || null,
      durationMinutes: clampJobInterviewDuration(input.durationMinutes),
    };
  }

  async listApplicationInterviews(applicationId: string, viewerId: string) {
    await this.resolveApplicationParticipant(applicationId, viewerId);
    const { data, error } = await this.client()
      .from("job_interviews")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapInterview);
  }

  /** Every interview the user is the candidate for, newest first. */
  async listMyInterviews(userId: string) {
    const { data, error } = await this.client()
      .from("job_interviews")
      .select("*, posting:job_postings(id, title)")
      .eq("applicant_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      ...mapInterview(row),
      postingTitle: (Array.isArray(row.posting) ? row.posting[0] : row.posting)
        ?.title,
    }));
  }

  async scheduleInterview(
    applicationId: string,
    employerId: string,
    input: {
      mode?: unknown;
      durationMinutes?: unknown;
      locationText?: unknown;
      details?: unknown;
      proposedSlots?: unknown;
    },
  ) {
    const { app, posting, isEmployer } =
      await this.resolveApplicationParticipant(applicationId, employerId);
    if (!isEmployer) throw httpError("Not allowed", 403);

    const clean = this.validateInterviewInput(input);
    const { data, error } = await this.client()
      .from("job_interviews")
      .insert({
        application_id: applicationId,
        posting_id: app.posting_id,
        applicant_id: app.applicant_id,
        created_by: employerId,
        mode: clean.mode,
        status: "proposed",
        duration_minutes: clean.durationMinutes,
        location_text: clean.locationText,
        details: clean.details,
        proposed_slots: clean.slots,
      })
      .select("*")
      .single();
    if (error) throw error;

    // Advancing the application keeps the pipeline and the interview in step —
    // but only forwards from an earlier stage. A follow-up interview must not
    // rewind a candidate already at offer/hired, or resurrect a rejected or
    // withdrawn application.
    if (shouldAdvanceApplicationToInterview(app.status)) {
      // BEST EFFORT at ERROR level (#108): the interview row already exists, so
      // throwing would report failure for an invitation that was sent. Losing
      // this leaves the interview scheduled while the candidate's pipeline
      // still reads its old stage.
      bestEffortWrite(
        await this.client()
          .from("job_applications")
          .update({ status: "interview", updated_at: new Date().toISOString() })
          .eq("id", applicationId),
        {
          table: "job_applications",
          op: "update",
          applicationId,
          reason: "advance_to_interview",
        },
        "error",
        "jobs-pipeline-stamp-write-failed",
      );
    }

    const title = posting?.title || "a job";
    await this.data.notifications.createNotification(app.applicant_id, {
      type: "job_interview",
      message: `Interview invitation for "${title}" — choose a time`,
      link: `/marketplace/applications`,
      data: { interviewId: data.id, applicationId },
    });
    await this.sendApplicationDm(
      employerId,
      app.applicant_id,
      `📅 Interview invitation for "${title}"\n\n${formatJobInterviewSlotList(
        clean.slots,
      )}\n\nPick a time from your applications list.`,
    );

    return mapInterview(data);
  }

  /** Replaces the offered times and sends the candidate back to `proposed`. */
  async rescheduleInterview(
    interviewId: string,
    employerId: string,
    input: {
      mode?: unknown;
      durationMinutes?: unknown;
      locationText?: unknown;
      details?: unknown;
      proposedSlots?: unknown;
    },
  ) {
    const { row, posting } = await this.getInterviewForActor(
      interviewId,
      employerId,
      "employer",
    );
    if (!canEmployerRescheduleJobInterview(row.status)) {
      throw httpError(`A ${row.status} interview cannot be rescheduled`);
    }

    const clean = this.validateInterviewInput(input);
    const { data, error } = await this.client()
      .from("job_interviews")
      .update({
        mode: clean.mode,
        status: "proposed",
        duration_minutes: clean.durationMinutes,
        location_text: clean.locationText,
        details: clean.details,
        proposed_slots: clean.slots,
        scheduled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", interviewId)
      .select("*")
      .single();
    if (error) throw error;

    const title = posting?.title || "a job";
    await this.data.notifications.createNotification(row.applicant_id, {
      type: "job_interview",
      message: `New interview times for "${title}"`,
      link: `/marketplace/applications`,
      data: { interviewId, applicationId: row.application_id },
    });
    await this.sendApplicationDm(
      employerId,
      row.applicant_id,
      `📅 Updated interview times for "${title}"\n\n${formatJobInterviewSlotList(
        clean.slots,
      )}`,
    );

    return mapInterview(data);
  }

  /** The candidate accepts one of the offered times, or declines them all. */
  async respondToInterview(
    interviewId: string,
    applicantId: string,
    action: "accept" | "decline",
    slot?: unknown,
  ) {
    const { row, posting } = await this.getInterviewForActor(
      interviewId,
      applicantId,
      "applicant",
    );
    const nextStatus: JobInterviewStatus =
      action === "accept" ? "confirmed" : "declined";
    if (!canSetJobInterviewStatus(row.status, nextStatus, "applicant")) {
      throw httpError(`This interview is ${row.status}`);
    }

    const offered: string[] = Array.isArray(row.proposed_slots)
      ? row.proposed_slots
      : [];
    let scheduledAt: string | null = null;
    if (action === "accept") {
      const match = matchJobInterviewSlot(offered, slot);
      if (!match) throw httpError("Choose one of the proposed times");
      if (new Date(match).getTime() <= Date.now()) {
        throw httpError("That time has already passed");
      }
      scheduledAt = match;
    }

    const { data, error } = await this.client()
      .from("job_interviews")
      .update({
        status: nextStatus,
        scheduled_at: scheduledAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", interviewId)
      .select("*")
      .single();
    if (error) throw error;

    const title = posting?.title || "a job";
    const employerId = row.created_by;
    await this.data.notifications.createNotification(employerId, {
      type: "job_interview_response",
      message:
        action === "accept"
          ? `A candidate confirmed an interview for "${title}"`
          : `A candidate declined the interview times for "${title}"`,
      link: `/marketplace/employer/jobs/${row.posting_id}`,
      data: { interviewId, applicationId: row.application_id },
    });
    await this.sendApplicationDm(
      applicantId,
      employerId,
      action === "accept" && scheduledAt
        ? `✅ I confirmed the interview for "${title}":\n\n${formatJobInterviewSlotList(
            [scheduledAt],
          )}`
        : `⚠️ None of the proposed interview times for "${title}" work for me.`,
    );

    return mapInterview(data);
  }

  /** Employer-side cancel or mark-complete. */
  async updateInterviewStatus(
    interviewId: string,
    employerId: string,
    status: JobInterviewStatus,
  ) {
    const { row, posting } = await this.getInterviewForActor(
      interviewId,
      employerId,
      "employer",
    );
    if (!canSetJobInterviewStatus(row.status, status, "employer")) {
      throw httpError(`Cannot move a ${row.status} interview to ${status}`);
    }

    const { data, error } = await this.client()
      .from("job_interviews")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", interviewId)
      .select("*")
      .single();
    if (error) throw error;

    if (status === "cancelled") {
      const title = posting?.title || "a job";
      await this.data.notifications.createNotification(row.applicant_id, {
        type: "job_interview",
        message: `The interview for "${title}" was cancelled`,
        link: `/marketplace/applications`,
        data: { interviewId, applicationId: row.application_id },
      });
      await this.sendApplicationDm(
        employerId,
        row.applicant_id,
        `❌ The interview for "${title}" has been cancelled.`,
      );
    }

    return mapInterview(data);
  }

  // ─── Offers and hire close-out ────────────────────────────────────────────

  private async getOfferForActor(
    offerId: string,
    actorId: string,
    actor: "employer" | "applicant",
  ) {
    const { data: row, error } = await this.client()
      .from("job_offers")
      .select("*")
      .eq("id", offerId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError("Offer not found", 404);

    const context = await this.resolveApplicationParticipant(
      row.application_id,
      actorId,
    );
    if (actor === "employer" && !context.isEmployer) {
      throw httpError("Not allowed", 403);
    }
    if (actor === "applicant" && !context.isApplicant) {
      throw httpError("Not allowed", 403);
    }
    return { row, ...context };
  }

  private validateOfferInput(input: {
    compensation?: unknown;
    startDate?: unknown;
    engagementDuration?: unknown;
    locationText?: unknown;
    details?: unknown;
    expiresAt?: unknown;
    closePostingOnAccept?: unknown;
  }) {
    const compensation = normalizeCompensation(
      (input.compensation as JobCompensation | null) || null,
    );

    const locationText = String(input.locationText || "").trim();
    if (locationText.length > JOB_OFFER_LOCATION_MAX_LENGTH) {
      throw httpError(
        `Location is limited to ${JOB_OFFER_LOCATION_MAX_LENGTH} characters`,
      );
    }
    const details = String(input.details || "").trim();
    if (details.length > JOB_OFFER_DETAILS_MAX_LENGTH) {
      throw httpError(
        `Offer details are limited to ${JOB_OFFER_DETAILS_MAX_LENGTH} characters`,
      );
    }

    // An unparseable duration is dropped rather than rejected: unlike a
    // posting, an offer does not have to state one.
    const engagementDuration = isValidJobEngagementDuration(
      input.engagementDuration,
    )
      ? (input.engagementDuration as JobEngagementDuration)
      : null;

    return {
      compensation,
      startDate: normalizeJobOfferStartDate(input.startDate),
      engagementDuration,
      locationText: locationText || null,
      details: details || null,
      expiresAt: normalizeJobOfferExpiry(input.expiresAt),
      closePostingOnAccept: input.closePostingOnAccept !== false,
    };
  }

  async listApplicationOffers(applicationId: string, viewerId: string) {
    await this.resolveApplicationParticipant(applicationId, viewerId);
    const { data, error } = await this.client()
      .from("job_offers")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapOffer);
  }

  /** Every offer the user is the candidate for, newest first. */
  async listMyOffers(userId: string) {
    const { data, error } = await this.client()
      .from("job_offers")
      .select("*, posting:job_postings(id, title)")
      .eq("applicant_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      ...mapOffer(row),
      postingTitle: (Array.isArray(row.posting) ? row.posting[0] : row.posting)
        ?.title,
    }));
  }

  async sendOffer(
    applicationId: string,
    employerId: string,
    input: {
      compensation?: unknown;
      startDate?: unknown;
      engagementDuration?: unknown;
      locationText?: unknown;
      details?: unknown;
      expiresAt?: unknown;
      closePostingOnAccept?: unknown;
    },
  ) {
    const { app, posting, isEmployer } =
      await this.resolveApplicationParticipant(applicationId, employerId);
    if (!isEmployer) throw httpError("Not allowed", 403);

    const existing = await this.listApplicationOffers(
      applicationId,
      employerId,
    );
    if (hasOpenJobOffer(existing)) {
      throw httpError(
        "This candidate already has an open offer. Withdraw it before sending another.",
      );
    }
    if (existing.some((offer) => offer.status === "accepted")) {
      throw httpError("This candidate already accepted an offer");
    }

    const clean = this.validateOfferInput(input);
    const { data, error } = await this.client()
      .from("job_offers")
      .insert({
        application_id: applicationId,
        posting_id: app.posting_id,
        applicant_id: app.applicant_id,
        created_by: employerId,
        status: "sent",
        compensation: clean.compensation,
        start_date: clean.startDate,
        engagement_duration: clean.engagementDuration,
        location_text: clean.locationText,
        details: clean.details,
        expires_at: clean.expiresAt,
        close_posting_on_accept: clean.closePostingOnAccept,
      })
      .select("*")
      .single();
    if (error) {
      // The partial unique index is the last line of defence against a race
      // putting two live offers on one application.
      if ((error as any).code === "23505") {
        throw httpError("This candidate already has an open offer");
      }
      throw error;
    }

    // BEST EFFORT at ERROR level (#108): the offer row is already inserted —
    // its unique index is what refuses a second open offer — so this cannot
    // throw. Losing it leaves the offer sent and the candidate's pipeline
    // showing the stage before it.
    bestEffortWrite(
      await this.client()
        .from("job_applications")
        .update({ status: "offer", updated_at: new Date().toISOString() })
        .eq("id", applicationId),
      { table: "job_applications", op: "update", applicationId, reason: "advance_to_offer" },
      "error",
      "jobs-pipeline-stamp-write-failed",
    );

    const offer = mapOffer(data);
    const title = posting?.title || "a job";
    await this.data.notifications.createNotification(app.applicant_id, {
      type: "job_offer",
      message: `You have an offer for "${title}" — respond to accept or decline`,
      link: `/marketplace/applications`,
      data: { offerId: offer.id, applicationId },
    });
    await this.sendApplicationDm(
      employerId,
      app.applicant_id,
      `🎉 Offer for "${title}"\n\n${describeJobOffer(offer)}\n\nOpen your applications list to accept or decline.`,
    );

    return offer;
  }

  /** An employer pulls the offer back before the candidate answers it. */
  async withdrawOffer(offerId: string, employerId: string) {
    const { row, posting } = await this.getOfferForActor(
      offerId,
      employerId,
      "employer",
    );
    if (!canSetJobOfferStatus(row.status, "withdrawn", "employer")) {
      throw httpError(`A ${row.status} offer cannot be withdrawn`);
    }

    const { data, error } = await this.client()
      .from("job_offers")
      .update({ status: "withdrawn", updated_at: new Date().toISOString() })
      .eq("id", offerId)
      .select("*")
      .single();
    if (error) throw error;

    const title = posting?.title || "a job";
    await this.data.notifications.createNotification(row.applicant_id, {
      type: "job_offer",
      message: `The offer for "${title}" was withdrawn`,
      link: `/marketplace/applications`,
      data: { offerId, applicationId: row.application_id },
    });
    await this.sendApplicationDm(
      employerId,
      row.applicant_id,
      `The offer for "${title}" has been withdrawn.`,
    );

    return mapOffer(data);
  }

  /**
   * The candidate accepts or declines. Accepting is what marks the application
   * hired, and closes the posting when the employer asked for that — a filled
   * job should stop collecting applications on its own.
   */
  async respondToOffer(
    offerId: string,
    applicantId: string,
    action: "accept" | "decline",
    declineReason?: unknown,
  ) {
    const { row, posting } = await this.getOfferForActor(
      offerId,
      applicantId,
      "applicant",
    );
    const nextStatus: JobOfferStatus =
      action === "accept" ? "accepted" : "declined";
    if (!canSetJobOfferStatus(row.status, nextStatus, "applicant")) {
      throw httpError(`This offer is ${row.status}`);
    }
    if (isJobOfferExpired(mapOffer(row))) {
      // Record the lapse so the employer sees why it went unanswered.
      // BEST EFFORT (#108): a courtesy stamp so the employer sees why the
      // offer went unanswered. Expiry is derived from the offer's own
      // timestamp, so the next attempt re-detects it and re-stamps; the throw
      // below is what the applicant actually needs.
      bestEffortWrite(
        await this.client()
          .from("job_offers")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", offerId),
        { table: "job_offers", op: "update", offerId, reason: "stamp_lapsed_offer" },
      );
      throw httpError("This offer has expired");
    }

    const reason = String(declineReason || "")
      .trim()
      .slice(0, JOB_OFFER_DECLINE_REASON_MAX_LENGTH);
    const now = new Date().toISOString();
    const { data, error } = await this.client()
      .from("job_offers")
      .update({
        status: nextStatus,
        responded_at: now,
        decline_reason: action === "decline" ? reason || null : null,
        updated_at: now,
      })
      .eq("id", offerId)
      .select("*")
      .single();
    if (error) throw error;

    // Declining an offer ends the process, which is a withdrawal in pipeline
    // terms; accepting is the hire.
    // BEST EFFORT at ERROR level (#108): the offer's own status has already
    // been written, so this cannot throw. Losing it leaves a hire recorded on
    // the offer and nowhere else — the pipeline still shows the candidate at
    // `offer`, and someone has to correct it.
    bestEffortWrite(
      await this.client()
        .from("job_applications")
        .update({
          status: action === "accept" ? "hired" : "withdrawn",
          updated_at: now,
        })
        .eq("id", row.application_id),
      {
        table: "job_applications",
        op: "update",
        applicationId: row.application_id,
        reason: action === "accept" ? "mark_hired" : "mark_withdrawn",
      },
      "error",
      "jobs-pipeline-stamp-write-failed",
    );

    let postingClosed = false;
    if (action === "accept" && row.close_posting_on_accept) {
      postingClosed = await this.closePostingAfterHire(row.posting_id);
    }

    const title = posting?.title || "a job";
    const employerId = row.created_by;
    await this.data.notifications.createNotification(employerId, {
      type: "job_offer_response",
      message:
        action === "accept"
          ? `Your offer for "${title}" was accepted${postingClosed ? " — the job is now closed" : ""}`
          : `Your offer for "${title}" was declined`,
      link: `/marketplace/employer/jobs/${row.posting_id}`,
      data: { offerId, applicationId: row.application_id },
    });
    await this.sendApplicationDm(
      applicantId,
      employerId,
      action === "accept"
        ? `✅ I accept the offer for "${title}".`
        : `Thank you for the offer for "${title}", but I am declining it.${
            reason ? `\n\n${reason}` : ""
          }`,
    );

    return { ...mapOffer(data), postingClosed };
  }

  /**
   * Takes a filled posting out of search. Reports whether it actually closed so
   * the employer's notification can say so, and leaves already-closed or
   * moderated posts alone.
   */
  private async closePostingAfterHire(postingId: string): Promise<boolean> {
    const { data: posting, error } = await this.client()
      .from("job_postings")
      .select("id, status")
      .eq("id", postingId)
      .maybeSingle();
    if (error || !posting) return false;
    if (!isJobPostingStatus(posting.status)) return false;
    if (!canAutoCloseJobPostingOnHire(posting.status)) return false;

    const { error: closeError } = await this.client()
      .from("job_postings")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("id", postingId);
    if (closeError) {
      logger.warn("Auto-close after hire failed", {
        error: closeError,
        postingId,
      });
      return false;
    }
    return true;
  }

  async updateApplicationStatus(
    applicationId: string,
    userId: string,
    status: JobApplicationStatus,
    opts?: { asApplicant?: boolean; asAdmin?: boolean },
  ) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select("*, posting:job_postings(id, title, poster_user_id, company_id)")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) {
      const err = new Error("Application not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const posting = Array.isArray(app.posting) ? app.posting[0] : app.posting;
    if (opts?.asApplicant) {
      if (app.applicant_id !== userId) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      if (status !== "withdrawn") {
        const err = new Error("Applicants can only withdraw");
        (err as Error & { statusCode?: number }).statusCode = 400;
        throw err;
      }
    } else if (!opts?.asAdmin) {
      const allowed =
        posting?.poster_user_id === userId ||
        (posting?.company_id &&
          (await this.getCompanyMembership(posting.company_id, userId)));
      if (!allowed) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const { data, error: upErr } = await this.client()
      .from("job_applications")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", applicationId)
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .single();
    if (upErr) throw upErr;

    if (!opts?.asApplicant && app.applicant_id) {
      await this.data.notifications.createNotification(app.applicant_id, {
        type: "job_application_status",
        message: `Your application for "${posting?.title || "a job"}" is now: ${status}`,
        link: `/marketplace/applications`,
      });
    }

    return mapApplication(data);
  }

  /**
   * Moves many applications on one posting to the same status. Auth is checked
   * once against the posting; every id must belong to that posting so a bulk
   * call cannot reach across jobs.
   */
  async bulkUpdateApplicationStatus(
    postingId: string,
    userId: string,
    applicationIds: unknown,
    status: unknown,
  ) {
    // Same employer whitelist as the single-application route: bulk moves are
    // hiring-stage only — never candidate-owned states like withdrawn/chatting.
    if (
      !isJobEmployerBulkStatus(status) ||
      applicationStatusUpdateError(status) != null
    ) {
      const err = new Error(
        "Choose a hiring-stage status (reviewing, interview, offer, hired, or rejected)",
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    const ids = normalizeBulkApplicationIds(applicationIds);
    if (!ids) {
      const err = new Error(
        `Select between 1 and ${JOB_BULK_STATUS_MAX} applicants`,
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const posting = await this.getPosting(postingId);
    if (!posting) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    const allowed =
      posting.posterUserId === userId ||
      (posting.companyId &&
        (await this.getCompanyMembership(posting.companyId, userId)));
    if (!allowed) {
      const err = new Error("Not allowed");
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const { data: existing, error: listErr } = await this.client()
      .from("job_applications")
      .select("id, applicant_id, status")
      .eq("posting_id", postingId)
      .in("id", ids);
    if (listErr) throw listErr;

    const found = new Map(
      (existing || []).map((row: { id: string }) => [row.id, row]),
    );
    if (found.size !== ids.length) {
      const err = new Error(
        "One or more applications are not part of this job",
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    // A candidate who withdrew has left the process — a bulk move must not
    // drag them back into the pipeline (or notify them it happened).
    const movable = (existing || []).filter(
      (row) => (row as { status?: string }).status !== "withdrawn",
    );
    const movableIds = movable.map((row) => (row as { id: string }).id);
    const skippedWithdrawn = ids.length - movableIds.length;

    const now = new Date().toISOString();
    let updated: ReturnType<typeof mapApplication>[] = [];
    if (movableIds.length) {
      const { data, error: upErr } = await this.client()
        .from("job_applications")
        .update({ status, updated_at: now })
        .eq("posting_id", postingId)
        .in("id", movableIds)
        .select(
          `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
        );
      if (upErr) throw upErr;
      updated = (data || []).map(mapApplication);
    }

    for (const row of movable) {
      const applicantId = (row as { applicant_id?: string }).applicant_id;
      const previous = (row as { status?: string }).status;
      if (!applicantId || previous === status) continue;
      await this.data.notifications.createNotification(applicantId, {
        type: "job_application_status",
        message: `Your application for "${posting.title}" is now: ${status}`,
        link: `/marketplace/applications`,
      });
    }

    return {
      updated,
      status,
      count: updated.length,
      skippedWithdrawn,
    };
  }

  /** CSV export of applicants for a posting the caller can manage. */
  async exportApplicantsCsv(postingId: string, userId: string) {
    const posting = await this.getPosting(postingId);
    if (!posting) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    const allowed =
      posting.posterUserId === userId ||
      (posting.companyId &&
        (await this.getCompanyMembership(posting.companyId, userId)));
    if (!allowed) {
      const err = new Error("Not allowed");
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const applications = (
      await this.listApplicantsForPosting(postingId, userId)
    ).filter((app): app is NonNullable<typeof app> => !!app?.id);
    const questionLabels: Record<string, string> = {};
    for (const question of posting.screeningQuestions || []) {
      questionLabels[question.id] = question.prompt;
    }

    const csv = buildJobApplicantsCsv(applications, {
      postingTitle: posting.title,
      questionLabels,
    });
    return {
      csv,
      filename: jobApplicantsCsvFilename(posting.title),
      rowCount: applications.length,
    };
  }

  async reportPosting(
    postingId: string,
    reporterId: string,
    reason: string,
    details?: string,
  ) {
    const { data, error } = await this.client()
      .from("job_reports")
      .insert({
        posting_id: postingId,
        reporter_id: reporterId,
        reason,
        details: details?.slice(0, 1000) || null,
      })
      .select("*")
      .single();
    if (error && error.code !== "23505") throw error;
    return data;
  }

  // ─── Applicant profile + resumes ─────────────────────────────────────────

  private resumeBucket() {
    return this.client().storage.from(RESUME_BUCKET);
  }

  /** Storage paths are always `{userId}/{uuid}.{ext}` so ownership is provable. */
  private assertOwnedResumePath(userId: string, path: string) {
    if (
      !path ||
      path.includes("..") ||
      path.includes("\\") ||
      path.startsWith("/")
    ) {
      throw httpError("Invalid resume path");
    }
    if (!path.startsWith(`${userId}/`)) {
      throw httpError("Not allowed", 403);
    }
  }

  async getApplicantProfile(userId: string) {
    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return mapApplicantProfile(data);
  }

  async saveApplicantProfile(
    userId: string,
    input: {
      headline?: string | null;
      phone?: string | null;
      locationText?: string | null;
    },
  ) {
    const patch: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (input.headline !== undefined) {
      patch.headline = input.headline?.trim().slice(0, 160) || null;
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone?.trim().slice(0, 40) || null;
    }
    if (input.locationText !== undefined) {
      patch.location_text = input.locationText?.trim().slice(0, 120) || null;
    }
    if (
      typeof patch.headline === "string" &&
      textFailsJobScamCheck(patch.headline)
    ) {
      throw httpError("Your headline contains banned content");
    }

    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .upsert(patch, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapApplicantProfile(data);
  }

  /**
   * Mint a short-lived signed upload URL so the file goes straight to Storage
   * rather than through the API process.
   */
  async createResumeUploadUrl(
    userId: string,
    input: { filename: string; sizeBytes?: number | null },
  ) {
    const filename = (input.filename || "").trim();
    const extension = jobResumeExtension(filename);
    const contentType = jobResumeMimeType(filename);
    if (!extension || !contentType) {
      throw httpError("Resumes must be a PDF, DOC, or DOCX file");
    }
    if (input.sizeBytes != null && input.sizeBytes > JOB_RESUME_MAX_BYTES) {
      throw httpError("Resumes must be smaller than 5.0 MB");
    }

    const path = `${userId}/${randomUUID()}.${extension}`;
    const { data, error } =
      await this.resumeBucket().createSignedUploadUrl(path);
    if (error || !data?.signedUrl || !data?.token) {
      logger.error("Failed to create resume upload URL", { error, userId });
      throw httpError(
        error?.message || "Could not start the resume upload",
        500,
      );
    }
    return {
      bucket: RESUME_BUCKET,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      contentType,
    };
  }

  /**
   * Point the applicant's profile at a freshly uploaded object, after confirming
   * it exists so a failed upload cannot leave a dangling reference.
   */
  async attachResumeToProfile(
    userId: string,
    input: { path: string; filename: string; sizeBytes?: number | null },
  ) {
    this.assertOwnedResumePath(userId, input.path);
    const objectName = input.path.slice(userId.length + 1);
    const { data: found, error: listError } = await this.resumeBucket().list(
      userId,
      {
        limit: 100,
        search: objectName,
      },
    );
    if (listError) throw listError;
    const uploaded = (found || []).find(
      (entry: any) => entry.name === objectName,
    );
    if (!uploaded) {
      throw httpError("That upload did not complete. Please try again.");
    }

    const previous = await this.getApplicantProfile(userId);
    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .upsert(
        {
          user_id: userId,
          resume_path: input.path,
          resume_filename: (input.filename || objectName).trim().slice(0, 200),
          resume_size_bytes: input.sizeBytes ?? uploaded.metadata?.size ?? null,
          resume_uploaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();
    if (error) throw error;

    // Old files stay referenced by past applications, so only drop a replaced
    // resume when nothing else points at it.
    if (previous?.resumePath && previous.resumePath !== input.path) {
      await this.deleteResumeIfUnreferenced(previous.resumePath);
    }
    return mapApplicantProfile(data);
  }

  private async deleteResumeIfUnreferenced(path: string) {
    const { count, error } = await this.client()
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("resume_path", path);
    if (error) {
      logger.warn("Could not check resume references; keeping file", { error });
      return;
    }
    if ((count ?? 0) > 0) return;
    const { error: removeError } = await this.resumeBucket().remove([path]);
    if (removeError) {
      logger.warn("Failed to remove replaced resume", { error: removeError });
    }
  }

  /** Signed download URL for the applicant themselves or an authorized employer. */
  async getApplicationResumeUrl(applicationId: string, viewerId: string) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select(
        "id, applicant_id, resume_path, resume_filename, resume_url, posting:job_postings(id, poster_user_id, company_id)",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) throw httpError("Application not found", 404);

    const posting = Array.isArray(app.posting) ? app.posting[0] : app.posting;
    const allowed =
      app.applicant_id === viewerId ||
      posting?.poster_user_id === viewerId ||
      (posting?.company_id &&
        (await this.getCompanyMembership(posting.company_id, viewerId)));
    if (!allowed) throw httpError("Not allowed", 403);

    if (!app.resume_path) {
      // Legacy applications carry a pasted link instead of an uploaded file.
      if (app.resume_url) {
        return { url: app.resume_url, filename: null, external: true };
      }
      throw httpError("This application has no resume", 404);
    }

    const url = await this.data.storageAcl.createSignedStorageUrl(
      RESUME_BUCKET,
      app.resume_path,
      RESUME_SIGNED_URL_TTL_SECONDS,
    );
    return { url, filename: app.resume_filename || null, external: false };
  }

  // ─── Companies (Phase 2) ─────────────────────────────────────────────────

  async createCompany(
    userId: string,
    input: {
      legalName: string;
      displayName: string;
      website?: string;
      industry?: string;
      verificationDomain?: string;
      tagline?: string;
      about?: string;
      hqLocation?: string;
    },
  ) {
    const legalName = clampJobCompanyText(
      input.legalName,
      JOB_COMPANY_NAME_MAX_LENGTH,
    );
    const displayName =
      clampJobCompanyText(input.displayName, JOB_COMPANY_NAME_MAX_LENGTH) ||
      legalName;
    if (!legalName || !displayName) {
      throw httpError("legalName and displayName are required");
    }

    const { data, error } = await this.client()
      .from("job_companies")
      .insert({
        legal_name: legalName,
        display_name: displayName,
        website: normalizeJobCompanyWebsite(input.website),
        industry: clampJobCompanyText(
          input.industry,
          JOB_COMPANY_INDUSTRY_MAX_LENGTH,
        ),
        tagline: clampJobCompanyText(
          input.tagline,
          JOB_COMPANY_TAGLINE_MAX_LENGTH,
        ),
        about: clampJobCompanyText(input.about, JOB_COMPANY_ABOUT_MAX_LENGTH),
        hq_location: clampJobCompanyText(
          input.hqLocation,
          JOB_COMPANY_LOCATION_MAX_LENGTH,
        ),
        verification_domain: normalizeJobCompanyDomain(input.verificationDomain),
        verification_status: "pending",
        created_by: userId,
        country_code: JOBS_DEFAULT_COUNTRY,
      })
      .select("*")
      .single();
    if (error) throw error;

    // BEST EFFORT at ERROR level (#108) — and the closest call in this batch.
    // The company row already exists, so throwing would answer failure for a
    // company that was created and a retry would make a second one. Not
    // throwing leaves the creator holding a company they cannot administer,
    // because nothing names them its owner.
    //
    // Neither answer is good, so this reports loudly and leaves the company:
    // a visible company with a repairable membership beats an invisible
    // duplicate. Whether it should instead delete the company (as the
    // marketplace's orphaned-listing cleanup does) is a product decision, not
    // one for a lane that is making failures observable.
    bestEffortWrite(
      await this.client().from("job_company_members").insert({
        company_id: data.id,
        user_id: userId,
        role: "owner",
      }),
      {
        table: "job_company_members",
        op: "insert",
        companyId: data.id,
        userId,
        reason: "company_owner_membership",
      },
      "error",
      "jobs-company-owner-membership-write-failed",
    );

    return mapCompany(data);
  }

  async getCompany(
    companyId: string,
    opts?: { includePrivate?: boolean },
  ) {
    const { data, error } = await this.client()
      .from("job_companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    if (error) throw error;
    return mapCompany(data, opts);
  }

  async getCompanyMembership(companyId: string, userId: string) {
    const { data, error } = await this.client()
      .from("job_company_members")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listMyCompanies(userId: string) {
    const { data, error } = await this.client()
      .from("job_company_members")
      .select("role, company:job_companies(*)")
      .eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      role: row.role,
      company: mapCompany(
        Array.isArray(row.company) ? row.company[0] : row.company,
        { includePrivate: true },
      ),
    }));
  }

  /**
   * Public company page payload. Verified companies are visible to everyone;
   * unverified ones only to members (preview before admin approval).
   */
  async getCompanyPublicProfile(
    companyId: string,
    viewerId?: string | null,
  ) {
    const membership = viewerId
      ? await this.getCompanyMembership(companyId, viewerId)
      : null;
    const isMember = !!membership;
    const company = await this.getCompany(companyId, {
      includePrivate: isMember,
    });
    if (!company) throw httpError("Company not found", 404);
    if (company.verificationStatus !== "verified" && !isMember) {
      throw httpError("Company not found", 404);
    }

    const { data, error } = await this.client()
      .from("job_postings")
      .select(
        `
        *,
        applications:job_applications(count),
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url)
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const ids = (data || []).map((row: any) => row.id as string);
    const { savedIds, appliedIds } = await this.viewerPostingFlags(
      viewerId,
      ids,
    );

    return {
      company,
      // Company pages are public; only the company's own members keep ATS wiring.
      jobs: (data || []).map((row: any) => {
        const posting = mapPosting(row, savedIds, appliedIds);
        return isMember ? posting : stripPrivatePostingFields(posting);
      }),
      myRole: (membership?.role as JobCompanyMemberRole | undefined) ?? null,
    };
  }

  async updateCompany(
    companyId: string,
    userId: string,
    input: {
      displayName?: string;
      website?: string | null;
      industry?: string | null;
      tagline?: string | null;
      about?: string | null;
      hqLocation?: string | null;
      verificationDomain?: string | null;
    },
  ) {
    const membership = await this.getCompanyMembership(companyId, userId);
    if (!canEditJobCompanyProfile(membership?.role)) {
      throw httpError("Only company members can edit this profile", 403);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.displayName !== undefined) {
      const displayName = clampJobCompanyText(
        input.displayName,
        JOB_COMPANY_NAME_MAX_LENGTH,
      );
      if (!displayName) throw httpError("displayName cannot be empty");
      patch.display_name = displayName;
    }
    if (input.website !== undefined) {
      patch.website =
        input.website === null || input.website === ""
          ? null
          : normalizeJobCompanyWebsite(input.website);
    }
    if (input.industry !== undefined) {
      patch.industry =
        input.industry === null || input.industry === ""
          ? null
          : clampJobCompanyText(input.industry, JOB_COMPANY_INDUSTRY_MAX_LENGTH);
    }
    if (input.tagline !== undefined) {
      patch.tagline =
        input.tagline === null || input.tagline === ""
          ? null
          : clampJobCompanyText(input.tagline, JOB_COMPANY_TAGLINE_MAX_LENGTH);
    }
    if (input.about !== undefined) {
      patch.about =
        input.about === null || input.about === ""
          ? null
          : clampJobCompanyText(input.about, JOB_COMPANY_ABOUT_MAX_LENGTH);
    }
    if (input.hqLocation !== undefined) {
      patch.hq_location =
        input.hqLocation === null || input.hqLocation === ""
          ? null
          : clampJobCompanyText(
              input.hqLocation,
              JOB_COMPANY_LOCATION_MAX_LENGTH,
            );
    }
    if (input.verificationDomain !== undefined) {
      patch.verification_domain =
        input.verificationDomain === null || input.verificationDomain === ""
          ? null
          : normalizeJobCompanyDomain(input.verificationDomain);
    }

    const { data, error } = await this.client()
      .from("job_companies")
      .update(patch)
      .eq("id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    return mapCompany(data, { includePrivate: true });
  }

  async uploadCompanyLogo(
    companyId: string,
    userId: string,
    input: { base64Data: string; fileName?: string },
  ) {
    const membership = await this.getCompanyMembership(companyId, userId);
    if (!canEditJobCompanyProfile(membership?.role)) {
      throw httpError("Only company members can update the logo", 403);
    }

    const raw = (input.base64Data || "").includes(",")
      ? (input.base64Data || "").split(",")[1]!
      : input.base64Data || "";
    const buffer = Buffer.from(raw, "base64");
    if (!buffer.length) throw httpError("Logo data is required");
    if (buffer.length > JOB_COMPANY_LOGO_MAX_BYTES) {
      throw httpError("Logo exceeds 2 MB limit");
    }

    const contentType = detectImageMime(buffer);
    if (!contentType) {
      throw httpError(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP)",
      );
    }
    const { normalized } = await processImageForUpload(buffer, "companyLogo", {
      detectedMime: contentType,
    });
    const safeCompany = companyId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filePath = `${safeCompany}/${Date.now()}-logo.${normalized.ext}`;

    const { error: uploadError } = await this.client()
      .storage.from(COMPANY_LOGO_BUCKET)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const logoUrl = companyLogoPublicUrl(filePath);
    const { data, error } = await this.client()
      .from("job_companies")
      .update({
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    return mapCompany(data);
  }

  async listCompanyMembers(companyId: string, userId: string) {
    const membership = await this.getCompanyMembership(companyId, userId);
    if (!membership) {
      throw httpError("Only company members can view the team", 403);
    }

    const { data, error } = await this.client()
      .from("job_company_members")
      .select(
        "*, user:profiles!user_id(id, name, username, avatar_url)",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(mapCompanyMember);
  }

  async inviteCompanyMember(
    companyId: string,
    actorId: string,
    input: { username: string; role?: JobCompanyMemberRole },
  ) {
    const actor = await this.getCompanyMembership(companyId, actorId);
    if (!canManageJobCompanyMembers(actor?.role)) {
      throw httpError("Only company owners can invite teammates", 403);
    }

    const role: JobCompanyMemberRole =
      input.role === "owner" ? "recruiter" : input.role || "recruiter";
    if (role !== "recruiter") {
      throw httpError("New teammates must join as recruiters");
    }

    const username = (input.username || "").trim().replace(/^@/, "");
    if (!username) throw httpError("username is required");

    const { count, error: countError } = await this.client()
      .from("job_company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (countError) throw countError;
    if ((count ?? 0) >= JOB_COMPANY_MEMBER_LIMIT) {
      throw httpError(
        `Company teams are limited to ${JOB_COMPANY_MEMBER_LIMIT} members`,
      );
    }

    const { data: profile, error: profileError } = await this.client()
      .from("profiles")
      .select("id, name, username, avatar_url")
      .ilike("username", username)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw httpError("No Lantern user found with that username", 404);

    const existing = await this.getCompanyMembership(companyId, profile.id);
    if (existing) throw httpError("That user is already on this company", 409);

    const { data, error } = await this.client()
      .from("job_company_members")
      .insert({
        company_id: companyId,
        user_id: profile.id,
        role,
      })
      .select(
        "*, user:profiles!user_id(id, name, username, avatar_url)",
      )
      .single();
    if (error) throw error;
    return mapCompanyMember(data);
  }

  async removeCompanyMember(
    companyId: string,
    actorId: string,
    targetUserId: string,
  ) {
    const actor = await this.getCompanyMembership(companyId, actorId);
    const target = await this.getCompanyMembership(companyId, targetUserId);
    if (!target) throw httpError("Member not found", 404);
    if (
      !canRemoveJobCompanyMember({
        actorRole: actor?.role,
        targetRole: target.role,
        actorUserId: actorId,
        targetUserId,
      })
    ) {
      throw httpError("You cannot remove that teammate", 403);
    }

    const { error } = await this.client()
      .from("job_company_members")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", targetUserId);
    if (error) throw error;
    return { removed: true };
  }

  async setCompanyVerification(
    companyId: string,
    status: "verified" | "rejected" | "pending" | "unverified",
    note?: string,
  ) {
    const { data, error } = await this.client()
      .from("job_companies")
      .update({
        verification_status: status,
        verification_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    return mapCompany(data);
  }

  async adminListPostings(page = 1, limit = 20, status?: string) {
    const from = (Math.max(1, page) - 1) * Math.min(100, limit);
    const to = from + Math.min(100, limit) - 1;
    let query = this.client()
      .from("job_postings")
      .select(
        "id, title, employment_type, status, created_at, views_count, poster_user_id, company_id, is_sponsored",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw error;
    // pages: every other admin pagination carries it, and PaginationBar
    // renders "Page X of pagination.pages" — undefined breaks the guard.
    return {
      data: data || [],
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / Math.min(100, limit)) || 1 },
    };
  }

  async adminListCompanies(page = 1, limit = 20, status?: string) {
    const from = (Math.max(1, page) - 1) * Math.min(100, limit);
    const to = from + Math.min(100, limit) - 1;
    let query = this.client()
      .from("job_companies")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("verification_status", status);
    const { data, error, count } = await query;
    if (error) throw error;
    return {
      data: (data || []).map((row: any) => mapCompany(row)),
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / Math.min(100, limit)) || 1 },
    };
  }

  async adminListReports(status = "pending") {
    const { data, error } = await this.client()
      .from("job_reports")
      .select("*, posting:job_postings(id, title, status)")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async resolveReport(reportId: string, status: "resolved" | "dismissed") {
    const { error } = await this.client()
      .from("job_reports")
      .update({ status })
      .eq("id", reportId);
    if (error) throw error;
  }

  async schoolApprovePosting(postingId: string, approve: boolean) {
    const status = approve ? "active" : "closed";
    if (approve) {
      /*
       * The third publish path, and the one that had no gate.
       *
       * `createPosting` and `updatePosting` both refuse template boilerplate,
       * but a posting can also reach `active` from here — the school approval
       * queue — and this write went straight to the column. A posting that
       * entered the queue before the gate existed, or whose copy was edited
       * while it waited, would go live carrying "[team / function]".
       * Publishing is publishing: the same rule applies.
       */
      const existing = await this.getPosting(postingId);
      const leftover = describeJobTemplateLeftovers(
        existing?.title,
        existing?.description,
      );
      if (leftover) throw httpError(leftover);
    }
    const { error } = await this.client()
      .from("job_postings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", postingId)
      .eq("status", "pending_school_approval");
    if (error) throw error;
    return this.getPosting(postingId);
  }

  private async fireAtsWebhook(posting: any, application: any) {
    try {
      if (!posting.atsWebhookUrl) return;
      // Defence in depth: rows written before URL validation existed (or
      // edited around it) are re-checked at fire time — never POST applicant
      // PII to an unvetted destination.
      const problem = atsWebhookUrlError(String(posting.atsWebhookUrl));
      if (problem) {
        logger.warn("Skipping ATS webhook with unsafe URL", {
          postingId: posting.id,
          problem,
        });
        return;
      }
      await fetch(posting.atsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application.created",
          provider: posting.atsProvider || "custom",
          externalJobId: posting.atsExternalId,
          postingId: posting.id,
          application,
        }),
      });
    } catch (err) {
      logger.warn("ATS webhook failed", { error: err, postingId: posting.id });
    }
  }

  /**
   * Poster-wide hiring funnel. Mirrors marketplace seller insights: one read of
   * the employer's posts plus the related applications / interviews / offers,
   * then pure aggregation in shared helpers.
   */
  async getEmployerAnalytics(userId: string): Promise<JobEmployerAnalytics> {
    const postings = (await this.listMyPostings(userId)).filter(
      (posting) => !!posting?.id,
    ) as JobPosting[];
    const postingIds = postings.map((posting) => posting.id);
    const now = new Date();

    if (!postingIds.length) {
      const emptyFunnel = buildJobHiringFunnel({
        statusCounts: emptyJobApplicationStatusCounts(),
      });
      return {
        totals: {
          postings: 0,
          activePostings: 0,
          views: 0,
          applications: 0,
          needsReview: 0,
          hired: 0,
          openOffers: 0,
        },
        funnel: emptyFunnel,
        conversion: jobConversionRates(emptyFunnel),
        avgTimeToFillDays: null,
        topPostings: [],
        attention: { highViewsLowApply: [], staleActive: [] },
        generatedAt: now.toISOString(),
      };
    }

    const [applications, favorites, externalClicks, offers] = await Promise.all(
      [
        this.client()
          .from("job_applications")
          .select("id, posting_id, status, created_at, updated_at")
          .in("posting_id", postingIds),
        this.client()
          .from("job_favorites")
          .select("posting_id")
          .in("posting_id", postingIds),
        this.client()
          .from("job_external_apply_clicks")
          .select("posting_id")
          .in("posting_id", postingIds),
        this.client()
          .from("job_offers")
          .select("posting_id, status")
          .in("posting_id", postingIds),
      ],
    );

    if (applications.error) throw applications.error;
    if (favorites.error) throw favorites.error;
    if (externalClicks.error) throw externalClicks.error;
    if (offers.error) throw offers.error;

    const appsByPosting = new Map<string, typeof applications.data>();
    for (const row of applications.data || []) {
      const key = (row as { posting_id: string }).posting_id;
      const list = appsByPosting.get(key) || [];
      list.push(row);
      appsByPosting.set(key, list);
    }

    const allStatuses = (applications.data || []).map(
      (row) => (row as { status: JobApplicationStatus }).status,
    );
    const funnel = buildJobHiringFunnel({
      views: postings.reduce(
        (sum, posting) => sum + (posting.viewsCount || 0),
        0,
      ),
      saved: (favorites.data || []).length,
      externalClicks: (externalClicks.data || []).length,
      statusCounts: countJobApplicationStatuses(allStatuses),
    });

    const timeToFillDays: number[] = [];
    const topPostings = postings.map((posting) => {
      const apps = appsByPosting.get(posting.id) || [];
      const statusCounts = countJobApplicationStatuses(
        apps.map((row) => (row as { status: JobApplicationStatus }).status),
      );
      const hiredApps = apps.filter(
        (row) => (row as { status: string }).status === "hired",
      );
      if (hiredApps.length) {
        const earliest = hiredApps
          .map((row) =>
            daysBetween(
              posting.createdAt,
              (row as { updated_at: string }).updated_at,
            ),
          )
          .filter((value): value is number => value != null)
          .sort((a, b) => a - b)[0];
        if (earliest != null) timeToFillDays.push(earliest);
      }
      return {
        id: posting.id,
        title: posting.title,
        status: posting.status,
        views: posting.viewsCount || 0,
        applications: apps.length,
        hired: statusCounts.hired,
        viewToApplyPercent: jobConversionRates(
          buildJobHiringFunnel({
            views: posting.viewsCount || 0,
            statusCounts,
          }),
        ).viewToApplyPercent,
      };
    });

    topPostings.sort((a, b) => {
      if (b.applications !== a.applications) {
        return b.applications - a.applications;
      }
      return b.views - a.views;
    });

    const highViewsLowApply = postings
      .filter((posting) =>
        isHighViewsLowApply({
          status: posting.status,
          views: posting.viewsCount || 0,
          applications: (appsByPosting.get(posting.id) || []).length,
        }),
      )
      .map((posting) => ({
        id: posting.id,
        title: posting.title,
        views: posting.viewsCount || 0,
        applications: (appsByPosting.get(posting.id) || []).length,
        daysOpen: daysBetween(posting.createdAt, now.toISOString()) || 0,
      }));

    const staleActive = postings
      .filter((posting) =>
        isStaleActivePosting({
          status: posting.status,
          createdAt: posting.createdAt,
          applications: (appsByPosting.get(posting.id) || []).length,
          now,
        }),
      )
      .map((posting) => ({
        id: posting.id,
        title: posting.title,
        views: posting.viewsCount || 0,
        applications: (appsByPosting.get(posting.id) || []).length,
        daysOpen: daysBetween(posting.createdAt, now.toISOString()) || 0,
      }));

    return {
      totals: {
        postings: postings.length,
        activePostings: postings.filter(
          (posting) => posting.status === "active",
        ).length,
        views: funnel.views,
        applications: funnel.applied,
        needsReview: funnel.needsReview,
        hired: funnel.hired,
        openOffers: (offers.data || []).filter(
          (row) => (row as { status: string }).status === "sent",
        ).length,
      },
      funnel,
      conversion: jobConversionRates(funnel),
      avgTimeToFillDays: averageNumber(timeToFillDays),
      topPostings: topPostings.slice(0, 8),
      attention: {
        highViewsLowApply: highViewsLowApply.slice(0, 5),
        staleActive: staleActive.slice(0, 5),
      },
      generatedAt: now.toISOString(),
    };
  }

  /** Per-posting funnel for the pipeline screen. */
  async getPostingAnalytics(
    postingId: string,
    userId: string,
  ): Promise<JobPostingAnalytics> {
    const posting = await this.getPosting(postingId);
    if (!posting) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    const allowed =
      posting.posterUserId === userId ||
      (posting.companyId &&
        (await this.getCompanyMembership(posting.companyId, userId)));
    if (!allowed) {
      const err = new Error("Not allowed");
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const [applications, favorites, externalClicks, interviews, offers] =
      await Promise.all([
        this.client()
          .from("job_applications")
          .select("id, status, created_at, updated_at")
          .eq("posting_id", postingId),
        this.client()
          .from("job_favorites")
          .select("id", { count: "exact", head: true })
          .eq("posting_id", postingId),
        this.client()
          .from("job_external_apply_clicks")
          .select("id", { count: "exact", head: true })
          .eq("posting_id", postingId),
        this.client()
          .from("job_interviews")
          .select("status")
          .eq("posting_id", postingId),
        this.client()
          .from("job_offers")
          .select("status")
          .eq("posting_id", postingId),
      ]);

    if (applications.error) throw applications.error;
    if (favorites.error) throw favorites.error;
    if (externalClicks.error) throw externalClicks.error;
    if (interviews.error) throw interviews.error;
    if (offers.error) throw offers.error;

    const statusCounts = countJobApplicationStatuses(
      (applications.data || []).map(
        (row) => (row as { status: JobApplicationStatus }).status,
      ),
    );
    const funnel = buildJobHiringFunnel({
      views: posting.viewsCount || 0,
      saved: favorites.count || 0,
      externalClicks: externalClicks.count || 0,
      statusCounts,
    });

    const hireDurations = (applications.data || [])
      .filter((row) => (row as { status: string }).status === "hired")
      .map((row) =>
        daysBetween(
          (row as { created_at: string }).created_at,
          (row as { updated_at: string }).updated_at,
        ),
      )
      .filter((value): value is number => value != null);

    const firstHireUpdated = (applications.data || [])
      .filter((row) => (row as { status: string }).status === "hired")
      .map((row) => (row as { updated_at: string }).updated_at)
      .sort()[0];
    const timeToFillDays = firstHireUpdated
      ? daysBetween(posting.createdAt, firstHireUpdated)
      : null;

    const interviewCounts = {
      proposed: 0,
      confirmed: 0,
      completed: 0,
      declined: 0,
      cancelled: 0,
    };
    for (const row of interviews.data || []) {
      const status = (row as { status: keyof typeof interviewCounts }).status;
      if (status in interviewCounts) interviewCounts[status] += 1;
    }

    const offerCounts = {
      sent: 0,
      accepted: 0,
      declined: 0,
      withdrawn: 0,
      expired: 0,
    };
    for (const row of offers.data || []) {
      const status = (row as { status: keyof typeof offerCounts }).status;
      if (status in offerCounts) offerCounts[status] += 1;
    }

    return {
      postingId: posting.id,
      title: posting.title,
      status: posting.status,
      createdAt: posting.createdAt,
      funnel,
      conversion: jobConversionRates(funnel),
      timeToFillDays,
      medianTimeToHireDays: medianNumber(hireDurations),
      interviews: interviewCounts,
      offers: offerCounts,
    };
  }
}

let jobsBoardService: JobsBoardService | null = null;

export function getJobsBoardService(
  data: DataLayer,
): JobsBoardService {
  if (!jobsBoardService) jobsBoardService = new JobsBoardService(data);
  return jobsBoardService;
}
