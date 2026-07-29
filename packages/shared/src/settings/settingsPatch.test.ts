import {
  DEFAULT_USER_SETTINGS,
  applySettingsPatch,
  mergeSettingsPatches,
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

  it('parseStudyDraftNumber rejects empty and clamps', () => {
    expect(parseStudyDraftNumber('', 20, 5, 100)).toBe(20);
    expect(parseStudyDraftNumber('0', 20, 5, 100)).toBe(5);
    expect(parseStudyDraftNumber('40', 20, 5, 100)).toBe(40);
    expect(parseStudyDraftNumber('abc', 20, 5, 100)).toBe(20);
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
