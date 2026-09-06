import { SYNC_QUEUE_LEGACY_KEY, syncQueueKey } from '@lantern/shared/sync';
import {
  PENDING_QBANK_SCORES_LEGACY_KEY,
  pendingQbankScoresKey,
} from '../utils/pendingQuestionBankScoresScope';
import { PENDING_RESULTS_LEGACY_KEY, pendingResultsKey } from './pendingResultsScope';
import {
  UNSYNCED_WORK_LEGACY_KEYS,
  planSignOutKeyRemoval,
  unsyncedWorkKeys,
  unsyncedWorkKeysToClearOnSignOut,
} from './signOutStorageKeys';

const ME = 'user-1';
const THEM = 'user-2';

const candidates = (userId: string) => [
  'lantern_decks',
  PENDING_RESULTS_LEGACY_KEY,
  SYNC_QUEUE_LEGACY_KEY,
  PENDING_QBANK_SCORES_LEGACY_KEY,
  pendingResultsKey(userId),
  syncQueueKey(userId),
  pendingQbankScoresKey(userId),
  `lantern-settings:${userId}`,
];

describe('unsyncedWorkKeys', () => {
  it('covers all three outbound queues, legacy and scoped', () => {
    expect(unsyncedWorkKeys(ME)).toEqual([
      ...UNSYNCED_WORK_LEGACY_KEYS,
      pendingResultsKey(ME),
      syncQueueKey(ME),
      pendingQbankScoresKey(ME),
    ]);
  });

  it('lists only the legacy keys when nobody is signed in', () => {
    expect(unsyncedWorkKeys(null)).toEqual([...UNSYNCED_WORK_LEGACY_KEYS]);
  });
});

describe('unsyncedWorkKeysToClearOnSignOut', () => {
  it('clears this account and the legacy keys when the student asked', () => {
    expect(new Set(unsyncedWorkKeysToClearOnSignOut('user', ME))).toEqual(
      new Set([
        ...UNSYNCED_WORK_LEGACY_KEYS,
        pendingResultsKey(ME),
        syncQueueKey(ME),
        pendingQbankScoresKey(ME),
      ])
    );
  });

  it('clears nothing when the server revoked the session', () => {
    expect(unsyncedWorkKeysToClearOnSignOut('revoked', ME)).toEqual([]);
  });
});

describe('planSignOutKeyRemoval', () => {
  it('removes this account’s queues on a user sign-out', () => {
    expect(planSignOutKeyRemoval('user', ME, candidates(ME))).toEqual(candidates(ME));
  });

  it('keeps every unsynced queue on a revoked session, caches still go', () => {
    expect(planSignOutKeyRemoval('revoked', ME, candidates(ME))).toEqual([
      'lantern_decks',
      `lantern-settings:${ME}`,
    ]);
  });

  it('never removes another account’s queues, whatever the reason', () => {
    const foreign = [
      pendingResultsKey(THEM),
      syncQueueKey(THEM),
      pendingQbankScoresKey(THEM),
    ];
    for (const reason of ['user', 'revoked'] as const) {
      const kept = planSignOutKeyRemoval(reason, ME, [...foreign, 'lantern_stats']);
      expect(kept).toEqual(['lantern_stats']);
    }
  });

  it('removes only the legacy queues when no user id is known', () => {
    const keys = planSignOutKeyRemoval('user', null, [
      ...UNSYNCED_WORK_LEGACY_KEYS,
      syncQueueKey(THEM),
      'lantern_tests',
    ]);
    expect(keys).toEqual([...UNSYNCED_WORK_LEGACY_KEYS, 'lantern_tests']);
  });

  it('collapses duplicates and preserves order', () => {
    expect(
      planSignOutKeyRemoval('user', ME, ['a', 'b', 'a', syncQueueKey(ME), 'b'])
    ).toEqual(['a', 'b', syncQueueKey(ME)]);
  });

  it('passes unrelated keys through untouched', () => {
    const keys = ['budgetTransactions', 'monthlyBudget', `walletBalance_${ME}`];
    expect(planSignOutKeyRemoval('revoked', ME, keys)).toEqual(keys);
  });
});
