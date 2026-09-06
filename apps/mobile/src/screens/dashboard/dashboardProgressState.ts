// ===========================================
// Lantern Study Mobile - What Home may claim about your progress
// ===========================================
/**
 * Home used to answer "how am I doing?" with zeros whenever the phone was
 * offline: `LEVEL 6 Expert · 3,897 pts` online became `LEVEL 1 Newcomer · 0 XP
 * · 0% · Tests taken 0 · Streak 0` with the radio off. Every one of those
 * numbers is a claim about the student's work, and every one of them was false
 * — a student reads that as progress lost.
 *
 * The cause is that a stats refresh with no network does not fail loudly: each
 * source falls back to an empty list, so the dashboard is handed a perfectly
 * well-formed snapshot of nothing. This module is the guard in front of the
 * render: given the live snapshot, the last snapshot we know arrived from the
 * server, and whether the last refresh could reach Lantern at all, it says
 * which of three things Home is allowed to show.
 *
 *   live        — the numbers came back; show them.
 *   stale       — we could not reach Lantern; show the last real numbers and
 *                 say when they were last synced.
 *   unavailable — we could not reach Lantern and have nothing real to show;
 *                 say so. Dashes, never zeros.
 *
 * Pure and import-free (types only) so it is unit-tested directly.
 */

/** The parts of a stats snapshot that carry evidence of past work. */
export interface ProgressSignalFields {
  totalPoints?: number;
  totalTestsTaken?: number;
  currentStreak?: number;
  longestStreak?: number;
  cardsReviewed?: number;
  totalStudyTime?: number;
  activityDays?: unknown[];
  badges?: Array<{ level?: number }>;
}

/**
 * Does this snapshot show that the account has ever done anything?
 *
 * A brand-new account genuinely has none of this, which is why "no signal" on
 * its own is not an error — it only becomes a lie when we ALSO know the
 * refresh never reached the server.
 */
export function statsHaveSignal(stats: ProgressSignalFields | null | undefined): boolean {
  if (!stats) return false;
  if ((stats.totalPoints ?? 0) > 0) return true;
  if ((stats.totalTestsTaken ?? 0) > 0) return true;
  if ((stats.currentStreak ?? 0) > 0) return true;
  if ((stats.longestStreak ?? 0) > 0) return true;
  if ((stats.cardsReviewed ?? 0) > 0) return true;
  if ((stats.totalStudyTime ?? 0) > 0) return true;
  if ((stats.activityDays?.length ?? 0) > 0) return true;
  return (stats.badges ?? []).some((badge) => (badge?.level ?? 0) > 0);
}

export type ProgressDisplayMode = 'live' | 'stale' | 'unavailable';

export interface ProgressDisplay<T> {
  mode: ProgressDisplayMode;
  /** What to render. `null` only in `unavailable`, where dashes are the truth. */
  stats: T | null;
  /** When `stats` last came back from the server, if we know. */
  syncedAt: number | null;
}

export interface LastGoodStats<T> {
  stats: T;
  at: number;
}

/**
 * Decide what Home may show.
 *
 * `syncFailed` is the only input that can demote a snapshot, and it means one
 * specific thing: the last refresh could not reach Lantern (offline, timed
 * out, or the server answered with a 5xx). A 403, a 404 or a plain empty
 * account are NOT that, and leave the live numbers alone.
 */
export function resolveProgressDisplay<T extends ProgressSignalFields>(input: {
  live: T | null | undefined;
  lastGood: LastGoodStats<T> | null | undefined;
  syncFailed: boolean;
}): ProgressDisplay<T> {
  const { live, lastGood, syncFailed } = input;

  if (!syncFailed) {
    return { mode: 'live', stats: live ?? null, syncedAt: lastGood?.at ?? null };
  }

  // The refresh failed but the snapshot in hand still carries real work —
  // the store kept it, or it was hydrated from the on-device cache. True, just
  // not necessarily current.
  if (statsHaveSignal(live)) {
    return { mode: 'stale', stats: live as T, syncedAt: lastGood?.at ?? null };
  }

  if (lastGood && statsHaveSignal(lastGood.stats)) {
    return { mode: 'stale', stats: lastGood.stats, syncedAt: lastGood.at };
  }

  return { mode: 'unavailable', stats: null, syncedAt: null };
}

// ---------------------------------------------------------------------------
// The merge rule — what a refresh is allowed to replace.
//
// `resolveProgressDisplay` above is the guard in front of the RENDER. It was
// not enough on its own, because the store fed it a lie: with the radio off,
// every remote source in the stats refresh falls back to an empty list, the
// store builds a perfectly well-formed snapshot of zeros, records `error:
// null`, and writes those zeros into the on-device cache. From then on even
// the cache — the thing "last synced progress" falls back to — says zero.
//
// (Worse, the manufactured snapshot is not uniformly zero: `cardsReviewed`
// and `totalStudyTime` are computed from the LOCAL flashcard store, so it can
// carry just enough signal to pass `statsHaveSignal` and be shown as "stale"
// while every server-side figure in it reads 0. That is exactly how Home came
// to say "Showing your last synced progress · Nothing has been lost" directly
// above `LEVEL 1 · 0 XP · 0 pts · 0 streak`.)
//
// So the guard has to move one step earlier, to the moment the refresh
// finishes: a snapshot assembled from sources that never reached Lantern is
// not a snapshot, and it may neither replace what we hold nor be cached.
// ---------------------------------------------------------------------------

export interface StatsRefreshResolution<T> {
  /** What the store should hold after this refresh. `null` = nothing true. */
  stats: T | null;
  /** At least one source never reached Lantern: the figures are not current. */
  stale: boolean;
  /** Whether this snapshot may be written to the on-device cache. */
  persist: boolean;
}

/**
 * Reconcile a finished refresh with what the store already held.
 *
 * `attempted` / `unreachable` count REMOTE sources only, and "unreachable"
 * means the one thing the display cares about: offline, timed out, or a 5xx.
 * A 404 or an empty account is a real answer and does not count.
 *
 * Three outcomes:
 *   everything got through  — take the new snapshot, cache it.
 *   nothing got through     — keep exactly what we had (possibly nothing) and
 *                             flag it stale. Never cache.
 *   some got through        — the new snapshot mixes real figures with zeros
 *                             standing in for the sources that failed, so it
 *                             is never allowed to overwrite a snapshot we
 *                             already trust. Never cache.
 */
export function mergeStatsRefresh<T>(input: {
  previous: T | null | undefined;
  incoming: T | null | undefined;
  attempted: number;
  unreachable: number;
}): StatsRefreshResolution<T> {
  const { previous, incoming, attempted, unreachable } = input;

  if (unreachable <= 0) {
    // Nothing failed. An `incoming` of null here means the caller had nothing
    // to give us, so we keep what we hold rather than blanking the screen.
    if (incoming == null) return { stats: previous ?? null, stale: false, persist: false };
    return { stats: incoming, stale: false, persist: true };
  }

  if (previous != null) {
    return { stats: previous, stale: true, persist: false };
  }

  // No previous snapshot to fall back on. A partial refresh still contains
  // figures that genuinely came back, which beats dashes; a total failure
  // contains nothing but manufactured zeros, which is worse than dashes.
  const reachedSomething = unreachable < attempted;
  return {
    stats: reachedSomething ? (incoming ?? null) : null,
    stale: true,
    persist: false,
  };
}
