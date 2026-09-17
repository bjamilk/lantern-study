/**
 * HARNESS (monolith lane M3, Phase B, PR 4): this suite used to construct a
 * real `SupabaseService` and spy on two of its methods. The class is deleted in
 * this PR, so it builds a data layer over the same config and spies on the
 * namespace that owns each predicate — `users.isProfileVisibleToViewer` and
 * `groups.canViewPeerChatAvatar`, which is where the storage ACL reads them.
 * Every `it` title, every `expect` and every fixture is unchanged.
 */
import { createDataLayer, type DataLayer } from './data';
import { createDataClient } from './data/client';

describe('canAccessStorageObject profile-avatars', () => {
  let layer: DataLayer;
  let service: DataLayer['storageAcl'];
  let visibilitySpy: jest.SpyInstance;
  let peerChatSpy: jest.SpyInstance;

  beforeEach(() => {
    layer = createDataLayer({
      client: createDataClient({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-service-role-key',
      } as never),
      supabaseUrl: 'https://test.supabase.co',
    });
    service = layer.storageAcl;
    visibilitySpy = jest.spyOn(layer.users, 'isProfileVisibleToViewer');
    // When a profile is not visible, canAccessStorageObject falls through to the
    // conversation-peer check (DM / shared group avatars). Without this stub that
    // path issues a real Supabase request and the test dies with "fetch failed".
    // Default to false so "not visible" means "no access" unless a test says otherwise.
    peerChatSpy = jest.spyOn(layer.groups, 'canViewPeerChatAvatar').mockResolvedValue(false);
  });

  afterEach(() => {
    visibilitySpy.mockRestore();
    peerChatSpy.mockRestore();
  });

  it('allows the avatar owner without a visibility RPC call', async () => {
    const allowed = await service.canAccessStorageObject(
      'user-a',
      'profile-avatars',
      'user-a/avatar.png'
    );
    expect(allowed).toBe(true);
    expect(visibilitySpy).not.toHaveBeenCalled();
  });

  it('denies unauthenticated access to another user avatar', async () => {
    const allowed = await service.canAccessStorageObject(
      null,
      'profile-avatars',
      'user-b/avatar.png'
    );
    expect(allowed).toBe(false);
    expect(visibilitySpy).not.toHaveBeenCalled();
  });

  it('denies strangers when profile is not visible', async () => {
    visibilitySpy.mockResolvedValue(false);
    const allowed = await service.canAccessStorageObject(
      'viewer',
      'profile-avatars',
      'target/avatar.png'
    );
    expect(allowed).toBe(false);
    expect(visibilitySpy).toHaveBeenCalledWith('viewer', 'target');
  });

  it('allows strangers when profile is visible', async () => {
    visibilitySpy.mockResolvedValue(true);
    const allowed = await service.canAccessStorageObject(
      'viewer',
      'profile-avatars',
      'target/avatar.png'
    );
    expect(allowed).toBe(true);
    expect(visibilitySpy).toHaveBeenCalledWith('viewer', 'target');
  });

  it('denies unknown buckets (no fail-open)', async () => {
    const allowed = await service.canAccessStorageObject(
      'user-a',
      'totally-unknown-bucket',
      'user-a/secret.bin'
    );
    expect(allowed).toBe(false);
  });

  it('denies path traversal attempts', async () => {
    const allowed = await service.canAccessStorageObject(
      'user-a',
      'note-files',
      'user-a/../other/file.png'
    );
    expect(allowed).toBe(false);
  });
});

describe('canAccessStorageObject marketplace shop covers', () => {
  let layer: DataLayer;
  let service: DataLayer['storageAcl'];

  beforeEach(() => {
    layer = createDataLayer({
      client: createDataClient({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-service-role-key',
      } as never),
      supabaseUrl: 'https://test.supabase.co',
    });
    service = layer.storageAcl;
  });

  it('allows anyone to read a published shop cover', async () => {
    await expect(
      service.canAccessStorageObject(
        null,
        'marketplace-images',
        'seller-1/shop/cover.webp',
      ),
    ).resolves.toBe(true);
    await expect(
      service.canAccessStorageObject(
        'buyer-2',
        'marketplace-images',
        'seller-1/shop/cover.webp',
      ),
    ).resolves.toBe(true);
  });

  it('keeps legacy temp/ covers owner-only', async () => {
    await expect(
      service.canAccessStorageObject(
        'seller-1',
        'marketplace-images',
        'seller-1/temp/cover.webp',
      ),
    ).resolves.toBe(true);
    await expect(
      service.canAccessStorageObject(
        'buyer-2',
        'marketplace-images',
        'seller-1/temp/cover.webp',
      ),
    ).resolves.toBe(false);
  });
});

describe('storageUrlMatchesObject (exact path ACL)', () => {
  let layer: DataLayer;
  let service: DataLayer['storageAcl'];

  beforeEach(() => {
    layer = createDataLayer({
      client: createDataClient({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-service-role-key',
      } as never),
      supabaseUrl: 'https://test.supabase.co',
    });
    service = layer.storageAcl;
  });

  const matches = (imageUrl: string | null | undefined, bucket: string, path: string) =>
    (service as any).storageUrlMatchesObject(imageUrl, bucket, path) as boolean;

  it('matches bare path and bucket/path forms', () => {
    expect(matches('owner/card.png', 'flashcard-images', 'owner/card.png')).toBe(true);
    expect(matches('flashcard-images/owner/card.png', 'flashcard-images', 'owner/card.png')).toBe(
      true
    );
  });

  it('matches parsed signed/public URLs only for the exact object', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/sign/flashcard-images/owner/card.png?token=abc';
    expect(matches(url, 'flashcard-images', 'owner/card.png')).toBe(true);
    expect(matches(url, 'flashcard-images', 'owner/card')).toBe(false);
    expect(matches(url, 'question-images', 'owner/card.png')).toBe(false);
  });

  it('rejects substring plants that previously confused ilike matching', () => {
    expect(
      matches(
        'https://example.supabase.co/storage/v1/object/public/flashcard-images/owner/card.png.evil',
        'flashcard-images',
        'owner/card.png'
      )
    ).toBe(false);
    expect(
      matches('other/owner/card.png/extra', 'flashcard-images', 'owner/card.png')
    ).toBe(false);
  });
});
