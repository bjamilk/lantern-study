import {
  SYNC_QUEUE_LEGACY_KEY,
  mergeOperationsById,
  mergeSyncQueueSnapshots,
  parseSyncQueueSnapshot,
  partitionLegacyQueue,
  planSyncQueueLoad,
  syncQueueKey,
  syncQueueKeysToClearOnSignOut,
} from './syncQueueScope';
import { SyncQueue, type SyncOperation } from './index';
import type { IStorageAdapter } from '../storage';

const op = (id: string, userId?: string | null, extra: Partial<SyncOperation> = {}) =>
  ({
    id,
    entityType: 'note',
    entityId: `e_${id}`,
    operation: 'create',
    data: {},
    timestamp: 1,
    retryCount: 0,
    maxRetries: 3,
    userId,
    ...extra,
  } as SyncOperation);

const snapshot = (pending: SyncOperation[], failed: SyncOperation[] = [], lastSyncTime = 5) =>
  JSON.stringify({ pendingOperations: pending, failedOperations: failed, lastSyncTime });

class MemoryStorage implements IStorageAdapter {
  store = new Map<string, string>();
  async getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  async removeItem(key: string) {
    this.store.delete(key);
  }
  async clear() {
    this.store.clear();
  }
  async getAllKeys() {
    return [...this.store.keys()];
  }
}

describe('syncQueueKey', () => {
  it('scopes the legacy key by user', () => {
    expect(SYNC_QUEUE_LEGACY_KEY).toBe('lantern_sync_queue');
    expect(syncQueueKey('u1')).toBe('lantern_sync_queue:u1');
  });
});

describe('parseSyncQueueSnapshot', () => {
  it('returns an empty snapshot for missing or corrupt values', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"x"']) {
      expect(parseSyncQueueSnapshot(raw as string | null)).toEqual({
        pendingOperations: [],
        failedOperations: [],
        lastSyncTime: null,
      });
    }
  });

  it('keeps well-formed lists and a numeric lastSyncTime', () => {
    const parsed = parseSyncQueueSnapshot(snapshot([op('a', 'u1')], [op('b', 'u1')], 42));
    expect(parsed.pendingOperations.map((o) => o.id)).toEqual(['a']);
    expect(parsed.failedOperations.map((o) => o.id)).toEqual(['b']);
    expect(parsed.lastSyncTime).toBe(42);
  });

  it('ignores non-array buckets and non-numeric timestamps', () => {
    const parsed = parseSyncQueueSnapshot(
      JSON.stringify({ pendingOperations: 'nope', failedOperations: null, lastSyncTime: 'soon' })
    );
    expect(parsed).toEqual({ pendingOperations: [], failedOperations: [], lastSyncTime: null });
  });
});

describe('mergeOperationsById', () => {
  it('de-duplicates by id with the last occurrence winning', () => {
    const merged = mergeOperationsById(
      [op('a', 'u1', { timestamp: 1 })],
      [op('a', 'u1', { timestamp: 2 }), op('b', 'u1')]
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((o) => o.id === 'a')!.timestamp).toBe(2);
  });
});

describe('mergeSyncQueueSnapshots', () => {
  it('merges both buckets and keeps the later sync time', () => {
    const merged = mergeSyncQueueSnapshots(
      { pendingOperations: [op('a', 'u1')], failedOperations: [], lastSyncTime: 10 },
      { pendingOperations: [op('b', 'u1')], failedOperations: [op('c', 'u1')], lastSyncTime: 3 }
    );
    expect(merged.pendingOperations.map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(merged.failedOperations.map((o) => o.id)).toEqual(['c']);
    expect(merged.lastSyncTime).toBe(10);
  });
});

describe('partitionLegacyQueue', () => {
  it('groups operations by owner', () => {
    const { byUser, dropped } = partitionLegacyQueue([
      op('a', 'u1'),
      op('b', 'u2'),
      op('c', 'u1'),
    ]);
    expect(byUser.u1.map((o) => o.id)).toEqual(['a', 'c']);
    expect(byUser.u2.map((o) => o.id)).toEqual(['b']);
    expect(dropped).toBe(0);
  });

  it('drops ownerless operations instead of adopting them', () => {
    const { byUser, dropped } = partitionLegacyQueue([
      op('a', null),
      op('b', undefined),
      op('c', ''),
      op('d', 'u1'),
    ]);
    expect(Object.keys(byUser)).toEqual(['u1']);
    expect(dropped).toBe(3);
  });

  it('tolerates a missing list', () => {
    expect(partitionLegacyQueue(null)).toEqual({ byUser: {}, dropped: 0 });
  });
});

describe('planSyncQueueLoad', () => {
  it('loads only the scoped key when there is no legacy key', () => {
    const plan = planSyncQueueLoad('u1', snapshot([op('a', 'u1')]), null);
    expect(plan.ops.pendingOperations.map((o) => o.id)).toEqual(['a']);
    expect(plan.writes).toEqual([]);
    expect(plan.removeLegacy).toBe(false);
  });

  it('migrates each owner to their own key and removes the legacy key', () => {
    const legacy = snapshot([op('a', 'u1'), op('b', 'u2')], [op('c', 'u2')]);
    const plan = planSyncQueueLoad('u1', null, legacy);

    expect(plan.ops.pendingOperations.map((o) => o.id)).toEqual(['a']);
    expect(plan.ops.failedOperations).toEqual([]);
    expect(plan.removeLegacy).toBe(true);

    expect(plan.writes[0].key).toBe(syncQueueKey('u1'));
    expect(plan.writes[0].ops.pendingOperations.map((o) => o.id)).toEqual(['a']);

    const other = plan.writes.find((w) => w.key === syncQueueKey('u2'))!;
    expect(other.ops.pendingOperations.map((o) => o.id)).toEqual(['b']);
    expect(other.ops.failedOperations.map((o) => o.id)).toEqual(['c']);
  });

  it('never gives the loading user another account operations', () => {
    const plan = planSyncQueueLoad('u1', null, snapshot([op('b', 'u2')]));
    expect(plan.ops.pendingOperations).toEqual([]);
  });

  it('drops ownerless legacy operations and reports the count', () => {
    const plan = planSyncQueueLoad('u1', null, snapshot([op('x', null)], [op('y', null)]));
    expect(plan.ops.pendingOperations).toEqual([]);
    expect(plan.droppedOwnerless).toBe(2);
  });

  it('merges scoped over legacy on an id collision', () => {
    const plan = planSyncQueueLoad(
      'u1',
      snapshot([op('a', 'u1', { timestamp: 99 })]),
      snapshot([op('a', 'u1', { timestamp: 1 }), op('z', 'u1')])
    );
    const a = plan.ops.pendingOperations.find((o) => o.id === 'a')!;
    expect(a.timestamp).toBe(99);
    expect(plan.ops.pendingOperations.map((o) => o.id).sort()).toEqual(['a', 'z']);
  });
});

describe('syncQueueKeysToClearOnSignOut', () => {
  it('clears the user key and the legacy key on a user sign-out', () => {
    expect(syncQueueKeysToClearOnSignOut('user', 'u1')).toEqual([
      SYNC_QUEUE_LEGACY_KEY,
      syncQueueKey('u1'),
    ]);
    expect(syncQueueKeysToClearOnSignOut('user', null)).toEqual([SYNC_QUEUE_LEGACY_KEY]);
  });

  it('keeps everything when the session was revoked', () => {
    expect(syncQueueKeysToClearOnSignOut('revoked', 'u1')).toEqual([]);
  });
});

describe('SyncQueue user scoping', () => {
  it('starts with no active user and keeps legacy behaviour', async () => {
    const storage = new MemoryStorage();
    storage.store.set(SYNC_QUEUE_LEGACY_KEY, snapshot([op('a', 'u1')]));
    const queue = new SyncQueue(storage);
    await queue.initialize();

    expect(queue.getActiveUserId()).toBeNull();
    expect(queue.getPendingCount()).toBe(1);

    await queue.enqueue('note', 'n1', 'create', {}, 'u2');
    expect(queue.getPendingCount()).toBe(2);
    expect(storage.store.has(SYNC_QUEUE_LEGACY_KEY)).toBe(true);
  });

  it('migrates the legacy queue per owner on the first setActiveUser', async () => {
    const storage = new MemoryStorage();
    storage.store.set(
      SYNC_QUEUE_LEGACY_KEY,
      snapshot([op('a', 'u1'), op('b', 'u2'), op('orphan', null)])
    );
    const queue = new SyncQueue(storage);
    await queue.setActiveUser('u1');

    expect(queue.getActiveUserId()).toBe('u1');
    expect(queue.getStatus().pendingOperations.map((o) => o.id)).toEqual(['a']);
    expect(storage.store.has(SYNC_QUEUE_LEGACY_KEY)).toBe(false);

    const u2 = parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u2'))!);
    expect(u2.pendingOperations.map((o) => o.id)).toEqual(['b']);

    const all = [...storage.store.values()].join('');
    expect(all).not.toContain('orphan');
  });

  it('swaps in-memory operations when the account changes and keeps both persisted', async () => {
    const storage = new MemoryStorage();
    const queue = new SyncQueue(storage);

    await queue.setActiveUser('u1');
    await queue.enqueue('note', 'n1', 'create', {}, 'u1');
    expect(queue.getPendingCount()).toBe(1);

    await queue.setActiveUser('u2');
    expect(queue.getPendingCount()).toBe(0);
    await queue.enqueue('note', 'n2', 'create', {}, 'u2');
    expect(queue.getPendingCount()).toBe(1);

    await queue.setActiveUser('u1');
    expect(queue.getStatus().pendingOperations.map((o) => o.entityId)).toEqual(['n1']);
    expect(
      parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u2'))!).pendingOperations
    ).toHaveLength(1);
  });

  it('persists a foreign-user enqueue to that user key without queueing it locally', async () => {
    const storage = new MemoryStorage();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = new SyncQueue(storage);
    await queue.setActiveUser('u1');

    await queue.enqueue('note', 'n9', 'update', {}, 'u2');

    expect(queue.getPendingCount()).toBe(0);
    const u2 = parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u2'))!);
    expect(u2.pendingOperations.map((o) => o.entityId)).toEqual(['n9']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('processes and counts only the active user operations', async () => {
    const storage = new MemoryStorage();
    storage.store.set(syncQueueKey('u2'), snapshot([op('b', 'u2')], [op('f', 'u2')]));
    const queue = new SyncQueue(storage);
    await queue.setActiveUser('u1');
    await queue.enqueue('note', 'n1', 'create', {}, 'u1');

    const seen: string[] = [];
    queue.registerHandler('note', async (o) => {
      seen.push(o.entityId);
      return true;
    });

    expect(queue.hasPendingOperations()).toBe(true);
    expect(queue.getFailedCount()).toBe(0);
    const result = await queue.processQueue();

    expect(result).toEqual({ success: 1, failed: 0 });
    expect(seen).toEqual(['n1']);
    expect(
      parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u2'))!).pendingOperations
    ).toHaveLength(1);
  });

  it('abandons an in-flight run when the account changes and never touches the new user state', async () => {
    const storage = new MemoryStorage();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = new SyncQueue(storage);
    await queue.setActiveUser('u1');
    await queue.enqueue('note', 'n1', 'create', {}, 'u1');
    await queue.enqueue('note', 'n2', 'create', {}, 'u1');

    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    queue.registerHandler('note', async (o) => {
      seen.push(o.entityId);
      await gate;
      return true;
    });

    const run = queue.processQueue();
    // U1 signs out and U2 signs in while n1 is still in flight.
    await queue.setActiveUser(null);
    await queue.setActiveUser('u2');
    release();
    await run;

    // n2 never ran under U2's session, and U2's queue picked up nothing.
    expect(seen).toEqual(['n1']);
    expect(queue.getActiveUserId()).toBe('u2');
    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getFailedCount()).toBe(0);
    expect(storage.store.has(syncQueueKey('u2'))).toBe(false);

    // U1's stored queue dropped the op that did complete and kept the other.
    const u1 = parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u1'))!);
    expect(u1.pendingOperations.map((o) => o.entityId)).toEqual(['n2']);
    warn.mockRestore();
  });

  it('does not persist an empty snapshot while the next account is still loading', async () => {
    const storage = new MemoryStorage();
    storage.store.set(syncQueueKey('u2'), snapshot([op('b', 'u2')]));
    // Slow reads so processQueue can run inside the switch window.
    const slow = new MemoryStorage();
    slow.store = storage.store;
    slow.getItem = async (key: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return storage.store.has(key) ? storage.store.get(key)! : null;
    };
    const queue = new SyncQueue(slow);
    const switching = queue.setActiveUser('u2');
    await expect(queue.processQueue()).resolves.toEqual({ success: 0, failed: 0 });
    await switching;

    expect(queue.getPendingCount()).toBe(1);
    expect(
      parseSyncQueueSnapshot(storage.store.get(syncQueueKey('u2'))!).pendingOperations
    ).toHaveLength(1);
  });

  it('clears only the active user, and clearForUser targets one account', async () => {
    const storage = new MemoryStorage();
    storage.store.set(syncQueueKey('u2'), snapshot([op('b', 'u2')]));
    const queue = new SyncQueue(storage);
    await queue.setActiveUser('u1');
    await queue.enqueue('note', 'n1', 'create', {}, 'u1');

    await queue.clear();
    expect(queue.getPendingCount()).toBe(0);
    expect(storage.store.has(syncQueueKey('u2'))).toBe(true);

    await queue.clearForUser('u2');
    expect(storage.store.has(syncQueueKey('u2'))).toBe(false);
  });
});
