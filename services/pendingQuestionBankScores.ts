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
 *
 * Exports: `readPendingQuestionBankScores`, `enqueueQuestionBankScore`,
 *  `enqueueScoreForBundle`, `flushPendingQuestionBankScores`.
 * Touches: localStorage key `lantern_pending_qbank_scores` (listed in
 *  `offlineQueueOwner.QUEUE_KEYS`, so on an account switch it is set ASIDE for
 *  its owner — FIXED (F2): it used to be deleted), and
 *  `recordQuestionBankScore` in `./supabase` (imported lazily so the queue
 *  module stays free of the data-layer bundle).
 * Gotchas:
 *  - No dedupe: repeat runs of the same bank are all kept on purpose (each is
 *    a separate attempt server-side; best score wins).
 *  - The flush classifies only transport-vs-server: a throw carrying an HTTP
 *    `status` burns one of MAX_ATTEMPTS, a throw without one (offline, DNS,
 *    timeout) does not. It still does not distinguish a permanent 4xx from a
 *    retryable 5xx, so a permanent 4xx costs 5 retries.
 *  - Expired entries are dropped silently and are not counted in `posted`.
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

// Returns [] for a missing key, unparseable JSON, or a non-array payload, so a
// corrupted queue degrades to "nothing pending" instead of throwing at boot.
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

/** Identity of one queued attempt — there is no id field, so this stands in. */
const identityOf = (entry: PendingQuestionBankScore): string =>
  `${entry.listingId}|${entry.completedAt}|${entry.correct}|${entry.total}`;

/** HTTP status parsed out of our API error messages ("HTTP error! status: 400"). */
// Null for a network failure, an abort, or anything that is not an Error with
// that shape. Null means "the server never answered", which must NOT burn an
// attempt.
function parseHttpStatus(error: unknown): number | null {
  const m = error instanceof Error ? error.message.match(/status:\s*(\d{3})/) : null;
  return m ? Number(m[1]) : null;
}

let flushInFlight: Promise<{ posted: number; remaining: number }> | null = null;

/**
 * Post every queued score. Successes and exhausted/expired entries are
 * removed; transient failures stay queued with an incremented attempt count.
 * Never throws — a leaderboard is not worth failing a sync over.
 *
 * FIXED (F2 · E3 L4), three parts:
 *  - single-flight, so two reconnect handlers cannot double-post;
 *  - the queue is RE-READ after the awaits and entries are removed by
 *    identity, so a score saved mid-flush survives instead of being erased by
 *    a stale snapshot written back wholesale;
 *  - an attempt is only counted when the server actually answered. Five flaky
 *    reconnects used to DELETE a legitimate score unsent — exactly what
 *    `offlineFlashcardSync.ts` documents as forbidden ("network failures never
 *    increment it").
 */
export async function flushPendingQuestionBankScores(): Promise<{
  posted: number;
  remaining: number;
}> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlushPendingQuestionBankScores().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function doFlushPendingQuestionBankScores(): Promise<{
  posted: number;
  remaining: number;
}> {
  const queue = readPendingQuestionBankScores();
  if (queue.length === 0) return { posted: 0, remaining: 0 };

  const { recordQuestionBankScore } = await import('./supabase');
  const now = Date.now();
  /** identity -> the replacement entry, or null to remove it. */
  const settled = new Map<string, PendingQuestionBankScore | null>();
  let posted = 0;

  for (const entry of queue) {
    const age = now - new Date(entry.completedAt).getTime();
    if (Number.isFinite(age) && age > MAX_AGE_MS) {
      settled.set(identityOf(entry), null); // too old to matter
      continue;
    }

    try {
      await recordQuestionBankScore(entry.listingId, entry.correct, entry.total);
      posted += 1;
      settled.set(identityOf(entry), null);
    } catch (error) {
      if (parseHttpStatus(error) === null) {
        // The server never answered. Leave the entry exactly as it was.
        continue;
      }
      const attempts = (entry.attempts || 0) + 1;
      settled.set(identityOf(entry), attempts < MAX_ATTEMPTS ? { ...entry, attempts } : null);
    }
  }

  // Re-read: a session finishing during the awaits above queued its score into
  // this same key, and writing back the pre-flight snapshot would drop it.
  const keep: PendingQuestionBankScore[] = [];
  for (const entry of readPendingQuestionBankScores()) {
    const identity = identityOf(entry);
    if (!settled.has(identity)) {
      keep.push(entry); // queued during the flush, or never reached
      continue;
    }
    const replacement = settled.get(identity);
    if (replacement) keep.push(replacement);
  }

  writeQueue(keep);
  return { posted, remaining: keep.length };
}
