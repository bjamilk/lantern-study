import {
  mergeStatsRefresh,
  resolveProgressDisplay,
  statsHaveSignal,
  type ProgressSignalFields,
} from './dashboardProgressState';

/** What the stats store hands the dashboard when nothing could be fetched. */
const zeros: ProgressSignalFields = {
  totalPoints: 0,
  totalTestsTaken: 0,
  currentStreak: 0,
  longestStreak: 0,
  cardsReviewed: 0,
  totalStudyTime: 0,
  activityDays: [],
  badges: [{ level: 0 }, { level: 0 }],
};

const real: ProgressSignalFields = {
  ...zeros,
  totalPoints: 3897,
  totalTestsTaken: 12,
  currentStreak: 4,
};

describe('statsHaveSignal', () => {
  it('is false for nothing at all', () => {
    expect(statsHaveSignal(null)).toBe(false);
    expect(statsHaveSignal(undefined)).toBe(false);
    expect(statsHaveSignal({})).toBe(false);
    expect(statsHaveSignal(zeros)).toBe(false);
  });

  it('is true on any single trace of past work', () => {
    expect(statsHaveSignal({ ...zeros, totalPoints: 5 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, totalTestsTaken: 1 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, currentStreak: 1 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, longestStreak: 9 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, cardsReviewed: 3 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, totalStudyTime: 60 })).toBe(true);
    expect(statsHaveSignal({ ...zeros, activityDays: [{ date: '2026-09-01' }] })).toBe(true);
    expect(statsHaveSignal({ ...zeros, badges: [{ level: 2 }] })).toBe(true);
  });
});

describe('resolveProgressDisplay', () => {
  it('shows the live snapshot whenever the refresh got through', () => {
    const out = resolveProgressDisplay({ live: real, lastGood: null, syncFailed: false });
    expect(out.mode).toBe('live');
    expect(out.stats).toBe(real);
  });

  // A brand new account really does have zeros, and a successful refresh is
  // allowed to say so.
  it('shows real zeros for a new account that synced fine', () => {
    const out = resolveProgressDisplay({ live: zeros, lastGood: null, syncFailed: false });
    expect(out.mode).toBe('live');
    expect(out.stats).toBe(zeros);
  });

  it('keeps figures that survived the failed refresh, marked stale', () => {
    const out = resolveProgressDisplay({
      live: real,
      lastGood: { stats: real, at: 1_000 },
      syncFailed: true,
    });
    expect(out.mode).toBe('stale');
    expect(out.stats).toBe(real);
    expect(out.syncedAt).toBe(1_000);
  });

  // The defect this module exists for: offline, the store rebuilds the
  // snapshot from empty sources and hands Home a full set of zeros.
  it('falls back to the last synced figures rather than rendering the offline zeros', () => {
    const out = resolveProgressDisplay({
      live: zeros,
      lastGood: { stats: real, at: 42 },
      syncFailed: true,
    });
    expect(out.mode).toBe('stale');
    expect(out.stats).toBe(real);
    expect(out.syncedAt).toBe(42);
  });

  it('refuses to render anything when it has no true numbers to show', () => {
    const out = resolveProgressDisplay({ live: zeros, lastGood: null, syncFailed: true });
    expect(out.mode).toBe('unavailable');
    expect(out.stats).toBeNull();
    expect(out.syncedAt).toBeNull();
  });

  it('never falls back to a cached snapshot that is itself empty', () => {
    const out = resolveProgressDisplay({
      live: zeros,
      lastGood: { stats: zeros, at: 7 },
      syncFailed: true,
    });
    expect(out.mode).toBe('unavailable');
    expect(out.stats).toBeNull();
  });
});

describe('mergeStatsRefresh', () => {
  it('takes the new snapshot and caches it when every source answered', () => {
    const out = mergeStatsRefresh({
      previous: real,
      incoming: zeros,
      attempted: 5,
      unreachable: 0,
    });
    expect(out).toEqual({ stats: zeros, stale: false, persist: true });
  });

  // The rule the whole module exists for.
  it('keeps the previous snapshot when the refresh never reached Lantern', () => {
    const out = mergeStatsRefresh({
      previous: real,
      incoming: zeros,
      attempted: 5,
      unreachable: 5,
    });
    expect(out.stats).toBe(real);
    expect(out.stale).toBe(true);
  });

  it('never caches a snapshot assembled from failed sources', () => {
    expect(
      mergeStatsRefresh({ previous: real, incoming: zeros, attempted: 5, unreachable: 5 }).persist
    ).toBe(false);
    expect(
      mergeStatsRefresh({ previous: null, incoming: zeros, attempted: 5, unreachable: 5 }).persist
    ).toBe(false);
    expect(
      mergeStatsRefresh({ previous: null, incoming: real, attempted: 5, unreachable: 1 }).persist
    ).toBe(false);
  });

  // The offline cold start: nothing cached, nothing fetched. Dashes, not zeros.
  it('holds nothing rather than the manufactured zeros on a total failure', () => {
    const out = mergeStatsRefresh({
      previous: null,
      incoming: zeros,
      attempted: 5,
      unreachable: 5,
    });
    expect(out.stats).toBeNull();
    expect(out.stale).toBe(true);
  });

  it('keeps a partial snapshot when there is nothing else to show', () => {
    const out = mergeStatsRefresh({
      previous: null,
      incoming: real,
      attempted: 5,
      unreachable: 2,
    });
    expect(out.stats).toBe(real);
    expect(out.stale).toBe(true);
  });

  // A single flaky endpoint must not overwrite figures we already trust.
  it('refuses to let a partial refresh overwrite a trusted snapshot', () => {
    const out = mergeStatsRefresh({
      previous: real,
      incoming: zeros,
      attempted: 5,
      unreachable: 1,
    });
    expect(out.stats).toBe(real);
    expect(out.stale).toBe(true);
  });

  it('keeps what it holds when a clean refresh produced nothing at all', () => {
    const out = mergeStatsRefresh({
      previous: real,
      incoming: null,
      attempted: 0,
      unreachable: 0,
    });
    expect(out).toEqual({ stats: real, stale: false, persist: false });
  });
});
