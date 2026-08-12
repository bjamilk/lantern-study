/**
 * Re-fetch the account-scoped data that the app otherwise only loads once, at
 * login bootstrap (see RootNavigator).
 *
 * Without this the app drifts: a notification read on the web (or in an earlier
 * session) still shows unread here, the tab badge only ever climbs because
 * realtime increments it and nothing reconciles, and cards reviewed elsewhere
 * stay "due" until the app is force-quit and relaunched. Screens stay mounted
 * inside the navigator, so their mount effects never run a second time.
 *
 * Call this on app foreground and on screen focus. It is throttled and
 * de-duplicated so those triggers can fire freely.
 */
import { fetchAIUsage } from './ai';
import { getAuthHeaders } from './supabase';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useGroupStore } from '../stores/groupStore';
import { useNotificationStore } from '../stores/notificationStore';

/** Slices a caller can ask for. Omitting `only` refreshes everything. */
export type RefreshSlice = 'notifications' | 'flashcards' | 'chat' | 'aiUsage';

const ALL_SLICES: RefreshSlice[] = ['notifications', 'flashcards', 'chat', 'aiUsage'];

/** Long enough that tab-switching cannot hammer the API, short enough to feel live. */
const DEFAULT_MIN_INTERVAL_MS = 20_000;

const lastRefreshAt = new Map<string, number>();
let inFlight: Promise<void> | null = null;
let inFlightUserId: string | null = null;

const throttleKey = (userId: string, slice: RefreshSlice) => `${userId}:${slice}`;

/** Drop throttle state so the next call refetches immediately (sign-out, tests). */
export function resetDataRefresh(): void {
  lastRefreshAt.clear();
  inFlight = null;
  inFlightUserId = null;
}

export interface RefreshUserDataOptions {
  /** Ignore the throttle (pull-to-refresh, explicit user action). */
  force?: boolean;
  /** Override the minimum gap between refreshes of the same slice. */
  minIntervalMs?: number;
  /** Restrict the refresh to specific slices. */
  only?: RefreshSlice[];
}

/**
 * Refresh server state for `userId`. Never throws — a failed slice leaves the
 * cached data in place, exactly as the bootstrap fan-out does.
 */
export async function refreshUserData(
  userId: string | undefined | null,
  options: RefreshUserDataOptions = {}
): Promise<void> {
  if (!userId) return;

  const {
    force = false,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    only = ALL_SLICES,
  } = options;

  // A refresh already running for this user covers this caller too.
  if (inFlight && inFlightUserId === userId) return inFlight;

  const now = Date.now();
  const slices = only.filter(slice => {
    if (force) return true;
    const last = lastRefreshAt.get(throttleKey(userId, slice)) ?? 0;
    return now - last >= minIntervalMs;
  });
  if (slices.length === 0) return;

  const run = async () => {
    // Same guard as bootstrap: without a Bearer token the fan-out just races
    // into 401s, and a failed refresh signs the user out.
    const headers = await getAuthHeaders();
    if (!headers.Authorization) return;

    const tasks: Array<Promise<unknown>> = [];
    for (const slice of slices) {
      switch (slice) {
        case 'notifications':
          tasks.push(useNotificationStore.getState().loadUnreadCount(userId));
          break;
        case 'flashcards':
          // fetchDecks also runs syncAllFlashcards, which prefers pending local
          // reviews — so refreshing mid-session cannot resurrect graded cards.
          tasks.push(useFlashcardStore.getState().fetchDecks(userId));
          break;
        case 'chat':
          tasks.push(useGroupStore.getState().fetchGroups(userId));
          tasks.push(useGroupStore.getState().fetchDmThreads(userId));
          break;
        case 'aiUsage':
          tasks.push(fetchAIUsage(userId));
          break;
      }
    }

    await Promise.allSettled(tasks);
    const finishedAt = Date.now();
    for (const slice of slices) {
      lastRefreshAt.set(throttleKey(userId, slice), finishedAt);
    }
  };

  inFlightUserId = userId;
  inFlight = run()
    .catch(error => {
      console.warn('[dataRefresh] refresh failed:', error);
    })
    .finally(() => {
      inFlight = null;
      inFlightUserId = null;
    });

  return inFlight;
}
