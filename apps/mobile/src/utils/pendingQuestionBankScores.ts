/**
 * Durable queue for marketplace question-bank scores (mobile counterpart of
 * the web module in services/pendingQuestionBankScores.ts).
 *
 * Sessions from purchased banks are usually finished offline, so the score
 * POST is queued in AsyncStorage and flushed by syncPendingResults — the same
 * path that replays offline test results.
 *
 * The queue is scoped per account (see pendingQuestionBankScoresScope.ts): the
 * entry carries its owner and lives under `<legacy key>:<userId>`, so a shared
 * handset can never post one student's attempt to another's leaderboard.
 *
 * Entries drop after MAX_ATTEMPTS or MAX_AGE so a permanently un-postable
 * score (bank deleted, entitlement revoked) cannot wedge the queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PENDING_QBANK_SCORES_LEGACY_KEY,
  parsePendingQbankScores,
  pendingQbankScoresKey,
  planPendingQbankScoresLoad,
  stampScoreOwner,
  type ScopedPendingQuestionBankScore,
} from './pendingQuestionBankScoresScope';

const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PendingQuestionBankScore = ScopedPendingQuestionBankScore;

/**
 * Read `userId`'s queue, folding in (and cleaning up) the legacy unkeyed key.
 * Legacy entries name no owner and are dropped — see planPendingQbankScoresLoad.
 */
export async function readPendingQuestionBankScores(
  userId: string
): Promise<PendingQuestionBankScore[]> {
  if (!userId) return [];
  let scopedRaw: string | null = null;
  let legacyRaw: string | null = null;
  try {
    scopedRaw = await AsyncStorage.getItem(pendingQbankScoresKey(userId));
    legacyRaw = await AsyncStorage.getItem(PENDING_QBANK_SCORES_LEGACY_KEY);
  } catch {
    return [];
  }

  const plan = planPendingQbankScoresLoad<PendingQuestionBankScore>(
    userId,
    scopedRaw,
    legacyRaw
  );

  if (plan.removeLegacy) {
    if (plan.dropped > 0) {
      console.warn(
        `[qbank-scores] Dropped ${plan.dropped} unscoped pending score(s): no owner recorded, ` +
          'and attributing them to the signed-in account could post another student\'s attempt.'
      );
    }
    try {
      if (plan.entries.length > 0) await writeQueue(userId, plan.entries);
      await AsyncStorage.removeItem(PENDING_QBANK_SCORES_LEGACY_KEY);
    } catch {
      // Cleanup is best-effort; the drop rule is re-applied on the next read.
    }
  }

  return plan.entries;
}

async function writeQueue(
  userId: string,
  entries: PendingQuestionBankScore[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(pendingQbankScoresKey(userId), JSON.stringify(entries));
  } catch {
    // Storage failure must not break the test flow.
  }
}

/** Queue one attempt from an offline bundle id ("qbank-<listingId>"). */
export async function enqueueScoreForBundle(
  userId: string | undefined,
  bundleId: string | undefined,
  correct: number,
  total: number
): Promise<void> {
  if (!userId) return;
  if (!bundleId || !bundleId.startsWith('qbank-')) return;
  if (!Number.isFinite(total) || total <= 0) return;

  // Read the key directly: the entry belongs to this user regardless of what
  // the legacy migration decides, and a read failure must not lose the score.
  let existingRaw: string | null = null;
  try {
    existingRaw = await AsyncStorage.getItem(pendingQbankScoresKey(userId));
  } catch {
    existingRaw = null;
  }
  const queue = parsePendingQbankScores<PendingQuestionBankScore>(existingRaw);
  queue.push(
    stampScoreOwner(
      {
        listingId: bundleId.slice('qbank-'.length),
        correct: Math.max(0, Math.floor(correct)),
        total: Math.floor(total),
        completedAt: new Date().toISOString(),
        attempts: 0,
      },
      userId
    )
  );
  await writeQueue(userId, queue);
}

/**
 * Post every score queued by `userId`. Successes and exhausted/expired entries
 * are removed; transient failures stay queued. Never throws.
 */
export async function flushPendingQuestionBankScores(
  userId: string | undefined
): Promise<{ posted: number; remaining: number }> {
  if (!userId) return { posted: 0, remaining: 0 };
  const queue = await readPendingQuestionBankScores(userId);
  if (queue.length === 0) return { posted: 0, remaining: 0 };

  const { recordQuestionBankScore } = await import('../services/api');
  const now = Date.now();
  const keep: PendingQuestionBankScore[] = [];
  let posted = 0;

  for (const entry of queue) {
    const age = now - new Date(entry.completedAt).getTime();
    if (Number.isFinite(age) && age > MAX_AGE_MS) continue;

    try {
      await recordQuestionBankScore(entry.listingId, entry.correct, entry.total);
      posted += 1;
    } catch {
      const attempts = (entry.attempts || 0) + 1;
      if (attempts < MAX_ATTEMPTS) keep.push({ ...entry, attempts });
    }
  }

  await writeQueue(userId, keep);
  return { posted, remaining: keep.length };
}

export { pendingQbankScoreKeysToClearOnSignOut } from './pendingQuestionBankScoresScope';
