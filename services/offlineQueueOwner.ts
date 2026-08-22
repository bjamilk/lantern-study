/**
 * Cross-account guard for the offline work queues.
 *
 * The queues live under fixed localStorage keys, so they used to survive
 * logout: sign in as B on A's browser and A's queued test results, flashcard
 * reviews, and question-bank scores replayed into B's account. Stamp the
 * owner on login and purge queues that belong to someone else.
 */

const OWNER_KEY = 'lantern_offline_owner';

/** Every queue that REPLAYS work into the signed-in account. */
const QUEUE_KEYS = [
  'pendingSyncResults',
  'lantern_pending_flashcard_reviews',
  'lantern_pending_qbank_scores',
];

/**
 * Call as soon as the signed-in user is known. If the stored queues belong to
 * a different user, drop them (their owner can no longer sync them from this
 * browser anyway — replaying them into this account would be corruption, not
 * recovery). Returns true when foreign queues were purged.
 */
/** True when the stored queues are stamped for this user (safe to upload). */
export function isOfflineQueueOwner(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    return localStorage.getItem(OWNER_KEY) === userId;
  } catch {
    return false;
  }
}

export function ensureOfflineQueueOwner(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner === userId) return false;
    if (owner !== null) {
      for (const key of QUEUE_KEYS) localStorage.removeItem(key);
    }
    localStorage.setItem(OWNER_KEY, userId);
    return owner !== null;
  } catch {
    return false;
  }
}
