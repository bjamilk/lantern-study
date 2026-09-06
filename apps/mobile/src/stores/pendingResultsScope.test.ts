import {
  PENDING_RESULTS_LEGACY_KEY,
  pendingResultsKey,
  parsePendingResults,
  resolveResultOwner,
  resultsOwnedBy,
  mergePendingResults,
  partitionLegacyResults,
  planPendingResultsLoad,
  pendingResultsKeysToClearOnSignOut,
  mergeIntoStoredResults,
  type ScopedPendingResult,
} from './pendingResultsScope';

/** A pending result plus the fields the real store adds. */
type Row = ScopedPendingResult & Record<string, unknown>;

const result = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  testId: `test-${id}`,
  synced: false,
  ...extra,
});

describe('pendingResultsKey', () => {
  it('scopes the legacy key by user id', () => {
    expect(pendingResultsKey('u1')).toBe('@lantern_pending_results:u1');
    expect(pendingResultsKey('u1')).not.toBe(PENDING_RESULTS_LEGACY_KEY);
  });
});

describe('parsePendingResults', () => {
  it('returns [] for null, corrupt JSON and non-arrays', () => {
    expect(parsePendingResults(null)).toEqual([]);
    expect(parsePendingResults('')).toEqual([]);
    expect(parsePendingResults('{ not json')).toEqual([]);
    expect(parsePendingResults('{"a":1}')).toEqual([]);
  });

  it('parses an array and drops null entries', () => {
    expect(parsePendingResults(JSON.stringify([result('a'), null]))).toHaveLength(1);
  });
});

describe('resolveResultOwner', () => {
  it('prefers the entry userId', () => {
    expect(resolveResultOwner(result('a', { userId: 'u1' }))).toBe('u1');
  });

  it('falls back to the session payload owner', () => {
    expect(resolveResultOwner(result('a', { sessionPayload: { userId: 'u2' } }))).toBe('u2');
  });

  it('falls back to the attempt owner', () => {
    expect(resolveResultOwner(result('a', { attempt: { userId: 'u3' } }))).toBe('u3');
  });

  it('is null when nothing names an owner', () => {
    expect(resolveResultOwner(result('a'))).toBeNull();
    expect(resolveResultOwner(result('a', { userId: '' }))).toBeNull();
  });
});

describe('resultsOwnedBy', () => {
  it('never treats an unowned entry as the current user’s', () => {
    const list = [result('a', { userId: 'u1' }), result('b', { userId: 'u2' }), result('c')];
    expect(resultsOwnedBy(list, 'u1').map((r) => r.id)).toEqual(['a']);
  });
});

describe('mergePendingResults', () => {
  it('de-duplicates by id, last write wins', () => {
    const merged = mergePendingResults(
      [result('a', { score: 1 }), result('b')],
      [result('a', { score: 2 })]
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.id === 'a')?.score).toBe(2);
  });

  it('keeps entries with no id', () => {
    expect(mergePendingResults<Row>([{ testId: 'x' }], [{ testId: 'y' }])).toHaveLength(2);
  });
});

describe('partitionLegacyResults', () => {
  it('routes owned entries to their owner and adopts unowned ones', () => {
    const { mine, others } = partitionLegacyResults<Row>(
      [result('a'), result('b', { userId: 'u2' }), result('c', { userId: 'u1' })],
      'u1'
    );
    expect(mine.map((r) => r.id)).toEqual(['a', 'c']);
    expect(mine.every((r) => r.userId === 'u1')).toBe(true);
    expect(others.u2.map((r) => r.id)).toEqual(['b']);
  });
});

describe('planPendingResultsLoad', () => {
  it('loads only the scoped entries when there is no legacy key', () => {
    const plan = planPendingResultsLoad<Row>(
      'u1',
      JSON.stringify([result('a'), result('b')]),
      null
    );
    expect(plan.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan.results.every((r) => r.userId === 'u1')).toBe(true);
    expect(plan.writes).toEqual([]);
    expect(plan.removeLegacy).toBe(false);
  });

  it('never surfaces another account’s scoped entries', () => {
    // u1's key only ever holds u1's results; u2's list is not consulted.
    const plan = planPendingResultsLoad<Row>('u2', null, null);
    expect(plan.results).toEqual([]);
  });

  it('migrates unowned legacy entries to the first user who loads them', () => {
    const plan = planPendingResultsLoad<Row>('u1', null, JSON.stringify([result('a'), result('b')]));
    expect(plan.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan.results.every((r) => r.userId === 'u1')).toBe(true);
    expect(plan.writes).toEqual([
      { key: '@lantern_pending_results:u1', results: plan.results },
    ]);
    expect(plan.removeLegacy).toBe(true);
  });

  it('hands owned legacy entries to their real owner, not the loader', () => {
    const plan = planPendingResultsLoad<Row>(
      'u1',
      null,
      JSON.stringify([result('a', { userId: 'u2' }), result('b')])
    );
    expect(plan.results.map((r) => r.id)).toEqual(['b']);
    const otherWrite = plan.writes.find((w) => w.key === '@lantern_pending_results:u2');
    expect(otherWrite?.results.map((r) => r.id)).toEqual(['a']);
    expect(plan.removeLegacy).toBe(true);
  });

  it('merges legacy entries with already scoped ones without duplicating', () => {
    const plan = planPendingResultsLoad<Row>(
      'u1',
      JSON.stringify([result('a', { userId: 'u1', score: 1 })]),
      JSON.stringify([result('a', { score: 9 }), result('z')])
    );
    expect(plan.results.map((r) => r.id).sort()).toEqual(['a', 'z']);
    expect(plan.results.find((r) => r.id === 'a')?.score).toBe(9);
  });

  it('drops an empty legacy key', () => {
    const plan = planPendingResultsLoad<Row>('u1', null, '[]');
    expect(plan.removeLegacy).toBe(true);
    expect(plan.writes).toEqual([]);
  });
});

describe('pendingResultsKeysToClearOnSignOut', () => {
  it('clears only the signing-out user on a user-initiated sign-out', () => {
    expect(pendingResultsKeysToClearOnSignOut('user', 'u1')).toEqual([
      '@lantern_pending_results',
      '@lantern_pending_results:u1',
    ]);
  });

  it('keeps everything when the session was revoked', () => {
    expect(pendingResultsKeysToClearOnSignOut('revoked', 'u1')).toEqual([]);
  });

  it('still drops the legacy key when the user id is unknown', () => {
    expect(pendingResultsKeysToClearOnSignOut('user', undefined)).toEqual([
      '@lantern_pending_results',
    ]);
  });
});

describe('mergeIntoStoredResults', () => {
  it('keeps results that exist only in storage instead of overwriting them', () => {
    // Memory was never loaded for this user (second account on a handset);
    // a write of the in-memory view must not drop what the key already holds.
    const merged = mergeIntoStoredResults<Row>(
      JSON.stringify([result('old', { userId: 'u1' })]),
      [result('new', { userId: 'u1' })]
    );
    expect(merged.map((r) => r.id).sort()).toEqual(['new', 'old']);
  });

  it('drops the ids a sync just uploaded and lets the fresh copy win', () => {
    const merged = mergeIntoStoredResults<Row>(
      JSON.stringify([result('synced'), result('a', { score: 1 })]),
      [result('a', { score: 2 })],
      new Set(['synced'])
    );
    expect(merged.map((r) => r.id)).toEqual(['a']);
    expect(merged[0].score).toBe(2);
  });

  it('treats a missing or corrupt key as empty', () => {
    expect(mergeIntoStoredResults<Row>(null, [result('a')])).toHaveLength(1);
    expect(mergeIntoStoredResults<Row>('{bad', [result('a')])).toHaveLength(1);
  });
});
