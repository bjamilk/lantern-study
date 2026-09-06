/**
 * Pending marketplace question-bank scores — storage scoping.
 *
 * Queued scores used to live under one unkeyed AsyncStorage key with no owner
 * on the entry, so on a shared handset the next account to sign in flushed the
 * previous student's attempts onto their own leaderboard entry, and a
 * user-initiated sign-out wiped everyone's queue.
 *
 * Scores are now stored per user under `@lantern_pending_qbank_scores:<userId>`
 * and every entry carries the `userId` that finished the attempt.
 *
 * This module is pure (no AsyncStorage, no store, no services imports) so the
 * key / migration / partition rules can be unit-tested on their own.
 */

/** The old, unscoped key. Still read once so it can be cleaned up. */
export const PENDING_QBANK_SCORES_LEGACY_KEY = '@lantern_pending_qbank_scores';

/** Storage key holding `userId`'s queued question-bank scores. */
export const pendingQbankScoresKey = (userId: string): string =>
  `${PENDING_QBANK_SCORES_LEGACY_KEY}:${userId}`;

export interface ScopedPendingQuestionBankScore {
  listingId: string;
  correct: number;
  total: number;
  completedAt: string;
  attempts: number;
  /** The account that finished the attempt. Absent on legacy entries. */
  userId?: string | null;
}

/**
 * Parse a raw AsyncStorage value into an entry list. Corrupt or non-array
 * payloads yield [] rather than throwing — a bad cache must not break a test.
 */
export const parsePendingQbankScores = <T extends ScopedPendingQuestionBankScore>(
  raw: string | null | undefined
): T[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(Boolean) as T[]) : [];
  } catch {
    return [];
  }
};

/** Who owns an entry, if it says. */
export const resolveScoreOwner = (
  entry: ScopedPendingQuestionBankScore
): string | null =>
  typeof entry?.userId === 'string' && entry.userId ? entry.userId : null;

/** Stamp the owning account onto an entry (idempotent). */
export const stampScoreOwner = <T extends ScopedPendingQuestionBankScore>(
  entry: T,
  userId: string
): T => ({ ...entry, userId });

/** Only the entries `userId` owns. Unowned entries are NOT assumed to be theirs. */
export const scoresOwnedBy = <T extends ScopedPendingQuestionBankScore>(
  entries: T[],
  userId: string
): T[] => entries.filter((e) => resolveScoreOwner(e) === userId);

export interface PendingQbankScoresLoadPlan<T> {
  /** The entries `userId` should flush. */
  entries: T[];
  /** Legacy entries that were discarded because nothing identifies their owner. */
  dropped: number;
  /** Whether the legacy unkeyed entry should now be deleted. */
  removeLegacy: boolean;
}

/**
 * Work out what `userId` should load, given the raw values of their key and of
 * the legacy key. Pure: the caller does the I/O.
 *
 * Legacy entries carry no owner and nothing else in them identifies one — a
 * question-bank score is a listing id, a tally and a timestamp. Attributing
 * them to the first account that happens to flush is only correct if that is
 * the sole account this handset has ever used, which is exactly the thing we
 * cannot know. Posting a score under the wrong student is a visible,
 * irreversible leaderboard write, so unowned entries are DROPPED (and counted
 * here so the caller can warn). Pending test results migrate instead of
 * dropping because they are the student's own unsynced work, and losing them
 * is the worse failure; a leaderboard tally is regenerable by retaking.
 */
export const planPendingQbankScoresLoad = <T extends ScopedPendingQuestionBankScore>(
  userId: string,
  scopedRaw: string | null | undefined,
  legacyRaw: string | null | undefined
): PendingQbankScoresLoadPlan<T> => {
  const scoped = parsePendingQbankScores<T>(scopedRaw).map((e) =>
    stampScoreOwner(e, userId)
  );
  const legacy = parsePendingQbankScores<T>(legacyRaw);
  // A legacy entry that already names this user (only possible if a newer
  // build wrote through the old key) is still theirs and is kept.
  const mine = scoresOwnedBy(legacy, userId);
  return {
    entries: [...scoped, ...mine],
    dropped: legacy.length - mine.length,
    removeLegacy: legacyRaw != null,
  };
};

/**
 * Keys to delete for a sign-out.
 *
 * `user`    — the student asked; drop their queued scores and the legacy key.
 * `revoked` — the server ended the session. Their unflushed scores MUST
 *             survive, and so must any other account's on this handset.
 */
export const pendingQbankScoreKeysToClearOnSignOut = (
  reason: 'user' | 'revoked',
  userId: string | null | undefined
): string[] => {
  if (reason !== 'user') return [];
  const keys = [PENDING_QBANK_SCORES_LEGACY_KEY];
  if (userId) keys.push(pendingQbankScoresKey(userId));
  return keys;
};
