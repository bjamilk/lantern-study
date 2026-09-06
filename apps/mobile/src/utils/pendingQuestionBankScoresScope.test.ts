/**
 * Pure scoping rules for the pending question-bank score queue: keys, owners,
 * per-user partitioning, the legacy drop, and the sign-out key list.
 * No store / AsyncStorage / services imports.
 */
import {
  PENDING_QBANK_SCORES_LEGACY_KEY,
  parsePendingQbankScores,
  pendingQbankScoreKeysToClearOnSignOut,
  pendingQbankScoresKey,
  planPendingQbankScoresLoad,
  resolveScoreOwner,
  scoresOwnedBy,
  stampScoreOwner,
  type ScopedPendingQuestionBankScore,
} from './pendingQuestionBankScoresScope';

const entry = (
  overrides: Partial<ScopedPendingQuestionBankScore> = {}
): ScopedPendingQuestionBankScore => ({
  listingId: 'listing-1',
  correct: 7,
  total: 10,
  completedAt: '2026-09-01T00:00:00.000Z',
  attempts: 0,
  ...overrides,
});

describe('pendingQbankScoresKey', () => {
  it('scopes the legacy key by user', () => {
    expect(pendingQbankScoresKey('u1')).toBe(`${PENDING_QBANK_SCORES_LEGACY_KEY}:u1`);
    expect(pendingQbankScoresKey('u1')).not.toBe(pendingQbankScoresKey('u2'));
  });
});

describe('parsePendingQbankScores', () => {
  it('returns [] for missing, corrupt, or non-array payloads', () => {
    expect(parsePendingQbankScores(null)).toEqual([]);
    expect(parsePendingQbankScores('{not json')).toEqual([]);
    expect(parsePendingQbankScores('{"a":1}')).toEqual([]);
  });

  it('drops falsy members', () => {
    expect(parsePendingQbankScores(JSON.stringify([null, entry()]))).toHaveLength(1);
  });
});

describe('owners', () => {
  it('reads an owner only when the entry names one', () => {
    expect(resolveScoreOwner(entry())).toBeNull();
    expect(resolveScoreOwner(entry({ userId: '' }))).toBeNull();
    expect(resolveScoreOwner(entry({ userId: 'u1' }))).toBe('u1');
  });

  it('stamps idempotently and filters by owner', () => {
    const stamped = stampScoreOwner(entry(), 'u1');
    expect(stampScoreOwner(stamped, 'u1')).toEqual(stamped);
    expect(
      scoresOwnedBy([stamped, entry({ userId: 'u2' }), entry()], 'u1')
    ).toEqual([stamped]);
  });
});

describe('planPendingQbankScoresLoad', () => {
  it('loads the user key and stamps its entries', () => {
    const plan = planPendingQbankScoresLoad('u1', JSON.stringify([entry()]), null);
    expect(plan.entries).toEqual([entry({ userId: 'u1' })]);
    expect(plan.dropped).toBe(0);
    expect(plan.removeLegacy).toBe(false);
  });

  it('drops unowned legacy entries rather than adopting them', () => {
    const plan = planPendingQbankScoresLoad(
      'u1',
      null,
      JSON.stringify([entry(), entry({ listingId: 'listing-2' })])
    );
    expect(plan.entries).toEqual([]);
    expect(plan.dropped).toBe(2);
    expect(plan.removeLegacy).toBe(true);
  });

  it('never hands another account a legacy entry that names its owner', () => {
    const legacy = JSON.stringify([entry({ userId: 'u2' }), entry({ userId: 'u1' })]);
    expect(planPendingQbankScoresLoad('u1', null, legacy).entries).toEqual([
      entry({ userId: 'u1' }),
    ]);
    expect(planPendingQbankScoresLoad('u2', null, legacy).entries).toEqual([
      entry({ userId: 'u2' }),
    ]);
  });

  it('flags the empty legacy key for cleanup without warning-worthy drops', () => {
    const plan = planPendingQbankScoresLoad('u1', null, '[]');
    expect(plan).toEqual({ entries: [], dropped: 0, removeLegacy: true });
  });
});

describe('pendingQbankScoreKeysToClearOnSignOut', () => {
  it('clears only this user (and the legacy key) on a user sign-out', () => {
    expect(pendingQbankScoreKeysToClearOnSignOut('user', 'u1')).toEqual([
      PENDING_QBANK_SCORES_LEGACY_KEY,
      pendingQbankScoresKey('u1'),
    ]);
    expect(pendingQbankScoreKeysToClearOnSignOut('user', 'u1')).not.toContain(
      pendingQbankScoresKey('u2')
    );
  });

  it('keeps everything when the session was revoked', () => {
    expect(pendingQbankScoreKeysToClearOnSignOut('revoked', 'u1')).toEqual([]);
  });

  it('clears just the legacy key when the user id is unknown', () => {
    expect(pendingQbankScoreKeysToClearOnSignOut('user', null)).toEqual([
      PENDING_QBANK_SCORES_LEGACY_KEY,
    ]);
  });
});
