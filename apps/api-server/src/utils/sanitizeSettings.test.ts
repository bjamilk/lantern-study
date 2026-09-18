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

  // #68: the Home checklist's "has ever opened" flags travel through the
  // ordinary settings PUT, so the sanitizer is what decides whether this key
  // is safe to let a client write.
  describe('onboardingVisited', () => {
    it('accepts the three booleans and stores them', () => {
      const merged = mergeUserSettings(
        {},
        { onboardingVisited: { library: true, marketplace: true, offline: true } }
      );
      expect(merged.onboardingVisited).toEqual({
        library: true,
        marketplace: true,
        offline: true,
      });
    });

    it('strips junk sub-keys and coerces non-booleans to false', () => {
      const merged = mergeUserSettings(
        {},
        {
          onboardingVisited: {
            library: 'yes',
            marketplace: 1,
            offline: true,
            somethingElse: true,
            nested: { deep: true },
          },
        }
      );
      expect(merged.onboardingVisited).toEqual({
        library: false,
        marketplace: false,
        offline: true,
      });
    });

    it('is MONOTONIC: a stale client cannot un-tick a stored flag', () => {
      const merged = mergeUserSettings(
        { onboardingVisited: { library: true, marketplace: false, offline: false } },
        { onboardingVisited: { library: false, marketplace: true } }
      );
      expect(merged.onboardingVisited).toEqual({
        library: true,
        marketplace: true,
        offline: false,
      });
    });

    it('cannot be used to smuggle a privileged key in', () => {
      const merged = mergeUserSettings(
        { is_platform_admin: false },
        {
          onboardingVisited: {
            library: true,
            is_platform_admin: true,
            account_status: 'active',
          },
        }
      );
      expect(merged.onboardingVisited).toEqual({
        library: true,
        marketplace: false,
        offline: false,
      });
      expect(merged.is_platform_admin).toBe(false);
      expect((merged.onboardingVisited as Record<string, unknown>).is_platform_admin).toBeUndefined();
    });

    it('is not privileged: it is absent until a client writes it, then kept', () => {
      const first = mergeUserSettings({}, { onboardingVisited: { offline: true } });
      const second = mergeUserSettings(first, { appearance: { theme: 'dark' } });
      expect(second.onboardingVisited).toEqual({
        library: false,
        marketplace: false,
        offline: true,
      });
    });

    it('ignores a non-object value entirely', () => {
      const merged = mergeUserSettings(
        { onboardingVisited: { library: true, marketplace: false, offline: false } },
        { onboardingVisited: 'all-of-them' }
      );
      expect(merged.onboardingVisited).toEqual({
        library: true,
        marketplace: false,
        offline: false,
      });
    });
  });

  it('deep-merges featureTips.checklist keys across devices', () => {
    const merged = mergeUserSettings(
      {
        featureTips: {
          version: 2,
          dismissed: {},
          skippedAll: false,
          dontShowAgain: false,
          checklistDismissed: false,
          checklist: { explore_groups: true },
        },
      },
      {
        featureTips: {
          checklist: { try_srs: true },
        },
      }
    );
    const tips = merged.featureTips as { checklist?: Record<string, boolean> } | undefined;
    expect(tips?.checklist).toEqual({
      explore_groups: true,
      try_srs: true,
    });
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
  // --- tutorStyle: the one SCALAR preference (F2) ----------------------------
  // It cannot ride the category loop (that requires an object), so it has its
  // own read with a four-id allowlist. These cases are the allowlist.

  it.each(['default', 'coach', 'professor', 'peer'])(
    'accepts the tutor style %s',
    (style) => {
      const merged = mergeUserSettings({}, { tutorStyle: style });
      expect(merged.tutorStyle).toBe(style);
    }
  );

  it('starts an account with no stored preference on the default style', () => {
    expect(mergeUserSettings({}, {}).tutorStyle).toBe('default');
  });

  it('drops junk rather than storing it, and keeps the style already set', () => {
    for (const junk of ['', 'COACH', 'drill-sergeant', 42, true, null, [], { id: 'coach' }]) {
      const merged = mergeUserSettings({ tutorStyle: 'coach' }, { tutorStyle: junk });
      expect(merged.tutorStyle).toBe('coach');
    }
  });

  it('cannot smuggle a privileged key in under this one', () => {
    // Two routes to the same guarantee: the value is read only when it is one
    // of four fixed strings, and privileged keys are stripped before this code
    // ever sees the body.
    const merged = mergeUserSettings(
      { is_platform_admin: false },
      {
        tutorStyle: { is_platform_admin: true, coach: true },
        is_platform_admin: true,
        is_banned: true,
      }
    );
    expect(merged.tutorStyle).toBe('default');
    expect(merged.is_platform_admin).toBe(false);
    expect(merged.is_banned).toBeUndefined();
  });

  it('does not clobber a sibling category, and is not clobbered by one', () => {
    const merged = mergeUserSettings(
      // Nested shape: with no `notifications` key the normalizer takes the
      // legacy-flat branch, which does not read `appearance` at all.
      { tutorStyle: 'professor', notifications: { pushEnabled: true }, appearance: { theme: 'dark' } },
      { study: { dailyCardGoal: 30 } }
    );
    expect(merged.tutorStyle).toBe('professor');
    expect(merged.appearance).toEqual(expect.objectContaining({ theme: 'dark' }));
    expect(merged.study).toEqual(expect.objectContaining({ dailyCardGoal: 30 }));
  });

  describe('the lecture recorder category', () => {
    it('stores a language the recorder offers', () => {
      const merged = mergeUserSettings(
        {},
        { lecture: { spokenLanguage: 'yo', transcribeTo: 'en' } }
      ) as any;
      expect(merged.lecture).toEqual({ spokenLanguage: 'yo', transcribeTo: 'en' });
    });

    it('narrows a language it does not offer to auto-detect', () => {
      const merged = mergeUserSettings({}, { lecture: { spokenLanguage: 'klingon' } }) as any;
      expect(merged.lecture.spokenLanguage).toBe('auto');
    });

    it('narrows a transcribe target Whisper cannot produce', () => {
      // Whisper translates into English and nothing else, so "to Yoruba" is
      // not a target — it degrades to same-as-spoken rather than being stored.
      const merged = mergeUserSettings({}, { lecture: { transcribeTo: 'yo' } }) as any;
      expect(merged.lecture.transcribeTo).toBe('same');
    });

    it('drops unknown sub-keys rather than merging them', () => {
      const merged = mergeUserSettings(
        {},
        { lecture: { spokenLanguage: 'en', is_platform_admin: true } }
      ) as any;
      expect(merged.lecture).toEqual({ spokenLanguage: 'en', transcribeTo: 'same' });
      expect(merged.is_platform_admin).toBeUndefined();
    });

    it('keeps the other half when only one half is patched', () => {
      const merged = mergeUserSettings(
        { lecture: { spokenLanguage: 'ha', transcribeTo: 'en' } },
        { lecture: { transcribeTo: 'same' } }
      ) as any;
      expect(merged.lecture).toEqual({ spokenLanguage: 'ha', transcribeTo: 'same' });
    });
  });
});
