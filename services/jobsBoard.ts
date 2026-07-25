/** Web client for /api/v1/jobs-board */
import { getApiBaseUrl, type JobApplication, type JobPosting } from '@lantern/shared';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

async function jobsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1/jobs-board${path}`, {
    ...options,
    headers: {
      ...(await getAuthHeaders()),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Jobs request failed (${response.status})`);
  }
  return json as T;
}

export async function fetchJobPostings(filters: {
  page?: number;
  limit?: number;
  search?: string;
  employmentType?: string;
  campusId?: string;
  companyOnly?: boolean;
} = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  });
  return jobsRequest<{
    success: boolean;
    data: JobPosting[];
    pagination: { page: number; limit: number; total: number };
  }>(`/postings?${params.toString()}`);
}

export async function fetchJobPosting(id: string) {
  return jobsRequest<{ success: boolean; data: JobPosting }>(`/postings/${encodeURIComponent(id)}`);
}

export async function createJobPosting(body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: JobPosting }>('/postings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateJobPosting(id: string, body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: JobPosting }>(
    `/postings/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}

export async function fetchMyJobPostings() {
  return jobsRequest<{ success: boolean; data: JobPosting[] }>('/my-postings');
}

export async function applyToJob(
  id: string,
  body: { message?: string; answers?: Record<string, string>; resumeUrl?: string | null }
) {
  return jobsRequest<{
    success: boolean;
    data: JobApplication;
    threadId?: string;
    existing?: boolean;
  }>(`/postings/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function trackJobExternalApply(id: string) {
  return jobsRequest<{ success: boolean; data: { url: string } }>(
    `/postings/${encodeURIComponent(id)}/external-apply`,
    { method: 'POST' }
  );
}

export async function fetchMyJobApplications() {
  return jobsRequest<{ success: boolean; data: JobApplication[] }>('/my-applications');
}

export async function fetchJobApplicants(postingId: string) {
  return jobsRequest<{ success: boolean; data: JobApplication[] }>(
    `/postings/${encodeURIComponent(postingId)}/applications`
  );
}

export async function updateJobApplicationStatus(
  applicationId: string,
  body: { status: string; asApplicant?: boolean }
) {
  return jobsRequest<{ success: boolean; data: JobApplication }>(
    `/applications/${encodeURIComponent(applicationId)}/status`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}

export async function reportJobPosting(id: string, body: { reason: string; details?: string }) {
  return jobsRequest<{ success: boolean; data: unknown }>(
    `/postings/${encodeURIComponent(id)}/reports`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function createJobCompany(body: Record<string, unknown>) {
  return jobsRequest<{ success: boolean; data: unknown }>('/companies', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchMyJobCompanies() {
  return jobsRequest<{ success: boolean; data: Array<{ role: string; company: unknown }> }>(
    '/companies/mine'
  );
}

export async function fetchJobTemplates() {
  return jobsRequest<{ success: boolean; data: unknown }>('/templates');
}
