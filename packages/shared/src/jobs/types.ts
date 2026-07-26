import type { JobEmploymentType } from "./employmentTypes";

export type JobPostingStatus =
  | "draft"
  | "active"
  | "paused"
  | "closed"
  | "pending_school_approval"
  | "suspended_by_admin"
  | "removed_by_admin";

export type JobApplyMode = "in_app" | "external" | "both";

export type JobCompensationKind = "paid" | "unpaid" | "discuss";

export type JobCompensationPeriod =
  | "hour"
  | "day"
  | "week"
  | "month"
  | "total"
  | "stipend";

export interface JobCompensation {
  kind: JobCompensationKind;
  currency?: string;
  amountMin?: number | null;
  amountMax?: number | null;
  period?: JobCompensationPeriod | null;
  notes?: string | null;
}

export type JobEngagementDuration =
  | { kind: "ongoing"; value?: null; unit?: null }
  | {
      kind: "fixed";
      value: number;
      unit: "day" | "week" | "month";
    };

export type JobCompanyVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";

export type JobApplicationStatus =
  | "interested"
  | "chatting"
  | "new"
  | "reviewing"
  | "interview"
  | "offer"
  | "hired"
  | "rejected"
  | "withdrawn";

export type JobCompanyMemberRole = "owner" | "recruiter";

export interface JobCompany {
  id: string;
  legalName: string;
  displayName: string;
  website?: string | null;
  logoUrl?: string | null;
  industry?: string | null;
  /** One-line pitch shown under the company name on the public page. */
  tagline?: string | null;
  /** Longer about copy for the public company page. */
  about?: string | null;
  /** City / HQ line shown on the public page. */
  hqLocation?: string | null;
  countryCode: string;
  verificationStatus: JobCompanyVerificationStatus;
  verificationDomain?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A teammate on a company account (owner or recruiter). */
export interface JobCompanyMember {
  id: string;
  companyId: string;
  userId: string;
  role: JobCompanyMemberRole;
  user?: {
    id: string;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  createdAt: string;
}

export interface JobScreeningQuestion {
  id: string;
  postingId: string;
  sortOrder: number;
  prompt: string;
  questionType: "text" | "single_choice";
  options?: string[] | null;
  required: boolean;
}

export interface JobPosting {
  id: string;
  title: string;
  description: string;
  employmentType: JobEmploymentType;
  campusId?: string | null;
  campusIds?: string[];
  locationText?: string | null;
  isRemote: boolean;
  compensation: JobCompensation;
  engagementDuration?: JobEngagementDuration | null;
  deadline?: string | null;
  applyMode: JobApplyMode;
  externalUrl?: string | null;
  posterUserId: string;
  companyId?: string | null;
  status: JobPostingStatus;
  viewsCount: number;
  isSponsored: boolean;
  sponsoredUntil?: string | null;
  atsProvider?: string | null;
  atsExternalId?: string | null;
  atsWebhookUrl?: string | null;
  requiresSchoolApproval: boolean;
  countryCode: string;
  screeningQuestions?: JobScreeningQuestion[];
  /** Whether the requesting viewer saved this posting. Absent for anonymous reads. */
  isSaved?: boolean;
  /** Applications received. Only returned to the poster on their own dashboard. */
  applicationsCount?: number;
  /** Subset of `applicationsCount` the employer has not triaged yet. */
  newApplicationsCount?: number;
  company?: JobCompany | null;
  poster?: {
    id: string;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  campusName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplication {
  id: string;
  postingId: string;
  applicantId: string;
  answers: Record<string, string>;
  resumeUrl?: string | null;
  /** Storage path in the private job-resumes bucket. Read via a signed URL. */
  resumePath?: string | null;
  resumeFilename?: string | null;
  status: JobApplicationStatus;
  dmThreadId?: string | null;
  source: "in_app" | "external_click";
  profileSnapshot?: Record<string, unknown> | null;
  posting?: JobPosting | null;
  applicant?: {
    id: string;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  /** Private recruiter notes on this application. Never sent to the applicant. */
  notesCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A private note the hiring side keeps on an application. Visible to the
 * posting owner and the posting company's members, never to the candidate.
 */
export interface JobApplicationNote {
  id: string;
  applicationId: string;
  authorId: string;
  body: string;
  author?: {
    id: string;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reusable applicant details so a candidate does not re-enter the same
 * information (and re-upload the same resume) for every application.
 */
export interface JobApplicantProfile {
  userId: string;
  headline?: string | null;
  phone?: string | null;
  locationText?: string | null;
  resumePath?: string | null;
  resumeFilename?: string | null;
  resumeSizeBytes?: number | null;
  resumeUploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobReport {
  id: string;
  postingId: string;
  reporterId: string;
  reason: "scam" | "spam" | "inappropriate" | "discriminatory" | "other";
  details?: string | null;
  status: "pending" | "resolved" | "dismissed";
  createdAt: string;
}

export type JobsWorkspaceSection =
  | "goods"
  | "jobs"
  | "my_applications"
  | "my_jobs"
  | "employer";
