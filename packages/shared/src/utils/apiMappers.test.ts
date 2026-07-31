import { mapUserFromApi, normalizeTestPresets } from './apiMappers';

describe('normalizeTestPresets', () => {
  it('reads snake_case test_presets from profile rows', () => {
    const presets = [{ id: 'p1', name: 'Quick', config: { mode: 'study' } }];
    expect(normalizeTestPresets({ test_presets: presets })).toEqual(presets);
  });

  it('reads camelCase testPresets from API User shape', () => {
    const presets = [{ id: 'p2', name: 'Exam', config: { mode: 'exam' } }];
    expect(normalizeTestPresets({ testPresets: presets })).toEqual(presets);
  });

  it('returns empty array when missing or invalid', () => {
    expect(normalizeTestPresets(null)).toEqual([]);
    expect(normalizeTestPresets({})).toEqual([]);
    expect(normalizeTestPresets({ test_presets: 'nope' })).toEqual([]);
  });
});

describe('mapUserFromApi avatar persistence', () => {
  const stableAvatar =
    'https://example.supabase.co/storage/v1/object/profile-avatars/user-1/avatar-1.webp';

  it('keeps camelCase avatarUrl from API User shape', () => {
    const mapped = mapUserFromApi({
      id: 'user-1',
      name: 'Ada',
      avatarUrl: stableAvatar,
    });
    expect(mapped.avatarUrl).toBe(stableAvatar);
    expect((mapped as { avatar_url?: string }).avatar_url).toBe(stableAvatar);
  });

  it('maps snake_case avatar_url and preserves the alias for login restore', () => {
    const mapped = mapUserFromApi({
      id: 'user-1',
      name: 'Ada',
      avatar_url: stableAvatar,
    });
    expect(mapped.avatarUrl).toBe(stableAvatar);
    expect((mapped as { avatar_url?: string }).avatar_url).toBe(stableAvatar);
  });

  it('prefers avatarUrl when both shapes are present', () => {
    const mapped = mapUserFromApi({
      id: 'user-1',
      name: 'Ada',
      avatarUrl: stableAvatar,
      avatar_url: 'https://stale.example/old.png',
    });
    expect(mapped.avatarUrl).toBe(stableAvatar);
    expect((mapped as { avatar_url?: string }).avatar_url).toBe(stableAvatar);
  });

  it('hydrates testPresets from dedicated column (not settings blob)', () => {
    const presets = [{ id: 'preset-1', name: 'Tags', config: { numberOfQuestions: 10 } }];
    const mapped = mapUserFromApi({
      id: 'user-1',
      name: 'Ada',
      test_presets: presets,
      settings: { study: { dailyCardGoal: 20 } },
    });
    expect(mapped.testPresets).toEqual(presets);
    expect(mapped.settings).toEqual({ study: { dailyCardGoal: 20 } });
  });
});
