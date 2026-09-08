import { profileDisplayName } from './profileIdentity';

describe('profileDisplayName', () => {
  it('prefers the synced profile row over every other source', () => {
    expect(
      profileDisplayName({
        profileName: 'Benjamin Amadi',
        metadataName: 'ben',
        email: 'nimaj22@example.com',
      })
    ).toBe('Benjamin Amadi');
  });

  it('falls back to the auth metadata copy, then the email local part', () => {
    expect(
      profileDisplayName({ profileName: null, metadataName: 'ben', email: 'nimaj22@example.com' })
    ).toBe('ben');
    expect(
      profileDisplayName({ profileName: '   ', metadataName: '', email: 'nimaj22@example.com' })
    ).toBe('nimaj22');
  });

  it('returns an empty string rather than a stand-in name', () => {
    // The regression this exists for: Settings rendered "User" and the board
    // composer rendered "You", and the avatar turned each into a convincing
    // initials chip ("NI", "YO") for an account whose real name was known.
    expect(profileDisplayName({})).toBe('');
    expect(profileDisplayName({ profileName: null, metadataName: null, email: null })).toBe('');
  });

  it('is the same answer for every surface given the same session', () => {
    const session = { profileName: 'Benjamin Amadi', metadataName: null, email: 'b@example.com' };
    const me = profileDisplayName(session);
    const settings = profileDisplayName(session);
    const boardComposer = profileDisplayName(session);
    expect(new Set([me, settings, boardComposer]).size).toBe(1);
  });
});
