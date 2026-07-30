import { mapUserFromApi } from './apiMappers';

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
});
