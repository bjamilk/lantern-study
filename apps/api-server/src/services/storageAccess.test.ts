import { SupabaseService } from './supabase';

describe('canAccessStorageObject profile-avatars', () => {
  let service: SupabaseService;
  let visibilitySpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SupabaseService({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    });
    visibilitySpy = jest.spyOn(service, 'isProfileVisibleToViewer');
  });

  afterEach(() => {
    visibilitySpy.mockRestore();
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
});
