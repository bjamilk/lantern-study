import {
  DEFAULT_USER_SETTINGS,
  applySettingsPatch,
  mergeSettingsPatches,
  subtractSettingsPatch,
  resolveSettingsAfterSync,
  parseStudyDraftNumber,
  normalizeUserSettings,
  mergeSettingsCategory,
} from './index';

describe('settingsPatch', () => {
  it('deep-merges a study category without clobbering other categories', () => {
    const base = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      notifications: {
        ...DEFAULT_USER_SETTINGS.notifications,
        reminderTime: '09:30',
        pushEnabled: false,
      },
      study: {
        ...DEFAULT_USER_SETTINGS.study,
        dailyCardGoal: 40,
        srsNewCardsPerDay: 10,
      },
    });

    const next = applySettingsPatch(base, {
      study: { srsNewCardsPerDay: 25 },
    });

    expect(next.study.srsNewCardsPerDay).toBe(25);
    expect(next.study.dailyCardGoal).toBe(40);
    expect(next.notifications.reminderTime).toBe('09:30');
    expect(next.notifications.pushEnabled).toBe(false);
  });

  it('clamps out-of-range study values', () => {
    const next = applySettingsPatch(DEFAULT_USER_SETTINGS, {
      study: { dailyCardGoal: 0, srsNewCardsPerDay: 999, srsMaxInterval: 1 },
    });
    expect(next.study.dailyCardGoal).toBe(5);
    expect(next.study.srsNewCardsPerDay).toBe(50);
    expect(next.study.srsMaxInterval).toBe(30);
  });

  it('rejects invalid reminder times and accent colors', () => {
    const next = applySettingsPatch(DEFAULT_USER_SETTINGS, {
      notifications: { reminderTime: '25:99' },
      appearance: { accentColor: 'not-a-color', theme: 'dark' },
    });
    expect(next.notifications.reminderTime).toBe(
      DEFAULT_USER_SETTINGS.notifications.reminderTime
    );
    expect(next.appearance.accentColor).toBe(DEFAULT_USER_SETTINGS.appearance.accentColor);
    expect(next.appearance.theme).toBe('dark');
  });

  it('merges successive patches field-wise', () => {
    const merged = mergeSettingsPatches(
      { study: { dailyCardGoal: 30 }, appearance: { theme: 'dark' } },
      { study: { srsNewCardsPerDay: 15 } }
    );
    expect(merged).toEqual({
      study: { dailyCardGoal: 30, srsNewCardsPerDay: 15 },
      appearance: { theme: 'dark' },
    });
  });

  it('deep-merges featureTips.checklist keys instead of wholesale replace', () => {
    const base = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      featureTips: {
        version: 2,
        dismissed: {},
        skippedAll: false,
        dontShowAgain: false,
        checklistDismissed: false,
        checklist: { explore_groups: true, try_srs: false },
      },
    });
    const next = applySettingsPatch(base, {
      featureTips: { checklist: { try_srs: true, take_test: true } },
    });
    expect(next.featureTips?.checklist).toEqual({
      explore_groups: true,
      try_srs: true,
      take_test: true,
    });
  });

  it('mergeSettingsPatches deep-merges featureTips.checklist', () => {
    const merged = mergeSettingsPatches(
      { featureTips: { checklist: { explore_groups: true } } },
      { featureTips: { checklist: { try_srs: true }, skippedAll: true } }
    );
    expect(merged.featureTips?.checklist).toEqual({
      explore_groups: true,
      try_srs: true,
    });
    expect(merged.featureTips?.skippedAll).toBe(true);
  });

  it('parseStudyDraftNumber rejects empty and clamps', () => {
    expect(parseStudyDraftNumber('', 20, 5, 100)).toBe(20);
    expect(parseStudyDraftNumber('0', 20, 5, 100)).toBe(5);
    expect(parseStudyDraftNumber('40', 20, 5, 100)).toBe(40);
    expect(parseStudyDraftNumber('abc', 20, 5, 100)).toBe(20);
  });
});

describe('mid-flight pending patch race', () => {
  it('subtractSettingsPatch keeps edits made after the sent snapshot', () => {
    const sent = mergeSettingsPatches(null, {
      study: { dailyCardGoal: 40 },
      appearance: { theme: 'dark' },
    });
    // While syncing, user also changes srs + flips theme again.
    const after = mergeSettingsPatches(sent, {
      study: { srsNewCardsPerDay: 25 },
      appearance: { theme: 'light' },
    });
    const remaining = subtractSettingsPatch(after, sent);
    expect(remaining).toEqual({
      study: { srsNewCardsPerDay: 25 },
      appearance: { theme: 'light' },
    });
  });

  it('resolveSettingsAfterSync retains mid-flight edits and flags another sync', () => {
    const authoritative = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 40 },
      appearance: { ...DEFAULT_USER_SETTINGS.appearance, theme: 'dark' },
    });
    const sentPending = { study: { dailyCardGoal: 40 }, appearance: { theme: 'dark' as const } };
    const pendingAfterSync = mergeSettingsPatches(sentPending, {
      study: { srsNewCardsPerDay: 30 },
    });

    const resolved = resolveSettingsAfterSync({
      authoritative,
      pendingAfterSync,
      sentPending,
      lastSyncTime: '2026-07-29T12:00:00.000Z',
    });

    expect(resolved.hasUnsyncedChanges).toBe(true);
    expect(resolved.pendingPatch).toEqual({ study: { srsNewCardsPerDay: 30 } });
    expect(resolved.settings.study.dailyCardGoal).toBe(40);
    expect(resolved.settings.study.srsNewCardsPerDay).toBe(30);
    expect(resolved.settings.appearance.theme).toBe('dark');
    expect(resolved.settings.sync.lastSyncTime).toBe('2026-07-29T12:00:00.000Z');
  });

  it('resolveSettingsAfterSync clears pending when nothing arrived mid-flight', () => {
    const authoritative = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      study: { ...DEFAULT_USER_SETTINGS.study, dailyCardGoal: 40 },
    });
    const sentPending = { study: { dailyCardGoal: 40 } };
    const resolved = resolveSettingsAfterSync({
      authoritative,
      pendingAfterSync: sentPending,
      sentPending,
    });
    expect(resolved.hasUnsyncedChanges).toBe(false);
    expect(resolved.pendingPatch).toEqual({});
    expect(resolved.settings.study.dailyCardGoal).toBe(40);
  });
});

describe('normalizeUserSettings / mergeSettingsCategory', () => {
  it('normalizes null to defaults', () => {
    const n = normalizeUserSettings(null);
    expect(n.study.dailyCardGoal).toBe(DEFAULT_USER_SETTINGS.study.dailyCardGoal);
    expect(n.notifications.pushEnabled).toBe(true);
  });

  it('migrates legacy flat theme into appearance', () => {
    const n = normalizeUserSettings({ theme: 'dark', dailyReminder: false });
    expect(n.appearance.theme).toBe('dark');
    expect(n.notifications.dailyReminder).toBe(false);
  });

  it('mergeSettingsCategory updates updatedAt and one category', () => {
    const before = normalizeUserSettings(DEFAULT_USER_SETTINGS);
    const next = mergeSettingsCategory(before, 'study', { srsNewCardsPerDay: 20 });
    expect(next.study.srsNewCardsPerDay).toBe(20);
    expect(next.study.dailyCardGoal).toBe(before.study.dailyCardGoal);
    expect(Date.parse(next.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
  });
});
