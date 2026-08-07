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
          body: '{}',
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
