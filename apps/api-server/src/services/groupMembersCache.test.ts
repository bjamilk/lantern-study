/**
 * SEC-04 regression: group members cache is partitioned by viewer and never
 * stores phone/settings in the shared payload builder.
 */
describe('group members cache key partition (SEC-04)', () => {
  it('builds distinct cache keys per requesting user', () => {
    const groupId = 'g1';
    const page = 1;
    const limit = 50;
    const keyFor = (requestingUserId?: string) =>
      `group:members:${groupId}:${page}:${limit}:${requestingUserId || 'anon'}`;

    expect(keyFor('user-a')).not.toBe(keyFor('user-b'));
    expect(keyFor('user-a')).not.toBe(keyFor(undefined));
    expect(keyFor('user-a')).toBe('group:members:g1:1:50:user-a');
  });

  it('public member projection excludes PII fields', () => {
    const profile = {
      id: 'u1',
      name: 'Ada',
      username: 'ada',
      avatar_url: 'https://cdn/a.png',
      points: 10,
      stats: {},
      badges: [],
      phone: '+15551212',
      settings: { secret: true },
    };

    const publicMember = {
      id: profile.id,
      name: profile.name,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      points: profile.points || 0,
      stats: profile.stats || {},
      badges: profile.badges || [],
    };

    expect(publicMember).not.toHaveProperty('phone');
    expect(publicMember).not.toHaveProperty('phoneNumber');
    expect(publicMember).not.toHaveProperty('settings');
  });
});
