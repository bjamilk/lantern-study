import { mergeUserSettings, stripPrivilegedSettings } from './sanitizeSettings';

describe('sanitizeSettings', () => {
  it('strips privileged keys from incoming settings', () => {
    const result = stripPrivilegedSettings({
      theme: 'dark',
      is_banned: false,
      account_status: 'active',
      is_platform_admin: true,
    });
    expect(result).toEqual({ theme: 'dark' });
  });

  it('preserves privileged keys from existing profile when merging', () => {
    const merged = mergeUserSettings(
      { theme: 'light', is_banned: true, account_status: 'banned' },
      { theme: 'dark', is_banned: false, account_status: 'active' }
    );
    expect(merged.appearance).toEqual(expect.objectContaining({ theme: 'dark' }));
    expect(merged.is_banned).toBe(true);
    expect(merged.account_status).toBe('banned');
  });

  it('deep-merges a single category without clobbering sibling categories', () => {
    const merged = mergeUserSettings(
      {
        notifications: {
          pushEnabled: true,
          dailyReminder: true,
          reminderTime: '20:00',
          groupActivity: true,
          marketplaceUpdates: true,
          badgeUnlocks: true,
          srsReminders: true,
          testResults: true,
          emailEnabled: true,
          weeklyDigest: true,
          groupInvites: true,
        },
        study: {
          dailyCardGoal: 20,
          dailyTestGoal: 1,
          srsNewCardsPerDay: 10,
          srsEasyBonus: 1.3,
          srsIntervalModifier: 100,
          srsMaxInterval: 365,
          defaultTestMode: 'study',
          showExplanationsImmediately: true,
          autoAdvanceDelay: 0,
          shuffleQuestions: true,
          shuffleOptions: true,
          autoPlayAudio: false,
          showCardProgress: true,
        },
      },
      {
        study: { srsNewCardsPerDay: 25, dailyCardGoal: 40 },
      }
    );
    expect(merged.study).toEqual(
      expect.objectContaining({
        srsNewCardsPerDay: 25,
        dailyCardGoal: 40,
        srsMaxInterval: 365,
        shuffleQuestions: true,
      })
    );
    expect(merged.notifications).toEqual(
      expect.objectContaining({
        pushEnabled: true,
        reminderTime: '20:00',
      })
    );
  });

  it('clamps out-of-range study values', () => {
    const merged = mergeUserSettings(
      {},
      { study: { dailyCardGoal: 0, srsNewCardsPerDay: 999, srsMaxInterval: 1 } }
    );
    expect(merged.study).toEqual(
      expect.objectContaining({
        dailyCardGoal: 5,
        srsNewCardsPerDay: 50,
        srsMaxInterval: 30,
      })
    );
  });

  it('strips nested test_presets from settings blob', () => {
    const merged = mergeUserSettings(
      { notifications: { pushEnabled: true } },
      { test_presets: [{ id: 'x' }], study: { dailyCardGoal: 30 } }
    );
    expect(merged.test_presets).toBeUndefined();
    expect(merged.study).toEqual(expect.objectContaining({ dailyCardGoal: 30 }));
  });
});
