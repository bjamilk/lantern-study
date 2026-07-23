import { cacheService } from './cache';
import { SupabaseService } from './supabase';

describe('profile presentation cache invalidation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invalidates every active group after an avatar update', async () => {
    const updatedProfile = {
      id: 'user-1',
      name: 'Member',
      avatar_url: 'https://cdn.example/new-avatar.webp',
      points: 0,
      badges: [],
      stats: {},
    };
    const profileQuery = {
      select: jest.fn(() => ({
        maybeSingle: jest.fn().mockResolvedValue({ data: updatedProfile, error: null }),
      })),
    };
    const pendingFilter = jest.fn().mockResolvedValue({
      data: [{ group_id: 'group-1' }, { group_id: 'group-2' }, { group_id: 'group-1' }],
      error: null,
    });
    const from = jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          update: jest.fn(() => ({
            eq: jest.fn(() => profileQuery),
          })),
        };
      }
      if (table === 'group_members') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: pendingFilter,
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const service = new SupabaseService({
      url: 'http://localhost:54321',
      serviceRoleKey: 'test-service-role-key',
    });
    (service as unknown as { supabase: { from: typeof from } }).supabase = { from };

    jest.spyOn(cacheService, 'invalidateUserCache').mockResolvedValue();
    const invalidateGroupCache = jest
      .spyOn(cacheService, 'invalidateGroupCache')
      .mockResolvedValue();

    await service.updateUser('user-1', {
      avatarUrl: updatedProfile.avatar_url,
    });

    expect(pendingFilter).toHaveBeenCalledWith('pending', false);
    expect(invalidateGroupCache).toHaveBeenCalledTimes(2);
    expect(invalidateGroupCache).toHaveBeenCalledWith('group-1');
    expect(invalidateGroupCache).toHaveBeenCalledWith('group-2');
  });
});
