/**
 * Offline sync queue — storage scoping.
 *
 * The queue used to persist EVERY account's operations under one key
 * (`lantern_sync_queue`), so on a shared handset the second student to sign in
 * loaded the previous student's queued creates/updates/deletes and replayed
 * them under their own session — and a sign-out wiped the queue for everyone.
 *
 * Operations are now stored per owner under `lantern_sync_queue:<userId>`.
 * This module is pure (no storage, no classes) so the key, partition and
 * migration rules can be unit-tested on their own.
 */

import type { SyncOperation } from './index';

/** The old, unscoped key. Read once so nothing queued before the split is lost. */
export const SYNC_QUEUE_LEGACY_KEY = 'lantern_sync_queue';

/** Storage key holding `userId`'s queued operations. */
export const syncQueueKey = (userId: string): string =>
  `${SYNC_QUEUE_LEGACY_KEY}:${userId}`;

/** The minimum an operation must expose for this module to place it. */
export interface OwnedSyncOperation {
  id?: string;
  userId?: string | null;
}

/** The persisted shape of one user's queue. */
export interface SyncQueueSnapshot<T extends OwnedSyncOperation = SyncOperation> {
  pendingOperations: T[];
  failedOperations: T[];
  lastSyncTime: number | null;
}

export const emptySyncQueueSnapshot = <
  T extends OwnedSyncOperation = SyncOperation
>(): SyncQueueSnapshot<T> => ({
  pendingOperations: [],
  failedOperations: [],
  lastSyncTime: null,
});

/**
 * Parse a raw storage value into a snapshot. Corrupt or non-object payloads
 * yield an empty snapshot rather than throwing — a bad cache must never break
 * sign-in, and a thrown parse would strand the queue entirely.
 */
export const parseSyncQueueSnapshot = <T extends OwnedSyncOperation = SyncOperation>(
  raw: string | null | undefined
): SyncQueueSnapshot<T> => {
  if (!raw) return emptySyncQueueSnapshot<T>();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptySyncQueueSnapshot<T>();
    return {
      pendingOperations: Array.isArray(parsed.pendingOperations)
        ? parsed.pendingOperations.filter(Boolean)
        : [],
      failedOperations: Array.isArray(parsed.failedOperations)
        ? parsed.failedOperations.filter(Boolean)
        : [],
      lastSyncTime: typeof parsed.lastSyncTime === 'number' ? parsed.lastSyncTime : null,
    };
  } catch {
    return emptySyncQueueSnapshot<T>();
  }
};

/**
 * Merge operation lists de-duplicating by `id`, LAST occurrence winning.
 * Operations without an id are all kept (they cannot be matched up).
 */
export const mergeOperationsById = <T extends OwnedSyncOperation>(
  ...lists: T[][]
): T[] => {
  const byId = new Map<string, T>();
  const unkeyed: T[] = [];
  for (const list of lists) {
    for (const op of list) {
      if (typeof op?.id === 'string' && op.id) byId.set(op.id, op);
      else if (op) unkeyed.push(op);
    }
  }
  return [...byId.values(), ...unkeyed];
};

/** Merge two snapshots; `incoming` wins on id collisions. */
export const mergeSyncQueueSnapshots = <T extends OwnedSyncOperation>(
  base: SyncQueueSnapshot<T>,
  incoming: SyncQueueSnapshot<T>
): SyncQueueSnapshot<T> => ({
  pendingOperations: mergeOperationsById(base.pendingOperations, incoming.pendingOperations),
  failedOperations: mergeOperationsById(base.failedOperations, incoming.failedOperations),
  lastSyncTime: Math.max(base.lastSyncTime ?? 0, incoming.lastSyncTime ?? 0) || null,
});

export interface LegacyQueuePartition<T extends OwnedSyncOperation> {
  /** Operations grouped by the account that queued them. */
  byUser: Record<string, T[]>;
  /** Operations that named no owner. They are DROPPED, never adopted. */
  dropped: number;
}

/**
 * Group legacy (unscoped) operations by owner.
 *
 * An operation with no `userId` is dropped and only counted. Unlike a finished
 * test result, a queued write is an instruction to change server state; there
 * is no honest way to guess whose account it should run against, and replaying
 * it under whoever signs in next is exactly the bug this scoping fixes.
 */
export const partitionLegacyQueue = <T extends OwnedSyncOperation>(
  ops: T[] | null | undefined
): LegacyQueuePartition<T> => {
  const byUser: Record<string, T[]> = {};
  let dropped = 0;
  for (const op of ops ?? []) {
    const owner = typeof op?.userId === 'string' && op.userId ? op.userId : null;
    if (!owner) {
      dropped++;
      continue;
    }
    (byUser[owner] ||= []).push(op);
  }
  return { byUser, dropped };
};

export interface SyncQueueWrite<T extends OwnedSyncOperation> {
  key: string;
  ops: SyncQueueSnapshot<T>;
}

export interface SyncQueueLoadPlan<T extends OwnedSyncOperation> {
  /** What the active user's in-memory queue should hold. */
  ops: SyncQueueSnapshot<T>;
  /** Storage writes to perform, in order. The active user's key comes first. */
  writes: SyncQueueWrite<T>[];
  /** Whether the legacy unscoped key should now be deleted. */
  removeLegacy: boolean;
  /** Ownerless legacy operations discarded by the migration. */
  droppedOwnerless: number;
}

/**
 * Work out what `userId` should load, and what the one-time legacy migration
 * must write, given the raw values of that user's key and the legacy key.
 * Pure: the caller performs the I/O.
 *
 * Scoped data wins over legacy data on an id collision — the scoped key is the
 * newer home, and the legacy copy is by definition the pre-split snapshot.
 */
export const planSyncQueueLoad = <T extends OwnedSyncOperation = SyncOperation>(
  userId: string,
  scopedRaw: string | null | undefined,
  legacyRaw: string | null | undefined
): SyncQueueLoadPlan<T> => {
  const scoped = parseSyncQueueSnapshot<T>(scopedRaw);

  if (legacyRaw == null) {
    return { ops: scoped, writes: [], removeLegacy: false, droppedOwnerless: 0 };
  }

  const legacy = parseSyncQueueSnapshot<T>(legacyRaw);
  const pending = partitionLegacyQueue<T>(legacy.pendingOperations);
  const failed = partitionLegacyQueue<T>(legacy.failedOperations);
  const droppedOwnerless = pending.dropped + failed.dropped;

  const owners = new Set([...Object.keys(pending.byUser), ...Object.keys(failed.byUser)]);

  const mine: SyncQueueSnapshot<T> = {
    pendingOperations: pending.byUser[userId] ?? [],
    failedOperations: failed.byUser[userId] ?? [],
    lastSyncTime: legacy.lastSyncTime,
  };
  // Scoped wins: it is merged in last.
  const ops = mergeSyncQueueSnapshots(mine, scoped);

  const writes: SyncQueueWrite<T>[] = [{ key: syncQueueKey(userId), ops }];
  for (const owner of owners) {
    if (owner === userId) continue;
    writes.push({
      key: syncQueueKey(owner),
      ops: {
        pendingOperations: pending.byUser[owner] ?? [],
        failedOperations: failed.byUser[owner] ?? [],
        lastSyncTime: legacy.lastSyncTime,
      },
    });
  }

  return { ops, writes, removeLegacy: true, droppedOwnerless };
};

/**
 * Keys to delete for a sign-out.
 *
 * `user`    — the student asked to sign out; drop their queue and the legacy key.
 * `revoked` — the server ended the session (expired/refused token). Their
 *             unsynced work MUST survive, so nothing is cleared.
 */
export const syncQueueKeysToClearOnSignOut = (
  reason: 'user' | 'revoked',
  userId: string | null | undefined
): string[] => {
  if (reason !== 'user') return [];
  const keys = [SYNC_QUEUE_LEGACY_KEY];
  if (userId) keys.push(syncQueueKey(userId));
  return keys;
};
