/**
 * The web half of the cross-account offline-queue guard (F2 · E3 C5).
 *
 * Two invariants, and they pull against each other, which is why this file
 * exists:
 *   1. work queued by A is NEVER replayed into B's account;
 *   2. work queued by A is NEVER deleted — signing back in must return it.
 *
 * The old guard satisfied neither in the case that actually happened: logout
 * wiped the owner stamp (it starts `lantern_`) and left `pendingSyncResults`
 * (it does not), so B signed in, found no stamp, and adopted A's finished
 * tests; and when a stamp WAS present, the guard purged the other account's
 * queue outright.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory: Record<string, string> = {};
// The guard no-ops when there is no `window` (SSR), so the node test env needs one.
vi.stubGlobal('window', { name: 'test' });
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory[key] ?? null,
  setItem: (key: string, value: string) => {
    memory[key] = value;
  },
  removeItem: (key: string) => {
    delete memory[key];
  },
  clear: () => {
    for (const key of Object.keys(memory)) delete memory[key];
  },
  key: (i: number) => Object.keys(memory)[i] ?? null,
  get length() {
    return Object.keys(memory).length;
  },
});

import { shouldClearClientStorageKeyOnLogout } from '@lantern/shared';
import {
  ensureOfflineQueueOwner,
  isOfflineQueueOwner,
  takeQuarantinedQueue,
} from './offlineQueueOwner';

const OWNER_KEY = 'lantern_offline_owner';
const ERA_KEY = 'lantern_offline_owner_era';
const QUEUE_KEY = 'pendingSyncResults';
const A_RESULTS = '[{"id":"result-a1"},{"id":"result-a2"}]';

/** What `clearAllClientAuthStorage` does to localStorage on sign-out. */
function simulateLogoutWipe(): void {
  for (const key of Object.keys(memory)) {
    if (shouldClearClientStorageKeyOnLogout(key)) delete memory[key];
  }
}

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
});

describe('ensureOfflineQueueOwner', () => {
  it('claims an empty queue on a fresh browser and reports nothing to reset', () => {
    expect(ensureOfflineQueueOwner('user-a')).toBe(false);
    expect(localStorage.getItem(OWNER_KEY)).toBe('user-a');
    expect(localStorage.getItem(ERA_KEY)).toBe('1');
    expect(isOfflineQueueOwner('user-a')).toBe(true);
  });

  it('is a no-op for the same user signing in again', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);

    expect(ensureOfflineQueueOwner('user-a')).toBe(false);
    expect(localStorage.getItem(QUEUE_KEY)).toBe(A_RESULTS);
  });

  it('does NOT purge another account\'s queue — it sets it aside', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);

    expect(ensureOfflineQueueOwner('user-b')).toBe(true);

    // B cannot see or upload it.
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(isOfflineQueueOwner('user-b')).toBe(true);
    // And it still exists, filed under A.
    expect(
      JSON.parse(localStorage.getItem('lantern_offline_quarantine:pendingSyncResults:user-a') || '[]')
    ).toHaveLength(2);
  });

  it('gives A their work back when A signs in again', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);
    ensureOfflineQueueOwner('user-b');

    ensureOfflineQueueOwner('user-a');
    const restored = takeQuarantinedQueue<{ id?: string }>(QUEUE_KEY, 'user-a');

    expect(restored.map((r) => r.id)).toEqual(['result-a1', 'result-a2']);
    // The bucket is emptied once handed over, so it cannot be replayed twice.
    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-a')).toEqual([]);
  });

  it('restores the qbank queue in place when its owner returns', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem('lantern_pending_qbank_scores', '[{"listingId":"l1"}]');
    ensureOfflineQueueOwner('user-b');
    expect(localStorage.getItem('lantern_pending_qbank_scores')).toBeNull();

    ensureOfflineQueueOwner('user-a');

    // That queue has no store mirror, so it goes straight back to the live key.
    expect(
      JSON.parse(localStorage.getItem('lantern_pending_qbank_scores') || '[]')
    ).toEqual([{ listingId: 'l1', userId: 'user-a' }]);
  });

  it('never hands one account another account\'s quarantined work', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);
    ensureOfflineQueueOwner('user-b');

    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-b')).toEqual([]);
  });
});

describe('the C5 chain: logout then a different account signs in', () => {
  it('keeps the owner stamp through the logout storage wipe', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);
    localStorage.setItem('lantern_decks', 'x');

    simulateLogoutWipe();

    expect(localStorage.getItem(OWNER_KEY)).toBe('user-a');
    expect(localStorage.getItem(ERA_KEY)).toBe('1');
    expect(localStorage.getItem('lantern_decks')).toBeNull();
  });

  it('does not replay A\'s results into B after a logout', () => {
    ensureOfflineQueueOwner('user-a');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);
    simulateLogoutWipe();

    expect(ensureOfflineQueueOwner('user-b')).toBe(true);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-b')).toEqual([]);
    // A gets them back.
    ensureOfflineQueueOwner('user-a');
    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-a')).toHaveLength(2);
  });

  it('quarantines rather than adopts an unattributable queue with no stamp at all', () => {
    // A browser where the stamp was lost and nothing says whose results these
    // are: neither replay nor deletion is acceptable.
    localStorage.setItem(ERA_KEY, '1');
    localStorage.setItem(QUEUE_KEY, A_RESULTS);

    expect(ensureOfflineQueueOwner('user-b')).toBe(true);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem('lantern_offline_quarantine:pendingSyncResults:unknown') || '[]'
      )
    ).toHaveLength(2);
  });

  it('adopts a genuinely pre-stamping queue (era marker absent, nothing queued)', () => {
    expect(ensureOfflineQueueOwner('user-a')).toBe(false);
    expect(isOfflineQueueOwner('user-a')).toBe(true);
  });
});

/**
 * G4 · H13 — the device stamp is not the only evidence of ownership. Offline
 * results carry the session they were taken in, and that names the account.
 * Quarantining them under `unknown` kept provable work on disk forever:
 * `takeQuarantinedQueue` only ever read `…:<userId>`.
 */
describe('per-entry ownership', () => {
  const B_OWNED = JSON.stringify([
    { id: 'r1', sessionPayload: { userId: 'user-b' } },
    { id: 'r2', sessionPayload: { userId: 'user-b' } },
  ]);

  it('reclaims entries that name the returning user even with no device stamp', () => {
    // The E3 C5 device state: stamp wiped by the old logout bug, queue intact.
    localStorage.setItem(ERA_KEY, '1');
    localStorage.setItem(QUEUE_KEY, B_OWNED);

    // Nothing is set aside at all: the entries prove they are B's, so they
    // stay in the live queue and replay. Before the fix the whole queue went
    // to the `unknown` bucket, which nothing ever read.
    expect(ensureOfflineQueueOwner('user-b')).toBe(false);

    expect(
      localStorage.getItem('lantern_offline_quarantine:pendingSyncResults:unknown')
    ).toBeNull();
    expect(localStorage.getItem(QUEUE_KEY)).toBe(B_OWNED);
  });

  it('files an entry under the owner it names, not under the device stamp', () => {
    ensureOfflineQueueOwner('user-a'); // A stamps the device…
    localStorage.setItem(QUEUE_KEY, B_OWNED); // …but the work is B's.

    expect(ensureOfflineQueueOwner('user-c')).toBe(true);

    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-a')).toEqual([]);
    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-c')).toEqual([]);
    expect(takeQuarantinedQueue<{ id?: string }>(QUEUE_KEY, 'user-b')).toHaveLength(2);
  });

  it('splits a mixed queue per entry instead of condemning all of it', () => {
    localStorage.setItem(ERA_KEY, '1');
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        { id: 'mine', userId: 'user-b' },
        { id: 'theirs', userId: 'user-a' },
        { id: 'nobodys' },
      ])
    );

    expect(ensureOfflineQueueOwner('user-b')).toBe(true);

    expect(takeQuarantinedQueue<{ id?: string }>(QUEUE_KEY, 'user-b').map((r) => r.id)).toEqual([
      'mine',
    ]);
    expect(takeQuarantinedQueue<{ id?: string }>(QUEUE_KEY, 'user-a').map((r) => r.id)).toEqual([
      'theirs',
    ]);
    // The unattributable one stays put — replayed into nobody, deleted by nobody.
    expect(
      JSON.parse(
        localStorage.getItem('lantern_offline_quarantine:pendingSyncResults:unknown') || '[]'
      )
    ).toHaveLength(1);
  });

  it('hands back work an OLD quarantine filed under `unknown` but which names its owner', () => {
    // Written by the previous implementation; the fix must still let B in.
    localStorage.setItem(
      'lantern_offline_quarantine:pendingSyncResults:unknown',
      JSON.stringify([
        { id: 'r1', sessionPayload: { userId: 'user-b' } },
        { id: 'stranger' },
      ])
    );

    expect(takeQuarantinedQueue<{ id?: string }>(QUEUE_KEY, 'user-b').map((r) => r.id)).toEqual([
      'r1',
    ]);
    // The genuinely unattributable entry is written back, not consumed.
    expect(
      JSON.parse(
        localStorage.getItem('lantern_offline_quarantine:pendingSyncResults:unknown') || '[]'
      )
    ).toEqual([{ id: 'stranger' }]);
    expect(takeQuarantinedQueue(QUEUE_KEY, 'user-b')).toEqual([]);
  });
});
