/**
 * Pending offline test results — storage scoping.
 *
 * Pending (unsynced) results used to live under one unkeyed AsyncStorage key,
 * so on a shared handset the next account to sign in loaded the previous
 * student's finished tests and uploaded them under the wrong user — and a
 * user-initiated sign-out wiped everyone's.
 *
 * Results are now stored per user under `@lantern_pending_results:<userId>`.
 * This module is pure (no store, no AsyncStorage, no supabase imports) so the
 * key/migration/partition rules can be unit-tested on their own.
 */

/** The old, unscoped key. Still read once per user so nothing is lost. */
export const PENDING_RESULTS_LEGACY_KEY = '@lantern_pending_results';

/** Storage key holding `userId`'s pending results. */
export const pendingResultsKey = (userId: string): string =>
  `${PENDING_RESULTS_LEGACY_KEY}:${userId}`;

/** Every result shape this module needs to reason about: an id and an owner. */
export interface ScopedPendingResult {
  id?: string;
  /** The account that finished the test. Absent on legacy entries. */
  userId?: string | null;
  /** Offline results carry the submitted session; it may name the owner. */
  sessionPayload?: unknown;
  /** Older entries carried the attempt instead. */
  attempt?: unknown;
}

/**
 * Parse a raw AsyncStorage value into a result list. Corrupt or non-array
 * payloads yield [] rather than throwing — a bad cache must not break sign-in.
 */
export const parsePendingResults = <T extends ScopedPendingResult>(
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

/**
 * Who owns a legacy entry, if it says. Reads the entry's own `userId` first,
 * then the attempt/session payload an offline result carries.
 */
export const resolveResultOwner = (result: ScopedPendingResult): string | null => {
  if (typeof result?.userId === 'string' && result.userId) return result.userId;
  const payload = result?.sessionPayload as { userId?: unknown } | undefined;
  if (payload && typeof payload.userId === 'string' && payload.userId) return payload.userId;
  const attempt = result?.attempt as { userId?: unknown } | undefined;
  if (attempt && typeof attempt.userId === 'string' && attempt.userId) return attempt.userId;
  return null;
};

/** Stamp the owning account onto a result (idempotent). */
export const stampOwner = <T extends ScopedPendingResult>(result: T, userId: string): T => ({
  ...result,
  userId,
});

/** Only the entries `userId` owns. Unowned entries are NOT assumed to be theirs. */
export const resultsOwnedBy = <T extends ScopedPendingResult>(
  results: T[],
  userId: string
): T[] => results.filter((r) => resolveResultOwner(r) === userId);

/**
 * Merge two result lists, de-duplicating by id and keeping the LAST occurrence
 * (the freshly loaded copy wins over an older one with the same id).
 */
export const mergePendingResults = <T extends ScopedPendingResult>(
  ...lists: T[][]
): T[] => {
  const byId = new Map<string, T>();
  const unkeyed: T[] = [];
  for (const list of lists) {
    for (const result of list) {
      if (typeof result?.id === 'string' && result.id) byId.set(result.id, result);
      else unkeyed.push(result);
    }
  }
  return [...byId.values(), ...unkeyed];
};

/**
 * Split legacy (unkeyed) entries for the user who is loading them.
 *
 * - entries naming an owner go to that owner;
 * - entries naming nobody are attributed to `userId` — the first account to
 *   load them — because on a single handset that is the only honest guess.
 */
export const partitionLegacyResults = <T extends ScopedPendingResult>(
  legacy: T[],
  userId: string
): { mine: T[]; others: Record<string, T[]> } => {
  const mine: T[] = [];
  const others: Record<string, T[]> = {};
  for (const result of legacy) {
    const owner = resolveResultOwner(result);
    if (!owner || owner === userId) {
      mine.push(stampOwner(result, userId));
    } else {
      (others[owner] ||= []).push(stampOwner(result, owner));
    }
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
 * Keys to delete for a sign-out.
 *
 * `user`   — the student asked; drop their pending results and the legacy key.
 * `revoked` — the server ended the session. Their unsynced work MUST survive.
 */
export const pendingResultsKeysToClearOnSignOut = (
  reason: 'user' | 'revoked',
  userId: string | null | undefined
): string[] => {
  if (reason !== 'user') return [];
  const keys = [PENDING_RESULTS_LEGACY_KEY];
  if (userId) keys.push(pendingResultsKey(userId));
  return keys;
};
