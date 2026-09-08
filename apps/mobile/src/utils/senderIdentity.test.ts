import { resolveSenderIdentity } from './senderIdentity';

const ME = 'user-me-1';
const viewer = {
  id: ME,
  username: 'benjamin',
  name: 'Benjamin Amadi',
  avatarUrl: 'https://example.test/me.png',
};

describe('resolveSenderIdentity', () => {
  it('uses the signed-in profile for the viewer\'s own row when neither sender nor roster has a name', () => {
    // The board case: no roster fetched, no embedded sender. This rendered as
    // "Member" with initials until the app was restarted.
    const r = resolveSenderIdentity({ senderId: ME, viewer });
    expect(r.name).toBe('Benjamin Amadi');
    expect(r.avatarUrl).toBe('https://example.test/me.png');
  });

  it('falls back to the @username when the viewer has no display name', () => {
    const r = resolveSenderIdentity({
      senderId: ME,
      viewer: { ...viewer, name: null },
    });
    expect(r.name).toBe('@benjamin');
  });

  it('never borrows the viewer\'s identity for somebody else\'s row', () => {
    const r = resolveSenderIdentity({ senderId: 'user-other', viewer });
    expect(r.name).toBe('Member');
    expect(r.avatarUrl).toBeUndefined();
  });

  it('prefers the embedded sender over the roster and over the viewer', () => {
    const r = resolveSenderIdentity({
      senderId: ME,
      sender: { name: 'Server Name', avatarUrl: 'https://example.test/server.png' },
      rosterMember: { name: 'Roster Name' },
      viewer,
    });
    expect(r.name).toBe('Server Name');
    expect(r.avatarUrl).toBe('https://example.test/server.png');
  });

  it('prefers the roster over the viewer', () => {
    const r = resolveSenderIdentity({
      senderId: ME,
      rosterMember: { name: 'Roster Name' },
      viewer,
    });
    expect(r.name).toBe('Roster Name');
  });

  it('still reports Member when nothing at all identifies the sender', () => {
    const r = resolveSenderIdentity({ senderId: 'user-other' });
    expect(r.name).toBe('Member');
    expect(r.avatarUrl).toBeUndefined();
  });

  it('does not treat an empty senderId as the viewer', () => {
    const r = resolveSenderIdentity({ senderId: '', viewer: { ...viewer, id: '' } });
    expect(r.name).toBe('Member');
  });
});

/**
 * A community board publishes every card to everyone who can read it. The
 * viewer's own freshly created post is drawn from `viewer` alone (no roster, no
 * embedded sender), and `viewer.name` is the auth store's `profileName` — which
 * used to be `user_metadata.name` verbatim, i.e. the address an email sign-up
 * put there. The post's tombstone then carried "nimaj22@gmail.com" and its
 * initials next to live cards showing the same person's real name.
 */
describe('an email address never becomes a sender label', () => {
  it('shows the local part, not the address, for the viewer\'s own row', () => {
    const r = resolveSenderIdentity({
      senderId: ME,
      viewer: { id: ME, name: 'nimaj22@gmail.com', username: null, avatarUrl: null },
    });
    expect(r.name).toBe('nimaj22');
  });

  it('refuses an address coming from the server\'s embedded sender too', () => {
    const r = resolveSenderIdentity({
      senderId: ME,
      sender: { name: 'nimaj22@gmail.com' },
      viewer,
    });
    expect(r.name).toBe('nimaj22');
  });

  it('refuses an address coming from the roster', () => {
    const r = resolveSenderIdentity({
      senderId: 'user-other',
      rosterMember: { name: 'someone@example.com' },
    });
    expect(r.name).toBe('someone');
  });
});
