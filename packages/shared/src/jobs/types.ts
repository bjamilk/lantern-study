import type { JobEmploymentType } from './employmentTypes';

export type JobPostingStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'closed'
  | 'pending_school_approval'
  | 'suspended_by_admin'
  | 'removed_by_admin';

export type JobApplyMode = 'in_app' | 'external' | 'both';

export type JobCompensationKind = 'paid' | 'unpaid' | 'discuss';

export type JobCompensationPeriod = 'hour' | 'day' | 'week' | 'month' | 'total' | 'stipend';

export interface JobCompensation {
  kind: JobCompensationKind;
  currency?: string;
  amountMin?: number | null;
  amountMax?: number | null;
  period?: JobCompensationPeriod | null;
  notes?: string | null;
}

export type JobEngagementDuration =
  | { kind: 'ongoing'; value?: null; unit?: null }
  | {
      kind: 'fixed';
      value: number;
      unit: 'day' | 'week' | 'month';
    };

export type JobCompanyVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected';

export type JobApplicationStatus =
  | 'interested'
  | 'chatting'
  | 'new'
  | 'reviewing'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export type JobCompanyMemberRole = 'owner' | 'recruiter';

export interface JobCompany {
  id: string;
  legalName: string;
  displayName: string;
  website?: string | null;
  logoUrl?: string | null;
  industry?: string | null;
  countryCode: string;
  verificationStatus: JobCompanyVerificationStatus;
  verificationDomain?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobScreeningQuestion {
  id: string;
  postingId: string;
  sortOrder: number;
  prompt: string;
  questionType: 'text' | 'single_choice';
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
  company?: JobCompany | null;
  poster?: { id: string; name?: string | null; username?: string | null; avatarUrl?: string | null } | null;
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
  status: JobApplicationStatus;
  dmThreadId?: string | null;
  source: 'in_app' | 'external_click';
  profileSnapshot?: Record<string, unknown> | null;
  posting?: JobPosting | null;
  applicant?: { id: string; name?: string | null; username?: string | null; avatarUrl?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobReport {
  id: string;
  postingId: string;
  reporterId: string;
  reason: 'scam' | 'spam' | 'inappropriate' | 'discriminatory' | 'other';
  details?: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}

export type JobsWorkspaceSection =
  | 'goods'
  | 'jobs'
  | 'my_applications'
  | 'my_jobs'
  | 'employer';
