import { getApiBaseUrl } from '@lantern/shared';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollApiJob<T>(
  jobId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<T> {
  const deadline = Date.now() + (options?.timeoutMs ?? 180_000);
  const intervalMs = options?.intervalMs ?? 1500;

  while (Date.now() < deadline) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}`, { headers });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { status?: string; result?: T; error?: string };
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || `Job status check failed (${response.status})`);
    }

    const job = payload.data ?? payload;
    const status = (job as { status?: string }).status;
    if (status === 'completed') {
      const result = (job as { result?: T }).result;
      if (result !== undefined) return result;
      throw new Error('AI job completed without a result.');
    }
    if (status === 'failed') {
      const err = (job as { error?: string }).error;
      throw new Error(typeof err === 'string' && err ? err : 'AI job failed.');
    }

    await sleep(intervalMs);
  }

  throw new Error('AI request timed out. Try again in a moment.');
}
