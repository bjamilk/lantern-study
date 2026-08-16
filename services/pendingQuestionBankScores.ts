/**
 * Durable queue for marketplace question-bank scores.
 *
 * A session run from a purchased bank is usually finished offline, so the
 * score POST cannot happen at completion. Attempts are queued here (localStorage,
 * survives reloads) and flushed by the same code that replays pending test
 * results — manual "Sync Results" and the reconnect auto-sync.
 *
 * Entries are dropped after MAX_ATTEMPTS or MAX_AGE so a permanently
 * un-postable score (bank deleted, entitlement revoked) cannot wedge the queue.
 */
const STORAGE_KEY = 'lantern_pending_qbank_scores';
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingQuestionBankScore {
  listingId: string;
  correct: number;
  total: number;
  completedAt: string;
  attempts: number;
}

export function readPendingQuestionBankScores(): PendingQuestionBankScore[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: PendingQuestionBankScore[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full / disabled — the score is not worth breaking the session over.
  }
}

/**
 * Queue one attempt. Same-bank entries are kept (not deduped): every attempt
 * counts toward the server-side attempt tally, and only the best score wins.
 */
export function enqueueQuestionBankScore(entry: {
  listingId: string;
  correct: number;
  total: number;
}): void {
  if (!entry.listingId || !Number.isFinite(entry.total) || entry.total <= 0) return;
  const queue = readPendingQuestionBankScores();
  queue.push({
    listingId: entry.listingId,
    correct: Math.max(0, Math.floor(entry.correct)),
    total: Math.floor(entry.total),
    completedAt: new Date().toISOString(),
    attempts: 0,
  });
  writeQueue(queue);
}

/** Convenience: enqueue from an offline bundle id ("qbank-<listingId>"). */
export function enqueueScoreForBundle(
  bundleId: string | undefined,
  correct: number,
  total: number
): void {
  if (!bundleId || !bundleId.startsWith('qbank-')) return;
  enqueueQuestionBankScore({
    listingId: bundleId.slice('qbank-'.length),
    correct,
    total,
  });
}

/**
 * Post every queued score. Successes and exhausted/expired entries are
 * removed; transient failures stay queued with an incremented attempt count.
 * Never throws — a leaderboard is not worth failing a sync over.
 */
export async function flushPendingQuestionBankScores(): Promise<{
  posted: number;
  remaining: number;
}> {
  const queue = readPendingQuestionBankScores();
  if (queue.length === 0) return { posted: 0, remaining: 0 };

  const { recordQuestionBankScore } = await import('./supabase');
  const now = Date.now();
  const keep: PendingQuestionBankScore[] = [];
  let posted = 0;

  for (const entry of queue) {
    const age = now - new Date(entry.completedAt).getTime();
    if (Number.isFinite(age) && age > MAX_AGE_MS) continue; // too old to matter

    try {
      await recordQuestionBankScore(entry.listingId, entry.correct, entry.total);
      posted += 1;
    } catch {
      const attempts = (entry.attempts || 0) + 1;
      if (attempts < MAX_ATTEMPTS) keep.push({ ...entry, attempts });
    }
  }

  writeQueue(keep);
  return { posted, remaining: keep.length };
}
