import { getAuthHeaders, getApiRoot, withApiCredentials } from './supabase';
import { handleApiAuthFailure } from './sessionHandler';

/** Gate for the presence heartbeat effect — must match lifecycle/gamification auth readiness. */
export function shouldRunPresenceHeartbeat(opts: {
  userId?: string | null;
  authTokenReady: boolean;
  showOnlineStatus: boolean;
}): boolean {
  return Boolean(opts.userId && opts.authTokenReady && opts.showOnlineStatus);
}

/**
 * Phase 3 M — study intent rides the EXISTING heartbeat.
 *
 * Screens declare what the user is studying by calling setStudyIntent(); the
 * heartbeat already running for online status carries it. This is deliberately
 * NOT a second timer: doubling the beat would double the write rate on a table
 * every study screen touches, for no extra signal.
 *
 * The server is the privacy enforcement point — a user who has switched off
 * showStudyActivity or showOnlineStatus is never written to study_presence
 * even if a screen sets an intent here.
 */
export interface StudyIntent {
  context?: 'studying' | 'reviewing' | 'testing' | 'reading' | 'writing';
  courseId?: string;
  topic?: string;
}

let currentStudyIntent: StudyIntent | null = null;

export function setStudyIntent(intent: StudyIntent | null): void {
  currentStudyIntent = intent;
}

export function getStudyIntent(): StudyIntent | null {
  return currentStudyIntent;
}

/**
 * POST presence heartbeat.
 * Returns false when there is no bearer token or an unrecovered 401/403
 * (caller should stop the interval so we don't spam Unauthorized).
 */
export async function sendPresenceHeartbeat(): Promise<boolean> {
  try {
    const doFetch = async (): Promise<Response | null> => {
      const headers = await getAuthHeaders();
      // Avoid noisy 401s when UI has a cached user but no API session yet.
      if (!headers.Authorization) return null;
      return fetch(
        `${getApiRoot()}/api/v1/users/presence/heartbeat`,
        withApiCredentials({
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          // Carries study intent when a study screen has declared one; an
          // empty body keeps the original online-status-only behaviour.
          body: JSON.stringify(currentStudyIntent ?? {}),
        })
      );
    };

    let response = await doFetch();
    if (!response) return false;

    if (response.status === 401 || response.status === 403) {
      if (await handleApiAuthFailure(response.status)) {
        response = await doFetch();
        if (!response) return false;
        if (response.status === 401 || response.status === 403) return false;
      } else {
        return false;
      }
    }

    return true;
  } catch {
    // Network blip — keep the interval alive.
    return true;
  }
}
