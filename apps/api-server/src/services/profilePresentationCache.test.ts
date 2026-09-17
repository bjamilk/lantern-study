/**
 * HARNESS (monolith lane M3, Phase B, PR 4): this suite used to construct a
 * real `SupabaseService`. The class is deleted in this PR; it drives the data
 * layer's own function instead. Every `it` title, every `expect` and every
 * fixture is unchanged.
 */
import { cacheService } from './cache';
import { createDataLayer } from './data';

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

    // The layer takes the client directly, so the stand-in no longer has to be
    // pushed onto a constructed instance.
    const service = createDataLayer({
      client: { from } as never,
      supabaseUrl: 'http://localhost:54321',
      host: {} as never,
    }).users;

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
