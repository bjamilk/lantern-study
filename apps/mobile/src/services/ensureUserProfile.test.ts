/**
 * The name this returns is not just a greeting.
 *
 * It becomes the auth store's `profileName`, which `resolveSenderIdentity`
 * stamps on the viewer's own chat and board cards until the server's copy
 * arrives — and a community board shows those cards to everyone who can read
 * it. An email sign-up routinely leaves the address in `user_metadata.name`, so
 * a post (and the tombstone left behind when it was removed) went out reading
 * "nimaj22@gmail.com".
 */
const fetchUserProfile = jest.fn<Promise<any>, [string]>();
const createUserProfile = jest.fn<Promise<any>, [{ id: string; name: string }]>();

jest.mock('./api', () => ({
  fetchUserProfile: (id: string) => fetchUserProfile(id),
  createUserProfile: (input: { id: string; name: string }) => createUserProfile(input),
}));

import { ensureUserProfile } from './ensureUserProfile';

function user(over: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'nimaj22@gmail.com',
    user_metadata: {},
    ...over,
  } as any;
}

beforeEach(() => {
  fetchUserProfile.mockReset();
  createUserProfile.mockReset().mockResolvedValue({});
});

describe('ensureUserProfile display name', () => {
  it('uses the real profile name when the server has one', async () => {
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: 'Benjamin Amadi' });
    expect((await ensureUserProfile(user())).displayName).toBe('Benjamin Amadi');
  });

  it('never returns the address held in user_metadata.name', async () => {
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: '' });
    const result = await ensureUserProfile(
      user({ user_metadata: { name: 'nimaj22@gmail.com' } })
    );
    expect(result.displayName).toBe('nimaj22');
  });

  it('never returns an address held in the profile row itself', async () => {
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: 'nimaj22@gmail.com' });
    expect((await ensureUserProfile(user())).displayName).toBe('nimaj22');
  });

  it('creates a missing profile under a scrubbed name', async () => {
    fetchUserProfile.mockRejectedValue(new Error('404 not found'));
    const result = await ensureUserProfile(
      user({ user_metadata: { name: 'nimaj22@gmail.com' } })
    );
    expect(result.displayName).toBe('nimaj22');
    expect(createUserProfile).toHaveBeenCalledWith({ id: 'user-1', name: 'nimaj22' });
  });
});
