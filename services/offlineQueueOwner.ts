/**
 * Cross-account guard for the offline work queues (web half).
 *
 * The queues live under fixed localStorage keys, so they survive logout: sign
 * in as B on A's browser and A's queued test results, flashcard reviews and
 * question-bank scores used to replay into B's account. The POLICY that
 * decides what happens to them is now shared with mobile — see
 * `@lantern/shared/offlineQueue`, whose header documents the rule. This file
 * is only the localStorage adapter for it.
 *
 * Exports:
 *  - `isOfflineQueueOwner(userId)` — safe to upload?
 *  - `ensureOfflineQueueOwner(userId)` — claim or set aside, on sign-in.
 *  - `takeQuarantinedQueue(queueKey, userId)` — hand a returning owner their
 *    work back.
 *
 * FIXED (F2 · E3 C5): this file used to PURGE a queue whose stamp named
 * someone else — destroying a student's unsynced work — while the case that
 * actually happened (stamp gone, queue still there, because
 * `clearAllClientAuthStorage` matched `lantern_offline_owner` and not
 * `pendingSyncResults`) fell into an "adopt on sight" branch that replayed A's
 * results into B. Both halves are gone: nothing here deletes a queue, and an
 * unstamped queue is adopted only when it is provably pre-stamping. The stamp
 * itself now survives logout (`isOfflineQueuePreservedKey`, consulted by
 * `shouldClearClientStorageKeyOnLogout`).
 */
import {
  OFFLINE_QUEUE_ERA_KEY,
  OFFLINE_QUEUE_OWNER_KEY,
  OFFLINE_QUEUE_UNKNOWN_OWNER,
  decidePurge,
  entriesOwnedBy,
  offlineQueueQuarantineKey,
  parseQueue,
  quarantineEntries,
  resolveEntryOwner,
  stampOwner,
  type OwnedQueueEntry,
} from '@lantern/shared/offlineQueue';

// Anything added later that uploads local work under the current user's id
// must be listed here too, or it survives an account switch and syncs into the
// wrong account.
/** Every queue that REPLAYS work into the signed-in account. */
const QUEUE_KEYS = [
  'pendingSyncResults',
  'lantern_pending_flashcard_reviews',
  'lantern_pending_qbank_scores',
];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or disabled. The guard degrades to "not the owner", which
    // blocks uploads rather than allowing a wrong-account one.
  }
};

const drop = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

// Deliberately false when the stamp is missing or localStorage throws, so an
// unstamped queue is never uploaded on a guess — call `ensureOfflineQueueOwner`
// to claim the queues first.
/** True when the stored queues are stamped for this user (safe to upload). */
export function isOfflineQueueOwner(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  return read(OFFLINE_QUEUE_OWNER_KEY) === userId;
}

/**
 * Claim the local queues for `userId`, or set aside work that is not theirs.
 *
 * Returns true when the caller must drop its already-hydrated in-memory copies
 * of the queues — i.e. when the stored work was moved to quarantine because it
 * belongs to someone else (or to nobody provable). It NEVER means "deleted":
 * quarantined work stays on disk under
 * `lantern_offline_quarantine:<queue>:<owner>` and comes back via
 * `takeQuarantinedQueue` when its owner signs in.
 *
 * FIXED (G4 · H13): ownership is resolved PER ENTRY (`resolveEntryOwner`), not
 * once per device off the stamp. An entry that names its account — offline
 * results carry the session payload — is replayed for that account even on a
 * browser whose stamp was wiped, and an entry belonging to someone else is
 * filed under THEIR id, so they get it back. Only entries nothing attributes
 * reach the `unknown` bucket.
 */
export function ensureOfflineQueueOwner(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false;

  const deviceOwner = read(OFFLINE_QUEUE_OWNER_KEY);
  const era = read(OFFLINE_QUEUE_ERA_KEY);

  const stored = QUEUE_KEYS.map((key) => ({ key, entries: parseQueue(read(key)) }));

  // Claim the device for this user either way — the NEXT account must find a
  // stamp, not an open queue.
  write(OFFLINE_QUEUE_OWNER_KEY, userId);
  write(OFFLINE_QUEUE_ERA_KEY, '1');

  // Set aside, never delete. Entries are stamped with the owner we believe in
  // (or none, for an unattributable queue) so a restore can verify them.
  let movedAnything = false;
  for (const { key, entries } of stored) {
    if (entries.length === 0) continue;

    // FIXED (G4 · H13): the decision is per ENTRY, not per device. The device
    // stamp is only a fallback claim for entries that name nobody; an entry
    // whose own `userId` (or session payload) names the account signing in is
    // THEIRS, stamp or no stamp. Deciding for the whole queue off the device
    // stamp alone sent provably-owned work to the `unknown` bucket, which
    // `takeQuarantinedQueue` never read — kept on disk forever, replayable by
    // nobody.
    const owners = entries.map((entry) => resolveEntryOwner(entry));
    const named = owners.filter((owner): owner is string => Boolean(owner));
    // Evidence that this device's queue is not one account's: a named owner
    // who is not the user signing in, or no stamp at all (the logout case —
    // someone was signed in, their stamp went, their work did not).
    const otherSignedInEvidence =
      named.some((owner) => owner !== userId) || deviceOwner === null;

    const keep: OwnedQueueEntry[] = [];
    const buckets = new Map<string, OwnedQueueEntry[]>();

    entries.forEach((entry, index) => {
      const entryOwner = owners[index] || deviceOwner;
      const decision = decidePurge({
        entryOwner,
        currentUser: userId,
        stampPresent: Boolean(entryOwner),
        // The era marker is written the first time this runs on a browser, and
        // it survives logout. Its absence is the only honest proof that a
        // queue predates stamping.
        createdBeforeStamping: era === null,
        otherSignedInEvidence,
      });
      if (decision.replay) {
        keep.push(stampOwner(entry, userId));
        return;
      }
      // The bucket names the REAL owner whenever one can be established, so
      // that owner reclaims it on their next sign-in; `unknown` is only for
      // entries nothing attributes.
      const bucket = decision.quarantineOwner || OFFLINE_QUEUE_UNKNOWN_OWNER;
      const list = buckets.get(bucket) || [];
      list.push(
        decision.quarantineOwner ? stampOwner(entry, decision.quarantineOwner) : entry
      );
      buckets.set(bucket, list);
    });

    if (buckets.size === 0) continue; // Wholly this user's: leave the key alone.

    // Something in this queue is not replayable, so the caller is about to
    // drop its in-memory copy (and the store mirror would then overwrite the
    // live key). This user's OWN entries therefore go to their own bucket
    // rather than back to the live key: `restoreInPlace` below, and
    // `offlineTestSync`'s `takeQuarantinedQueue`, are the routes that put them
    // back safely. Nothing is deleted on either path.
    if (keep.length > 0) buckets.set(userId, [...(buckets.get(userId) || []), ...keep]);

    for (const [owner, list] of buckets) {
      const bucketKey = offlineQueueQuarantineKey(key, owner);
      write(bucketKey, JSON.stringify(quarantineEntries(read(bucketKey), list)));
    }
    drop(key);
    movedAnything = true;
  }

  // Then hand THIS user back anything set aside for them while someone else
  // was signed in — always, and after the move above, so work that was just
  // put aside for its own owner is not immediately pulled back.
  //
  // Only the qbank queue is restored in place: it is pure localStorage with no
  // store mirror, so writing the live key is safe. `pendingSyncResults` is
  // restored by `offlineTestSync` through the STORE, because the effect that
  // mirrors the store to localStorage would otherwise overwrite it on the same
  // commit; the flashcard-review queue has the same store-mirror problem and
  // no restore path yet, so it stays quarantined — preserved, not replayed,
  // never deleted (deferred, F2).
  restoreInPlace('lantern_pending_qbank_scores', userId);

  return movedAnything;
}

/**
 * Merge a user's quarantined entries straight back into the live key. Only for
 * queues that live in localStorage alone — a queue mirrored by a zustand store
 * must go back through the store instead (see `takeQuarantinedQueue`).
 */
function restoreInPlace(queueKey: string, userId: string): void {
  const entries = takeQuarantinedQueue(queueKey, userId);
  if (entries.length === 0) return;
  write(queueKey, JSON.stringify(quarantineEntries(read(queueKey), entries)));
}

/**
 * Hand `userId` back the work that was set aside for them, and empty the
 * bucket. Returns [] when there is none — the common case.
 *
 * Callers merge the entries into their store (which is what persists them back
 * to the live key); writing them straight to the live key would be undone by
 * the effect that mirrors the store to localStorage on the same commit.
 */
export function takeQuarantinedQueue<T extends OwnedQueueEntry>(
  queueKey: string,
  userId: string
): T[] {
  if (typeof window === 'undefined' || !userId) return [];
  const bucket = offlineQueueQuarantineKey(queueKey, userId);
  const entries = parseQueue<T>(read(bucket));
  if (entries.length > 0) drop(bucket);
  return [...entries, ...reclaimFromUnknown<T>(queueKey, userId)];
}

/**
 * Entries in the `unknown` bucket that PROVE they are `userId`'s.
 *
 * FIXED (G4 · H13): before per-entry ownership, a browser whose stamp had been
 * wiped had its whole queue filed under `unknown` — including results whose
 * session payload names their account. `takeQuarantinedQueue` only ever read
 * `…:<userId>`, so that work was kept forever and replayed into nobody. This
 * is the door back for the buckets that were already written that way; the
 * rest of the bucket (entries nothing attributes) is written back untouched.
 */
function reclaimFromUnknown<T extends OwnedQueueEntry>(queueKey: string, userId: string): T[] {
  const bucket = offlineQueueQuarantineKey(queueKey, OFFLINE_QUEUE_UNKNOWN_OWNER);
  const entries = parseQueue<T>(read(bucket));
  if (entries.length === 0) return [];
  const mine = entriesOwnedBy(entries, userId);
  if (mine.length === 0) return [];
  const rest = entries.filter((entry) => !mine.includes(entry));
  if (rest.length > 0) write(bucket, JSON.stringify(rest));
  else drop(bucket);
  return mine;
}
