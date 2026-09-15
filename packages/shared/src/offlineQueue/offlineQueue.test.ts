/**
 * The offline-queue policy, pinned against the two ways it can hurt a student:
 * uploading A's finished test into B's account, and deleting unsynced work.
 */
import {
  OFFLINE_QUEUE_ERA_KEY,
  OFFLINE_QUEUE_LEGACY_KEYS,
  OFFLINE_QUEUE_OWNER_KEY,
  createMemoryOfflineQueueStorage,
  decidePurge,
  ensureResultIdempotencyKey,
  entriesOwnedBy,
  isOfflineQueuePreservedKey,
  mergeQueues,
  mintResultIdempotencyKey,
  offlineQueueQuarantineKey,
  parseQueue,
  quarantineEntries,
  resolveEntryOwner,
  resultIdempotencyKey,
  stampOwner,
} from './index';

describe('ownership', () => {
  it('reads the owner off the entry, then the session payload, then the attempt', () => {
    expect(resolveEntryOwner({ userId: 'a' })).toBe('a');
    expect(resolveEntryOwner({ sessionPayload: { userId: 'b' } })).toBe('b');
    expect(resolveEntryOwner({ attempt: { userId: 'c' } })).toBe('c');
    expect(resolveEntryOwner({})).toBeNull();
    expect(resolveEntryOwner(null)).toBeNull();
  });

  it('stamps without mutating and is idempotent', () => {
    const entry = { id: 'r1' };
    const once = stampOwner(entry, 'a');
    expect(once).toEqual({ id: 'r1', userId: 'a' });
    expect(entry).toEqual({ id: 'r1' });
    expect(stampOwner(once, 'a')).toEqual(once);
  });

  it('never treats an unowned entry as the current user\'s', () => {
    expect(entriesOwnedBy([{ id: '1' }, { id: '2', userId: 'a' }], 'a')).toEqual([
      { id: '2', userId: 'a' },
    ]);
  });
});

describe('decidePurge', () => {
  it('replays the signed-in user\'s own work', () => {
    const d = decidePurge({ entryOwner: 'a', currentUser: 'a', stampPresent: true });
    expect(d).toEqual({
      decision: 'own',
      purge: false,
      replay: true,
      stampAs: 'a',
      quarantineOwner: null,
    });
  });

  it('PRESERVES another account\'s work — never purges it, never replays it', () => {
    const d = decidePurge({ entryOwner: 'a', currentUser: 'b', stampPresent: true });
    expect(d.decision).toBe('preserve');
    expect(d.purge).toBe(false);
    expect(d.replay).toBe(false);
    expect(d.stampAs).toBeNull();
    // Filed under its real owner so signing back in returns it.
    expect(d.quarantineOwner).toBe('a');
  });

  it('adopts a legacy entry only with BOTH proofs', () => {
    expect(
      decidePurge({
        currentUser: 'b',
        stampPresent: false,
        createdBeforeStamping: true,
        otherSignedInEvidence: false,
      }).decision
    ).toBe('adopt');
  });

  it('quarantines an unstamped entry when another account has used the device', () => {
    const d = decidePurge({
      currentUser: 'b',
      stampPresent: false,
      createdBeforeStamping: true,
      otherSignedInEvidence: true,
    });
    expect(d.decision).toBe('quarantine');
    expect(d.replay).toBe(false);
    expect(d.purge).toBe(false);
  });

  it('quarantines an unstamped entry that is not provably pre-stamping (the C5 hole)', () => {
    // Exactly the logout case: the stamp was wiped, the queue was not.
    const d = decidePurge({
      currentUser: 'b',
      stampPresent: false,
      createdBeforeStamping: false,
      otherSignedInEvidence: false,
    });
    expect(d.decision).toBe('quarantine');
    expect(d.replay).toBe(false);
  });

  it('holds everything when nobody is signed in', () => {
    const d = decidePurge({ entryOwner: 'a', currentUser: null, stampPresent: true });
    expect(d.decision).toBe('quarantine');
    expect(d.replay).toBe(false);
    expect(d.quarantineOwner).toBe('a');
  });

  it('never answers purge', () => {
    const inputs = [
      { entryOwner: 'a', currentUser: 'a', stampPresent: true },
      { entryOwner: 'a', currentUser: 'b', stampPresent: true },
      { currentUser: 'b', stampPresent: false },
      { currentUser: null, stampPresent: false },
    ];
    for (const input of inputs) expect(decidePurge(input).purge).toBe(false);
  });
});

describe('logout must not erase the stamp', () => {
  it('protects the owner key, the era marker and every quarantine bucket', () => {
    expect(isOfflineQueuePreservedKey(OFFLINE_QUEUE_OWNER_KEY)).toBe(true);
    expect(isOfflineQueuePreservedKey(OFFLINE_QUEUE_ERA_KEY)).toBe(true);
    expect(isOfflineQueuePreservedKey(offlineQueueQuarantineKey('pendingSyncResults', 'a'))).toBe(
      true
    );
    expect(isOfflineQueuePreservedKey('lantern_decks')).toBe(false);
  });

  // G4 · H12: a sign-out used to delete the queues themselves on mobile —
  // including the pre-split legacy keys, which can hold an account that is not
  // the one signing out.
  it('protects every queue key, legacy and per-user, on both platforms', () => {
    for (const legacy of OFFLINE_QUEUE_LEGACY_KEYS) {
      expect(isOfflineQueuePreservedKey(legacy)).toBe(true);
      expect(isOfflineQueuePreservedKey(`${legacy}:user-1`)).toBe(true);
    }
    // Named explicitly so a rename of either constant is caught here.
    expect(isOfflineQueuePreservedKey('@lantern_pending_results')).toBe(true);
    expect(isOfflineQueuePreservedKey('lantern_sync_queue:user-1')).toBe(true);
    expect(isOfflineQueuePreservedKey('@lantern_pending_qbank_scores:user-1')).toBe(true);
    expect(isOfflineQueuePreservedKey('pendingSyncResults')).toBe(true);
    // A cache that merely starts the same way is not a queue.
    expect(isOfflineQueuePreservedKey('lantern_sync_queue_meta')).toBe(false);
  });
});

describe('idempotency key', () => {
  it('is stable across retries once stamped', () => {
    const queued = ensureResultIdempotencyKey({ id: 'r1', userId: 'a' });
    expect(queued.idempotencyKey).toBeTruthy();
    // Every retry re-reads the SAME key.
    expect(resultIdempotencyKey(queued)).toBe(queued.idempotencyKey);
    expect(resultIdempotencyKey(queued)).toBe(resultIdempotencyKey(queued));
    // Re-running the enqueue helper does not re-mint.
    expect(ensureResultIdempotencyKey(queued)).toBe(queued);
  });

  it('mints a distinct key per attempt', () => {
    expect(mintResultIdempotencyKey()).not.toBe(mintResultIdempotencyKey());
  });

  it('derives a DETERMINISTIC key for an entry queued before keys existed', () => {
    const legacy = { id: 'r9', userId: 'a' };
    expect(resultIdempotencyKey(legacy)).toBe(resultIdempotencyKey(legacy));
    expect(resultIdempotencyKey(legacy)).toContain('legacy');
    // Different attempts still get different keys.
    expect(resultIdempotencyKey({ id: 'r10', userId: 'a' })).not.toBe(
      resultIdempotencyKey(legacy)
    );
  });

  it('stays within the server\'s 128-char cap', () => {
    const key = resultIdempotencyKey({ id: 'x'.repeat(400), userId: 'y'.repeat(400) });
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe('storage adapter and queue helpers', () => {
  it('round-trips through the memory adapter', async () => {
    const storage = createMemoryOfflineQueueStorage({ seed: '1' } as Record<string, string>);
    expect(await storage.get('seed')).toBe('1');
    await storage.set('k', 'v');
    expect(await storage.get('k')).toBe('v');
    await storage.remove('k');
    expect(await storage.get('k')).toBeNull();
  });

  it('reads a corrupt queue as empty instead of throwing', () => {
    expect(parseQueue('{not json')).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue(null)).toEqual([]);
  });

  it('merges by id, keeping the freshest copy, and never drops id-less entries', () => {
    const merged = mergeQueues(
      [{ id: 'a', userId: 'old' }, { userId: 'x' }],
      [{ id: 'a', userId: 'new' }]
    );
    expect(merged).toEqual([{ id: 'a', userId: 'new' }, { userId: 'x' }]);
  });

  it('quarantining adds to a bucket rather than replacing it', () => {
    const existing = JSON.stringify([{ id: 'r1', userId: 'a' }]);
    expect(quarantineEntries(existing, [{ id: 'r2', userId: 'a' }])).toEqual([
      { id: 'r1', userId: 'a' },
      { id: 'r2', userId: 'a' },
    ]);
  });
});
