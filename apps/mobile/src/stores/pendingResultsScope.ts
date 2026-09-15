/**
 * Pending offline test results — storage scoping (mobile half).
 *
 * Pending (unsynced) results used to live under one unkeyed AsyncStorage key,
 * so on a shared handset the next account to sign in loaded the previous
 * student's finished tests and uploaded them under the wrong user — and a
 * user-initiated sign-out wiped everyone's.
 *
 * Results are stored per user under `@lantern_pending_results:<userId>`. This
 * module is pure (no store, no AsyncStorage, no supabase imports) so the
 * key/migration/partition rules can be unit-tested on their own.
 *
 * FIXED (F2): the OWNERSHIP rules — who an entry belongs to, when an unowned
 * entry may be adopted, and the fact that another account's work is preserved
 * rather than deleted — now live in `@lantern/shared/offlineQueue` and are
 * shared with web, which used to implement the opposite (it purged). What is
 * left here is the mobile storage shape: keys, load plans and merges.
 */
import {
  OFFLINE_QUEUE_UNKNOWN_OWNER,
  type OwnedQueueEntry,
  decidePurge,
  entriesOwnedBy,
  mergeQueues,
  parseQueue,
  resolveEntryOwner,
  stampOwner as sharedStampOwner,
} from '@lantern/shared/offlineQueue';


/** The old, unscoped key. Still read once per user so nothing is lost. */
export const PENDING_RESULTS_LEGACY_KEY = '@lantern_pending_results';

/** Storage key holding `userId`'s pending results. */
export const pendingResultsKey = (userId: string): string =>
  `${PENDING_RESULTS_LEGACY_KEY}:${userId}`;

/** Every result shape this module needs to reason about: an id and an owner. */
export type ScopedPendingResult = OwnedQueueEntry;

/**
 * Parse a raw AsyncStorage value into a result list. Corrupt or non-array
 * payloads yield [] rather than throwing — a bad cache must not break sign-in.
 */
export const parsePendingResults = parseQueue;

/**
 * Who owns an entry, if it says — the entry's own `userId`, then the
 * attempt/session payload an offline result carries. FIXED (F2): one shared
 * implementation, so web and mobile cannot disagree about whose work this is.
 */
export const resolveResultOwner = resolveEntryOwner;

/** Stamp the owning account onto a result (idempotent). Shared policy. */
export const stampOwner = sharedStampOwner;

/** Only the entries `userId` owns. Unowned entries are NOT assumed to be theirs. */
export const resultsOwnedBy = entriesOwnedBy;

/**
 * Merge two result lists, de-duplicating by id and keeping the LAST occurrence
 * (the freshly loaded copy wins over an older one with the same id).
 */
export const mergePendingResults = mergeQueues;

/**
 * Split legacy (unkeyed) entries for the user who is loading them, using the
 * shared `decidePurge` rule so mobile and web agree.
 *
 * - entries naming an owner go to that owner (`preserve`) — never deleted;
 * - entries naming nobody are attributed to `userId` (`adopt`) ONLY when no
 *   other account appears in the same legacy batch. FIXED (F2): when one does,
 *   the batch is shared-handset work of unknown origin, so unowned entries are
 *   quarantined under `others[UNKNOWN]` rather than uploaded under whoever
 *   happened to sign in first.
 */
export const partitionLegacyResults = <T extends ScopedPendingResult>(
  legacy: T[],
  userId: string
): { mine: T[]; others: Record<string, T[]> } => {
  const mine: T[] = [];
  const others: Record<string, T[]> = {};
  // Evidence, established once for the batch: does anyone else's work sit here?
  const otherSignedInEvidence = legacy.some((result) => {
    const owner = resolveResultOwner(result);
    return Boolean(owner) && owner !== userId;
  });

  for (const result of legacy) {
    const owner = resolveResultOwner(result);
    const decision = decidePurge({
      entryOwner: owner,
      currentUser: userId,
      stampPresent: owner !== null,
      // Everything under the legacy key predates per-user scoping by
      // definition — that is what makes it the legacy key.
      createdBeforeStamping: true,
      otherSignedInEvidence,
    });
    if (decision.replay) {
      mine.push(stampOwner(result, userId));
      continue;
    }
    const bucket = decision.quarantineOwner || OFFLINE_QUEUE_UNKNOWN_OWNER;
    (others[bucket] ||= []).push(
      decision.quarantineOwner ? stampOwner(result, decision.quarantineOwner) : result
    );
  }
  return { mine, others };
};

export interface PendingResultsWrite<T> {
  key: string;
  results: T[];
}

export interface PendingResultsLoadPlan<T> {
  /** The results `userId` should see in memory. */
  results: T[];
  /** Storage writes to perform, in order. */
  writes: PendingResultsWrite<T>[];
  /** Whether the legacy unkeyed entry should now be deleted. */
  removeLegacy: boolean;
}

/**
 * Work out what to load and what to migrate for `userId`, given the raw values
 * of that user's key and the legacy key. Pure: the caller does the I/O.
 */
export const planPendingResultsLoad = <T extends ScopedPendingResult>(
  userId: string,
  scopedRaw: string | null | undefined,
  legacyRaw: string | null | undefined
): PendingResultsLoadPlan<T> => {
  const scoped = parsePendingResults<T>(scopedRaw).map((r) => stampOwner(r, userId));
  const legacy = parsePendingResults<T>(legacyRaw);

  if (legacy.length === 0) {
    // Nothing to migrate. Only rewrite the key if the legacy entry exists but
    // is empty/corrupt, which the removeLegacy flag handles below.
    return {
      results: scoped,
      writes: [],
      removeLegacy: legacyRaw != null,
    };
  }

  const { mine, others } = partitionLegacyResults<T>(legacy, userId);
  const results = mergePendingResults<T>(scoped, mine);
  const writes: PendingResultsWrite<T>[] = [{ key: pendingResultsKey(userId), results }];
  for (const [otherId, list] of Object.entries(others)) {
    writes.push({ key: pendingResultsKey(otherId), results: list });
  }
  return { results, writes, removeLegacy: true };
};

/**
 * What a user's key should hold after `results` are written to it.
 *
 * The in-memory list is only a cache of that key and is not guaranteed to
 * have been loaded for THIS user (a second account on the same handset, a
 * save before the first load). Overwriting the key with the in-memory view
 * would then drop results that exist only in storage, so a write merges with
 * what is already there. `dropIds` removes entries that were just synced.
 */
export const mergeIntoStoredResults = <T extends ScopedPendingResult>(
  existingRaw: string | null | undefined,
  results: T[],
  dropIds?: ReadonlySet<string>
): T[] => {
  const existing = parsePendingResults<T>(existingRaw).filter(
    (r) => !(typeof r.id === 'string' && dropIds?.has(r.id))
  );
  return mergePendingResults(existing, results);
};

/**
 * Keys to delete for a sign-out: NONE, for either reason.
 *
 * FIXED (G4 · H12): a `user` sign-out used to delete this account's pending
 * results AND the pre-split legacy key. Both are destruction of unsynced work,
 * which `@lantern/shared/offlineQueue` forbids outright (`decidePurge` cannot
 * return "delete"): the student may be lending the handset or switching
 * accounts, and the legacy key can hold a DIFFERENT account's un-migrated
 * results. Everything here is owner-stamped, so leaving it costs nothing —
 * this owner's next sign-in replays it, another account's sign-in quarantines
 * it (`planPendingResultsLoad` / `partitionLegacyResults` above).
 *
 * Kept as a function, and still called from `signOutStorageKeys`, so the rule
 * has one visible home rather than being an absence.
 */
export const pendingResultsKeysToClearOnSignOut = (
  _reason: 'user' | 'revoked',
  _userId: string | null | undefined
): string[] => [];
