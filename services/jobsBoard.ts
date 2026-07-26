/** Web client for /api/v1/jobs-board */
import {
  getApiBaseUrl,
  validateJobResume,
  type JobApplicantProfile,
  type JobApplication,
  type JobApplicationNote,
  type JobApplicationStatus,
  type JobCompensation,
  type JobEmployerAnalytics,
  type JobEngagementDuration,
  type JobInterview,
  type JobInterviewMode,
  type JobOffer,
  type JobPosting,
  type JobPostingAnalytics,
  type JobSavedSearch,
  type JobSearchFilters,
} from "@lantern/shared";
import { getAuthHeaders } from "./supabase";

/** Fields the employer sets when proposing or re-proposing interview times. */
export type JobInterviewDraft = {
  mode: JobInterviewMode;
  durationMinutes: number;
  proposedSlots: string[];
  locationText?: string;
  details?: string;
};

/** Terms the employer sets when sending an offer. */
export type JobOfferDraft = {
  compensation: JobCompensation;
  startDate?: string | null;
  engagementDuration?: JobEngagementDuration | null;
  locationText?: string;
  details?: string;
  expiresAt?: string;
  closePostingOnAccept?: boolean;
};

const API_BASE_URL = getApiBaseUrl();

async function jobsRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1/jobs-board${path}`, {
    ...options,
    headers: {
      ...(await getAuthHeaders()),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      json.error || json.message || `Jobs request failed (${response.status})`,
    );
  }
  return json as T;
}

export async function fetchJobPostings(
  filters: {
    page?: number;
    limit?: number;
    search?: string;
    employmentType?: string;
    campusId?: string;
    companyOnly?: boolean;
    remote?: boolean;
    compensationKind?: "paid" | "unpaid" | "discuss";
    sort?: "newest" | "closing";
  } = {},
) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  });
  return jobsRequest<{
    success: boolean;
    data: JobPosting[];
    pagination: { page: number; limit: number; total: number };
  }>(`/postings?${params.toString()}`);
}

export async function fetchJobPosting(id: string) {
  return jobsRequest<{ success: boolean; data: JobPosting }>(
    `/postings/${encodeURIComponent(id)}`,
  );
}

export async function createJobPosting(body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: JobPosting }>("/postings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateJobPosting(
  id: string,
  body: Record<string, unknown>,
) {
  return jobsRequest<{ success: boolean; data: JobPosting }>(
    `/postings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function fetchSavedJobPostings() {
  return jobsRequest<{ success: boolean; data: JobPosting[] }>("/saved");
}

export async function fetchJobSavedSearches() {
  return jobsRequest<{ success: boolean; data: JobSavedSearch[] }>(
    "/saved-searches",
  );
}

export async function createJobSavedSearch(body: {
  name?: string;
  filters: JobSearchFilters;
  notify?: boolean;
}) {
  return jobsRequest<{ success: boolean; data: JobSavedSearch }>(
    "/saved-searches",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function updateJobSavedSearch(
  id: string,
  body: { name?: string; filters?: JobSearchFilters; notify?: boolean },
) {
  return jobsRequest<{ success: boolean; data: JobSavedSearch }>(
    `/saved-searches/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function deleteJobSavedSearch(id: string) {
  return jobsRequest<{ success: boolean; data: { id: string } }>(
    `/saved-searches/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function setJobPostingSaved(id: string, saved: boolean) {
  return jobsRequest<{
    success: boolean;
    data: { postingId: string; isSaved: boolean };
  }>(`/postings/${encodeURIComponent(id)}/save`, {
    method: saved ? "PUT" : "DELETE",
  });
}

export async function fetchMyJobPostings() {
  return jobsRequest<{ success: boolean; data: JobPosting[] }>("/my-postings");
}

export async function fetchJobEmployerAnalytics() {
  return jobsRequest<{ success: boolean; data: JobEmployerAnalytics }>(
    "/analytics/employer",
  );
}

export async function fetchJobPostingAnalytics(postingId: string) {
  return jobsRequest<{ success: boolean; data: JobPostingAnalytics }>(
    `/postings/${encodeURIComponent(postingId)}/analytics`,
  );
}

export async function fetchJobApplicantProfile() {
  return jobsRequest<{ success: boolean; data: JobApplicantProfile | null }>(
    "/applicant-profile",
  );
}

export async function saveJobApplicantProfile(body: {
  headline?: string | null;
  phone?: string | null;
  locationText?: string | null;
}) {
  return jobsRequest<{ success: boolean; data: JobApplicantProfile }>(
    "/applicant-profile",
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export async function fetchJobApplicationResumeUrl(applicationId: string) {
  return jobsRequest<{
    success: boolean;
    data: { url: string; filename: string | null; external: boolean };
  }>(`/applications/${encodeURIComponent(applicationId)}/resume`);
}

/**
 * Uploads straight to Supabase Storage using a short-lived signed URL, then
 * records the object on the caller's applicant profile.
 */
export async function uploadJobResume(file: File) {
  const validationError = validateJobResume({
    name: file.name,
    size: file.size,
    type: file.type,
  });
  if (validationError) throw new Error(validationError);

  const prepared = await jobsRequest<{
    success: boolean;
    data: {
      bucket: string;
      path: string;
      token: string;
      signedUrl: string;
      contentType: string;
    };
  }>("/resume/upload-url", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
  });

  const { bucket, path, token, signedUrl, contentType } = prepared.data;
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-upsert": "false" },
    body: file,
  });
  if (!response.ok) {
    // Fall back to the supabase-js helper, which handles some proxy quirks.
    const { supabase } = await import("./supabase");
    const { error } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(path, token, file, { contentType });
    if (error) throw new Error(error.message || "Resume upload failed");
  }

  return jobsRequest<{ success: boolean; data: JobApplicantProfile }>(
    "/resume",
    {
      method: "POST",
      body: JSON.stringify({
        path,
        filename: file.name,
        sizeBytes: file.size,
      }),
    },
  );
}

export async function applyToJob(
  id: string,
  body: {
    message?: string;
    answers?: Record<string, string>;
    resumeUrl?: string | null;
    resumePath?: string | null;
    resumeFilename?: string | null;
  },
) {
  return jobsRequest<{
    success: boolean;
    data: JobApplication;
    threadId?: string;
    existing?: boolean;
  }>(`/postings/${encodeURIComponent(id)}/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function trackJobExternalApply(id: string) {
  return jobsRequest<{ success: boolean; data: { url: string } }>(
    `/postings/${encodeURIComponent(id)}/external-apply`,
    { method: "POST" },
  );
}

export async function fetchMyJobApplications() {
  return jobsRequest<{ success: boolean; data: JobApplication[] }>(
    "/my-applications",
  );
}

export async function fetchJobApplicants(postingId: string) {
  return jobsRequest<{ success: boolean; data: JobApplication[] }>(
    `/postings/${encodeURIComponent(postingId)}/applications`,
  );
}

export async function exportJobApplicantsCsv(postingId: string) {
  return jobsRequest<{
    success: boolean;
    data: { csv: string; filename: string; rowCount: number };
  }>(`/postings/${encodeURIComponent(postingId)}/applications/export`);
}

export async function bulkUpdateJobApplicationStatus(
  postingId: string,
  body: { applicationIds: string[]; status: JobApplicationStatus },
) {
  return jobsRequest<{
    success: boolean;
    data: {
      updated: JobApplication[];
      status: JobApplicationStatus;
      count: number;
    };
  }>(`/postings/${encodeURIComponent(postingId)}/applications/bulk-status`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateJobApplicationStatus(
  applicationId: string,
  body: { status: string; asApplicant?: boolean },
) {
  return jobsRequest<{ success: boolean; data: JobApplication }>(
    `/applications/${encodeURIComponent(applicationId)}/status`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function fetchJobApplicationNotes(applicationId: string) {
  return jobsRequest<{ success: boolean; data: JobApplicationNote[] }>(
    `/applications/${encodeURIComponent(applicationId)}/notes`,
  );
}

export async function createJobApplicationNote(
  applicationId: string,
  body: string,
) {
  return jobsRequest<{ success: boolean; data: JobApplicationNote }>(
    `/applications/${encodeURIComponent(applicationId)}/notes`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export async function fetchJobInterviews(applicationId: string) {
  return jobsRequest<{ success: boolean; data: JobInterview[] }>(
    `/applications/${encodeURIComponent(applicationId)}/interviews`,
  );
}

export async function fetchMyJobInterviews() {
  return jobsRequest<{
    success: boolean;
    data: Array<JobInterview & { postingTitle?: string }>;
  }>("/my-interviews");
}

export async function scheduleJobInterview(
  applicationId: string,
  body: JobInterviewDraft,
) {
  return jobsRequest<{ success: boolean; data: JobInterview }>(
    `/applications/${encodeURIComponent(applicationId)}/interviews`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function rescheduleJobInterview(
  interviewId: string,
  body: JobInterviewDraft,
) {
  return jobsRequest<{ success: boolean; data: JobInterview }>(
    `/interviews/${encodeURIComponent(interviewId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function setJobInterviewStatus(
  interviewId: string,
  status: "cancelled" | "completed",
) {
  return jobsRequest<{ success: boolean; data: JobInterview }>(
    `/interviews/${encodeURIComponent(interviewId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}

export async function respondToJobInterview(
  interviewId: string,
  action: "accept" | "decline",
  slot?: string,
) {
  return jobsRequest<{ success: boolean; data: JobInterview }>(
    `/interviews/${encodeURIComponent(interviewId)}/respond`,
    { method: "POST", body: JSON.stringify({ action, slot }) },
  );
}

export async function fetchJobOffers(applicationId: string) {
  return jobsRequest<{ success: boolean; data: JobOffer[] }>(
    `/applications/${encodeURIComponent(applicationId)}/offers`,
  );
}

export async function fetchMyJobOffers() {
  return jobsRequest<{
    success: boolean;
    data: Array<JobOffer & { postingTitle?: string }>;
  }>("/my-offers");
}

export async function sendJobOffer(applicationId: string, body: JobOfferDraft) {
  return jobsRequest<{ success: boolean; data: JobOffer }>(
    `/applications/${encodeURIComponent(applicationId)}/offers`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function withdrawJobOffer(offerId: string) {
  return jobsRequest<{ success: boolean; data: JobOffer }>(
    `/offers/${encodeURIComponent(offerId)}`,
    { method: "PATCH", body: JSON.stringify({ status: "withdrawn" }) },
  );
}

export async function respondToJobOffer(
  offerId: string,
  action: "accept" | "decline",
  declineReason?: string,
) {
  return jobsRequest<{
    success: boolean;
    /** `postingClosed` reports whether accepting also closed the job. */
    data: JobOffer & { postingClosed?: boolean };
  }>(`/offers/${encodeURIComponent(offerId)}/respond`, {
    method: "POST",
    body: JSON.stringify({ action, declineReason }),
  });
}

export async function deleteJobApplicationNote(noteId: string) {
  return jobsRequest<{ success: boolean; data: { id: string } }>(
    `/application-notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE" },
  );
}

export async function reportJobPosting(
  id: string,
  body: { reason: string; details?: string },
) {
  return jobsRequest<{ success: boolean; data: unknown }>(
    `/postings/${encodeURIComponent(id)}/reports`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function createJobCompany(body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: unknown }>("/companies", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMyJobCompanies() {
  return jobsRequest<{
    success: boolean;
    data: Array<{ role: string; company: unknown }>;
  }>("/companies/mine");
}

export async function fetchJobTemplates() {
  return jobsRequest<{ success: boolean; data: unknown }>("/templates");
}
