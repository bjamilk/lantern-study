/**
 * Lightweight sync-result contract tests for settingsStore helpers.
 * Full AsyncStorage/NetInfo integration is covered by smoke + manual matrix.
 */
import {
  applySettingsPatch,
  mergeSettingsPatches,
  normalizeUserSettings,
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
