/**
 * Web wrappers for the Phase 1 · E moderation routes (reports, appeals, own
 * strike/suspension state). Mirrors the shared endpoint shapes in
 * packages/shared/src/api/endpoints.ts; the web talks to the API through its
 * own fetch layer (services/supabase.ts), so these live next to it.
 */
import type {
  ContentReportReason,
  ContentReportStatus,
  ContentReportTargetType,
  ListingAppealStatus,
  ModerationState,
} from '@lantern/shared';
import { getApiRoot, getAuthHeaders } from './supabase';
import { noteSuspendedResponse } from './accountSuspension';

type ApiError = Error & { status?: number };

async function moderationRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${getApiRoot()}/api/v1${path}`, {
      ...init,
      headers: { ...(await getAuthHeaders()), ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
  clearTimeout(timeoutId);
  if (response.status === 403) void noteSuspendedResponse(response);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    const error = new Error(body.error || body.message || `Request failed (${response.status})`) as ApiError;
    error.status = response.status;
    throw error;
  }
  const json = (await response.json().catch(() => ({}))) as { data?: T };
  return json.data as T;
}

/**
 * Generic content report. `reason` must be one of reasonsForTarget(targetType);
 * the API answers 409 (surfaced as error.status 409) when this user already
 * reported the target.
 */
export async function reportContent(input: {
  targetType: ContentReportTargetType;
  targetId: string;
  reason: ContentReportReason;
  details?: string;
}): Promise<{ id: string; status: ContentReportStatus }> {
  return moderationRequest('/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Seller appeal of a moderation takedown (one shot; 409 if already appealed). */
export async function appealListingTakedown(
  listingId: string,
  note: string,
): Promise<{ id: string; status: string; appeal_status: ListingAppealStatus; appealed_at: string }> {
  return moderationRequest(`/marketplace/listings/${encodeURIComponent(listingId)}/appeal`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/** Caller's own active strike count + suspension state. */
export async function fetchMyModerationState(): Promise<ModerationState> {
  return moderationRequest('/users/me/moderation', { method: 'GET' }, 8000);
}
