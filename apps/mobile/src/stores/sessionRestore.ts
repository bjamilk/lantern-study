/**
 * Boot-time session restore — PURE.
 *
 * What a cold start should do when the stored session cannot be refreshed
 * right away. Kept free of imports (no store, no services/supabase, no
 * expo-secure-store) so jest can run the whole matrix; see
 * services/authFailure.ts for the same reasoning.
 *
 * The bug this exists to prevent: `initialize()` raced `refreshSession()`
 * against an 8 s timeout and, on timeout, CONTINUED with `session = null`.
 * A signed-in student on a slow link got the full "Sign in to continue"
 * screen, every realtime channel torn down, the theme reset to light and a
 * placeholder avatar — then all of it silently restored ~15 s later when the
 * refresh finally landed. A slow network is not a logout, and a convincing
 * fake of signed-out is worse than a skeleton.
 *
 * The rule in one line: only a DEFINITIVE refusal from gotrue may end a
 * session. Everything else renders the app on the session already on disk.
 */

/**
 * What the boot refresh attempt concluded.
 *
 * - `ok`      — a live session is in hand.
 * - `timeout` — the attempt did not answer inside the boot budget.
 * - `refused` — gotrue positively proved the refresh token is dead
 *               (classifyRefreshError → 'invalid'; invalid_grant and friends).
 * - `offline` — it failed in a transport-shaped way, or answered with neither
 *               a session nor proof. Indistinguishable from `timeout` in
 *               effect; kept separate only so the shell can say "Offline"
 *               rather than "Reconnecting".
 */
export type SessionRestoreNetworkResult = 'ok' | 'timeout' | 'refused' | 'offline';

/** Whether a session was found in the auth client's own storage. */
export type StoredSessionPresence = 'present' | 'absent';

/**
 * - `authenticated` — a refreshed session is in hand.
 * - `restoring`     — running on the stored session while a refresh retries.
 *                     The app is fully usable; the token may be stale.
 * - `signed-out`    — no session.
 */
export type SessionState = 'authenticated' | 'restoring' | 'signed-out';

/** The one quiet line the shell shows for this state. */
export type SessionRestoreNotice = 'none' | 'reconnecting' | 'offline';

export interface SessionRestorePlan {
  /** Which root route to render. */
  route: 'app' | 'sign-in';
  sessionState: SessionState;
  /**
   * True when the app must run on the session read from storage because no
   * refreshed one arrived. The stored user is what keeps the theme, avatar,
   * streak and badges real instead of falling back to signed-out defaults.
   */
  useStoredSession: boolean;
  /** Non-false only on positive proof the token is dead. */
  signOut: false | 'revoked';
  /** Keep retrying the refresh with backoff until ok or a definitive refusal. */
  retryRefresh: boolean;
  notice: SessionRestoreNotice;
}

export interface PlanSessionRestoreInput {
  networkResult: SessionRestoreNetworkResult;
  storedSession: StoredSessionPresence;
}

const SIGNED_OUT: SessionRestorePlan = {
  route: 'sign-in',
  sessionState: 'signed-out',
  useStoredSession: false,
  signOut: false,
  retryRefresh: false,
  notice: 'none',
};

export function planSessionRestore({
  networkResult,
  storedSession,
}: PlanSessionRestoreInput): SessionRestorePlan {
  // A refreshed session in hand settles it, whatever was on disk.
  if (networkResult === 'ok') {
    return {
      route: 'app',
      sessionState: 'authenticated',
      useStoredSession: false,
      signOut: false,
      retryRefresh: false,
      notice: 'none',
    };
  }

  // Nothing on disk: there is no session to protect, so the sign-in route is
  // the honest answer for every failure — including a refusal, which in this
  // case has nothing to revoke.
  if (storedSession === 'absent') return SIGNED_OUT;

  // The server said the token is dead. This is the only path that may end a
  // session the student did not end themselves; it goes through the existing
  // reason path so unsynced work survives.
  if (networkResult === 'refused') {
    return { ...SIGNED_OUT, signOut: 'revoked' };
  }

  // timeout | offline, with a session on disk: run the app on it.
  return {
    route: 'app',
    sessionState: 'restoring',
    useStoredSession: true,
    signOut: false,
    retryRefresh: true,
    notice: networkResult === 'offline' ? 'offline' : 'reconnecting',
  };
}

/** Exponential backoff for the restore retry: 1s, 2s, 4s … capped at 60s. */
export const RESTORE_RETRY_BASE_MS = 1_000;
export const RESTORE_RETRY_MAX_MS = 60_000;

export function restoreRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  // 2 ** 30 is already far past the cap; clamp the exponent so a long outage
  // cannot overflow into Infinity/NaN.
  const exponent = Math.min(safeAttempt - 1, 30);
  return Math.min(RESTORE_RETRY_BASE_MS * 2 ** exponent, RESTORE_RETRY_MAX_MS);
}
