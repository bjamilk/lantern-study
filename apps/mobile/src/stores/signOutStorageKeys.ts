/**
 * Sign-out storage keys — which of them a sign-out is allowed to delete.
 *
 * Three separate queues hold work the student has DONE but not yet uploaded:
 * pending offline test results, the offline sync queue (creates/updates/
 * deletes) and queued question-bank scores. Each of them is now stored per
 * account under `<legacy key>:<userId>`, and each owns a
 * `…KeysToClearOnSignOut(reason, userId)` rule:
 *
 *   `user`    — the student tapped Sign out. Their queues (and the pre-split
 *               legacy key) may go.
 *   `revoked` — the server ended the session. Nothing goes: they did not ask
 *               for this, may sign straight back in, and a dead token is not
 *               permission to delete a finished test.
 *
 * In both cases ANOTHER account's scoped key is never removed.
 *
 * This module is pure — no store, no AsyncStorage, no services — so the rule
 * can be unit-tested without importing the auth store.
 */
import {
  SYNC_QUEUE_LEGACY_KEY,
  syncQueueKey,
  syncQueueKeysToClearOnSignOut,
} from '@lantern/shared/sync';
import {
  PENDING_QBANK_SCORES_LEGACY_KEY,
  pendingQbankScoresKey,
  pendingQbankScoreKeysToClearOnSignOut,
} from '../utils/pendingQuestionBankScoresScope';
import {
  PENDING_RESULTS_LEGACY_KEY,
  pendingResultsKey,
  pendingResultsKeysToClearOnSignOut,
} from './pendingResultsScope';

export type SignOutReason = 'user' | 'revoked';

/**
 * The legacy (pre-split) key of every unsynced-work family. A key of the form
 * `<one of these>:<anything>` belongs to exactly one account.
 */
export const UNSYNCED_WORK_LEGACY_KEYS = [
  PENDING_RESULTS_LEGACY_KEY,
  SYNC_QUEUE_LEGACY_KEY,
  PENDING_QBANK_SCORES_LEGACY_KEY,
] as const;

/** Every unsynced-work key belonging to `userId` (plus the legacy keys). */
export const unsyncedWorkKeys = (userId?: string | null): string[] => [
  ...UNSYNCED_WORK_LEGACY_KEYS,
  ...(userId
    ? [pendingResultsKey(userId), syncQueueKey(userId), pendingQbankScoresKey(userId)]
    : []),
];

/** Is this key part of an unsynced-work family (this user's, or anyone's)? */
const isUnsyncedWorkKey = (key: string, userId?: string | null): boolean =>
  unsyncedWorkKeys(userId).includes(key) ||
  UNSYNCED_WORK_LEGACY_KEYS.some((legacy) => key.startsWith(`${legacy}:`));

/** The union of the three families' clear rules for this sign-out. */
export const unsyncedWorkKeysToClearOnSignOut = (
  reason: SignOutReason,
  userId: string | null | undefined
): string[] => [
  ...pendingResultsKeysToClearOnSignOut(reason, userId),
  ...syncQueueKeysToClearOnSignOut(reason, userId),
  ...pendingQbankScoreKeysToClearOnSignOut(reason, userId),
];

/**
 * Filter a sign-out's candidate removal list down to what may actually go.
 *
 * Keys outside the unsynced-work families (plain caches) always go — losing a
 * cache costs a refetch. Keys inside them go only when the matching rule above
 * names them, so a revoked session keeps everything and a user sign-out still
 * cannot touch a second account's queue. Order is preserved and duplicates are
 * collapsed.
 */
export const planSignOutKeyRemoval = (
  reason: SignOutReason,
  userId: string | null | undefined,
  candidateKeys: readonly string[]
): string[] => {
  const clearable = new Set(unsyncedWorkKeysToClearOnSignOut(reason, userId));
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of candidateKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (isUnsyncedWorkKey(key, userId) && !clearable.has(key)) continue;
    keys.push(key);
  }
  return keys;
};
