/**
 * The name this returns — and, on the create path, WRITES — is not just a
 * greeting.
 *
 * It becomes the auth store's `profileName`, which `resolveSenderIdentity`
 * stamps on the viewer's own chat and board cards until the server's copy
 * arrives — and a community board shows those cards to everyone who can read
 * it. On the missing-profile path it is also written into `profiles.name`,
 * which is exactly what the server trigger was just stopped from deriving from
 * the email address. So every site here routes through the shared
 * `profileDisplayName` planner: a genuine name survives (including one that
 * equals the email local part), and the email address — literal or the bare
 * local part — is never a name and is never stored.
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

  it('never returns the address held in user_metadata.name — resolves to the neutral absence', async () => {
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: '' });
    const result = await ensureUserProfile(
      user({ user_metadata: { name: 'nimaj22@gmail.com' } })
    );
    // Not the email local part 'nimaj22': an address is never a name, and the
    // resolver returns '' so the avatar draws the neutral '?' mark.
    expect(result.displayName).toBe('');
  });

  it('never returns an address held in the profile row itself', async () => {
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: 'nimaj22@gmail.com' });
    expect((await ensureUserProfile(user())).displayName).toBe('');
  });

  it('keeps a genuine profile name that merely equals the email local part', async () => {
    // profiles.name 'ada' for ada@uni.edu came from a successful server read —
    // a real name the student chose, not the offline email stand-in — so it is
    // NOT discarded.
    fetchUserProfile.mockResolvedValue({ id: 'user-1', name: 'ada' });
    expect(
      (await ensureUserProfile(user({ email: 'ada@uni.edu' }))).displayName
    ).toBe('ada');
  });
});

describe('ensureUserProfile create (the WRITE into profiles.name)', () => {
  it('writes NO email-derived name for a bare/address-only signup', async () => {
    fetchUserProfile.mockRejectedValue(new Error('404 not found'));
    const result = await ensureUserProfile(
      user({ user_metadata: { name: 'nimaj22@gmail.com' } })
    );
    // The address is dropped; the empty name is what lands in the database, so
    // a fresh mobile signup leaves no email-derived name there at all.
    expect(result.displayName).toBe('');
    expect(createUserProfile).toHaveBeenCalledWith({ id: 'user-1', name: '' });
  });

  it('writes nothing email-derived when there is no metadata name at all', async () => {
    fetchUserProfile.mockRejectedValue(new Error('404 not found'));
    const result = await ensureUserProfile(user());
    expect(result.displayName).toBe('');
    expect(createUserProfile).toHaveBeenCalledWith({ id: 'user-1', name: '' });
  });

  it('writes a genuine metadata name, including one that equals the email local part', async () => {
    fetchUserProfile.mockRejectedValue(new Error('404 not found'));
    const result = await ensureUserProfile(
      user({ email: 'ada@uni.edu', user_metadata: { name: 'ada' } })
    );
    expect(result.displayName).toBe('ada');
    expect(createUserProfile).toHaveBeenCalledWith({ id: 'user-1', name: 'ada' });
  });

  it('writes a genuine full name from the signup metadata', async () => {
    fetchUserProfile.mockRejectedValue(new Error('404 not found'));
    const result = await ensureUserProfile(
      user({ user_metadata: { name: 'Benjamin Amadi' } })
    );
    expect(result.displayName).toBe('Benjamin Amadi');
    expect(createUserProfile).toHaveBeenCalledWith({ id: 'user-1', name: 'Benjamin Amadi' });
  });
});
