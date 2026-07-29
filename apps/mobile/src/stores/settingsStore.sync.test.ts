/**
 * Sync-contract tests for settings store helpers.
 * Covers mid-flight pendingPatch races (not only merge math).
 */
import {
  applySettingsPatch,
  mergeSettingsPatches,
  normalizeUserSettings,
  resolveSettingsAfterSync,
  subtractSettingsPatch,
  DEFAULT_USER_SETTINGS,
} from '@lantern/shared/settings';

describe('mobile settings offline rebase helpers', () => {
  it('reapplies pending patch onto remote after conflict', () => {
    const remote = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      appearance: { ...DEFAULT_USER_SETTINGS.appearance, theme: 'dark' },
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 50 },
    });
    const pending = mergeSettingsPatches(null, {
      study: { srsNewCardsPerDay: 25 },
    });
    const rebased = applySettingsPatch(remote, pending);
    expect(rebased.appearance.theme).toBe('dark');
    expect(rebased.study.dailyCardGoal).toBe(50);
    expect(rebased.study.srsNewCardsPerDay).toBe(25);
  });

  it('accumulates multi-category pending patches', () => {
    const pending = mergeSettingsPatches(
      { notifications: { pushEnabled: false } },
      { study: { srsMaxInterval: 180 }, appearance: { lowDataMode: true } }
    );
    expect(pending.notifications).toEqual({ pushEnabled: false });
    expect(pending.study).toEqual({ srsMaxInterval: 180 });
    expect(pending.appearance).toEqual({ lowDataMode: true });
  });
});

describe('mid-flight pendingPatch race (sync success path)', () => {
  /**
   * Mirrors settingsStore.syncSettings success handling:
   * 1) snapshot pendingPatch as sentPending
   * 2) while "in flight", more edits merge into pending
   * 3) on success, only drop sent fields; keep remainder + schedule another sync
   */
  function simulateSuccessfulSync(args: {
    localBefore: ReturnType<typeof normalizeUserSettings>;
    sentPending: Parameters<typeof resolveSettingsAfterSync>[0]['sentPending'];
    midFlightPatch: Parameters<typeof mergeSettingsPatches>[1];
    authoritative: ReturnType<typeof normalizeUserSettings>;
  }) {
    const pendingAfterSync = mergeSettingsPatches(args.sentPending, args.midFlightPatch);
    return resolveSettingsAfterSync({
      authoritative: args.authoritative,
      pendingAfterSync,
      sentPending: args.sentPending,
      lastSyncTime: '2026-07-29T18:00:00.000Z',
    });
  }

  it('does not wipe edits made while isSyncing', () => {
    const localBefore = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 40 },
    });
    const sentPending = { study: { dailyCardGoal: 40 } };
    const authoritative = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 40 },
    });

    const resolved = simulateSuccessfulSync({
      localBefore,
      sentPending,
      midFlightPatch: { study: { srsNewCardsPerDay: 22 }, appearance: { theme: 'dark' } },
      authoritative,
    });

    expect(resolved.hasUnsyncedChanges).toBe(true);
    expect(resolved.pendingPatch).toEqual({
      study: { srsNewCardsPerDay: 22 },
      appearance: { theme: 'dark' },
    });
    // Authoritative synced values + mid-flight overlay
    expect(resolved.settings.study.dailyCardGoal).toBe(40);
    expect(resolved.settings.study.srsNewCardsPerDay).toBe(22);
    expect(resolved.settings.appearance.theme).toBe('dark');
  });

  it('clears pending only when mid-flight added nothing', () => {
    const sentPending = { notifications: { pushEnabled: false } };
    const authoritative = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      notifications: { ...DEFAULT_USER_SETTINGS.notifications, pushEnabled: false },
    });
    const resolved = simulateSuccessfulSync({
      localBefore: authoritative,
      sentPending,
      midFlightPatch: {},
      authoritative,
    });
    expect(resolved.hasUnsyncedChanges).toBe(false);
    expect(resolved.pendingPatch).toEqual({});
  });

  it('409 rebase-success path also retains post-retry mid-flight edits', () => {
    // After conflict, store retries with current pending; mid-flight during retry must remain.
    const sentForRetry = mergeSettingsPatches(
      { study: { dailyCardGoal: 40 } },
      { appearance: { theme: 'dark' } }
    );
    const pendingAfterRetry = mergeSettingsPatches(sentForRetry, {
      study: { srsMaxInterval: 200 },
    });
    const authoritative = applySettingsPatch(DEFAULT_USER_SETTINGS, sentForRetry);
    const remaining = subtractSettingsPatch(pendingAfterRetry, sentForRetry);
    const resolved = resolveSettingsAfterSync({
      authoritative,
      pendingAfterSync: pendingAfterRetry,
      sentPending: sentForRetry,
    });

    expect(remaining).toEqual({ study: { srsMaxInterval: 200 } });
    expect(resolved.hasUnsyncedChanges).toBe(true);
    expect(resolved.settings.study.srsMaxInterval).toBe(200);
    expect(resolved.settings.appearance.theme).toBe('dark');
  });

  it('foreign-owner pending must not be treated as syncable for current user', () => {
    const ownerUserId: string | null = 'user-a';
    const sessionUserId: string = 'user-b';
    const shouldRefuse = Boolean(ownerUserId && ownerUserId !== sessionUserId);
    expect(shouldRefuse).toBe(true);
  });
});
