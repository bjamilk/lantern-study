/**
 * Durable queue for marketplace question-bank scores (mobile counterpart of
 * the web module in services/pendingQuestionBankScores.ts).
 *
 * Sessions from purchased banks are usually finished offline, so the score
 * POST is queued in AsyncStorage and flushed by syncPendingResults — the same
 * path that replays offline test results.
 *
 * Entries drop after MAX_ATTEMPTS or MAX_AGE so a permanently un-postable
 * score (bank deleted, entitlement revoked) cannot wedge the queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lantern_pending_qbank_scores';
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingQuestionBankScore {
  listingId: string;
  correct: number;
  total: number;
  completedAt: string;
  attempts: number;
}

export async function readPendingQuestionBankScores(): Promise<PendingQuestionBankScore[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: PendingQuestionBankScore[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage failure must not break the test flow.
  }
}

/** Queue one attempt from an offline bundle id ("qbank-<listingId>"). */
export async function enqueueScoreForBundle(
  bundleId: string | undefined,
  correct: number,
  total: number
): Promise<void> {
  if (!bundleId || !bundleId.startsWith('qbank-')) return;
  if (!Number.isFinite(total) || total <= 0) return;

  const queue = await readPendingQuestionBankScores();
  queue.push({
    listingId: bundleId.slice('qbank-'.length),
    correct: Math.max(0, Math.floor(correct)),
    total: Math.floor(total),
    completedAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeQueue(queue);
}

/**
 * Post every queued score. Successes and exhausted/expired entries are
 * removed; transient failures stay queued. Never throws.
 */
export async function flushPendingQuestionBankScores(): Promise<{
  posted: number;
  remaining: number;
}> {
  const queue = await readPendingQuestionBankScores();
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

  await writeQueue(keep);
  return { posted, remaining: keep.length };
}
