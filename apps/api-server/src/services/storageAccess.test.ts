import { SupabaseService } from './supabase';

describe('canAccessStorageObject profile-avatars', () => {
  let service: SupabaseService;
  let visibilitySpy: jest.SpyInstance;
  let peerChatSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SupabaseService({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    });
    visibilitySpy = jest.spyOn(service, 'isProfileVisibleToViewer');
    // When a profile is not visible, canAccessStorageObject falls through to the
    // conversation-peer check (DM / shared group avatars). Without this stub that
    // path issues a real Supabase request and the test dies with "fetch failed".
    // Default to false so "not visible" means "no access" unless a test says otherwise.
    peerChatSpy = jest.spyOn(service, 'canViewPeerChatAvatar').mockResolvedValue(false);
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

describe('storageUrlMatchesObject (exact path ACL)', () => {
  let service: SupabaseService;

  beforeEach(() => {
    service = new SupabaseService({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    });
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
