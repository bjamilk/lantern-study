import * as FileSystem from "expo-file-system/legacy";
import { validateJobResume } from "@lantern/shared";
import { API_BASE_URL, getAuthHeaders } from "./supabase";
import type {
  JobApplicantProfile,
  JobApplication,
  JobApplicationNote,
  JobPosting,
  JobSavedSearch,
  JobSearchFilters,
} from "@lantern/shared";

async function jobsRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/jobs-board${path}`, {
    ...options,
    headers: {
      ...headers,
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
  }>(`/postings?${params}`);
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
 * Uploads the picked document straight to Storage from its local URI, then
 * records it on the caller's applicant profile.
 */
export async function uploadJobResume(file: {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
}) {
  const validationError = validateJobResume({
    name: file.name,
    size: file.size,
    type: file.mimeType,
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
    body: JSON.stringify({ filename: file.name, sizeBytes: file.size ?? null }),
  });

  const { path, signedUrl, contentType } = prepared.data;
  const uploadResult = await FileSystem.uploadAsync(signedUrl, file.uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType, "x-upsert": "false" },
  });
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error("Resume upload failed. Please try again.");
  }

  return jobsRequest<{ success: boolean; data: JobApplicantProfile }>(
    "/resume",
    {
      method: "POST",
      body: JSON.stringify({
        path,
        filename: file.name,
        sizeBytes: file.size ?? null,
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

export async function deleteJobApplicationNote(noteId: string) {
  return jobsRequest<{ success: boolean; data: { id: string } }>(
    `/application-notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE" },
  );
}

export async function createJobCompany(body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: unknown }>("/companies", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMyJobCompanies() {
  return jobsRequest<{ success: boolean; data: unknown[] }>("/companies/mine");
}
