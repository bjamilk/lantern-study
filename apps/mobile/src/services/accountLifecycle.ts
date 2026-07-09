import { API_BASE_URL, getAuthHeaders } from './supabase';
import type { AccountLifecycleInfo } from '@lantern/shared/accountLifecycle';

async function lifecycleRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/users${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Request failed (${response.status})`);
  }
  return (json.data ?? json) as T;
}

export async function fetchAccountLifecycle(userId: string): Promise<AccountLifecycleInfo> {
  return lifecycleRequest<AccountLifecycleInfo>(`/${userId}/lifecycle`);
}

export async function deactivateUserAccount(userId: string): Promise<{
  deletionScheduledAt: string;
  deactivatedAt: string;
  gracePeriodDays: number;
  message?: string;
}> {
  return lifecycleRequest(`/${userId}/deactivate`, { method: 'POST' });
}

export async function reactivateUserAccount(userId: string): Promise<void> {
  await lifecycleRequest(`/${userId}/reactivate`, { method: 'POST' });
}

export async function deleteUserAccountImmediate(userId: string, password: string): Promise<void> {
  await lifecycleRequest(`/${userId}/delete-immediate`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function importUserAccountBackup(
  userId: string,
  payload: { archive: unknown; password: string }
): Promise<{ message?: string }> {
  return lifecycleRequest(`/${userId}/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
