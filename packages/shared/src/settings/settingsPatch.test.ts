import {
  DEFAULT_USER_SETTINGS,
  applySettingsPatch,
  diffSettingsPatch,
  mergeSettingsPatches,
  subtractSettingsPatch,
  resolveSettingsAfterSync,
  parseStudyDraftNumber,
  normalizeUserSettings,
  mergeSettingsCategory,
  mergeOnboardingVisited,
  normalizeOnboardingVisited,
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

describe('remembered flashcard generation options', () => {
  it('defaults to 20 mixed cards', () => {
    const settings = normalizeUserSettings({});
    expect(settings.flashcardGeneration).toEqual({ count: 20, typeMix: 'mixed' });
  });

  it('remembers the last used count and mix', () => {
    const next = applySettingsPatch(normalizeUserSettings({}), {
      flashcardGeneration: { count: 30, typeMix: 'cloze' },
    });
    expect(next.flashcardGeneration).toEqual({ count: 30, typeMix: 'cloze' });
  });

  it('clamps a count the generator would not honour, and rejects an unknown mix', () => {
    const next = applySettingsPatch(normalizeUserSettings({}), {
      flashcardGeneration: { count: 500, typeMix: 'sideways' as never },
    });
    expect(next.flashcardGeneration).toEqual({ count: 30, typeMix: 'mixed' });
  });

  it('patches one field without dropping the other', () => {
    const first = applySettingsPatch(normalizeUserSettings({}), {
      flashcardGeneration: { count: 10, typeMix: 'basic' },
    });
    const second = applySettingsPatch(first, { flashcardGeneration: { count: 30 } });
    expect(second.flashcardGeneration).toEqual({ count: 30, typeMix: 'basic' });
  });

  it('travels in a diff so the chosen options actually sync', () => {
    const before = normalizeUserSettings({});
    const after = applySettingsPatch(before, {
      flashcardGeneration: { count: 30, typeMix: 'cloze' },
    });
    expect(diffSettingsPatch(before, after).flashcardGeneration).toEqual({
      count: 30,
      typeMix: 'cloze',
    });
  });
});

/**
 * The Home checklist's "has ever opened" flags (#68). They belong to the
 * account, so every layer that touches them has to be monotonic — this is the
 * layer that makes it true no matter what a client sends.
 */
describe('onboardingVisited', () => {
  it('normalizes to exactly three booleans and drops everything else', () => {
    expect(
      normalizeOnboardingVisited({
        library: true,
        marketplace: 'yes',
        somethingElse: true,
      })
    ).toEqual({ library: true, marketplace: false, offline: false });
    expect(normalizeOnboardingVisited(null)).toEqual({
      library: false,
      marketplace: false,
      offline: false,
    });
    expect(normalizeOnboardingVisited(['library'])).toEqual({
      library: false,
      marketplace: false,
      offline: false,
    });
  });

  it('merges by OR, in either order', () => {
    const a = { library: true, marketplace: false, offline: false };
    const b = { library: false, marketplace: true, offline: false };
    expect(mergeOnboardingVisited(a, b)).toEqual({
      library: true,
      marketplace: true,
      offline: false,
    });
    expect(mergeOnboardingVisited(b, a)).toEqual(mergeOnboardingVisited(a, b));
  });

  it('applies a patch monotonically: a false can never un-tick a stored true', () => {
    const base = applySettingsPatch(normalizeUserSettings({}), {
      onboardingVisited: { library: true },
    });
    expect(base.onboardingVisited).toEqual({
      library: true,
      marketplace: false,
      offline: false,
    });

    const next = applySettingsPatch(base, {
      onboardingVisited: { library: false, offline: true },
    });
    expect(next.onboardingVisited).toEqual({
      library: true,
      marketplace: false,
      offline: true,
    });
  });

  it('leaves the flags alone when the patch does not mention them', () => {
    const base = applySettingsPatch(normalizeUserSettings({}), {
      onboardingVisited: { offline: true },
    });
    const next = applySettingsPatch(base, { appearance: { theme: 'dark' } });
    expect(next.onboardingVisited).toEqual({
      library: false,
      marketplace: false,
      offline: true,
    });
  });

  it('is carried by diffSettingsPatch when it changes', () => {
    const previous = normalizeUserSettings({});
    const next = applySettingsPatch(previous, { onboardingVisited: { library: true } });
    expect(diffSettingsPatch(previous, next).onboardingVisited).toEqual({
      library: true,
      marketplace: false,
      offline: false,
    });
  });
});
