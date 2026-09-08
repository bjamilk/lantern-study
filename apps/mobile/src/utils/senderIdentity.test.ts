import { resolveSenderIdentity, firstNonEmailValue, withEmailSafeName } from './senderIdentity';

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
describe('an email address never becomes a sender label — not even its local part', () => {
  it('drops the address entirely for the viewer\'s own row, never its local part', () => {
    // A nameless viewer whose only "name" is the address: the label falls
    // through to the neutral "Member", never "nimaj22". Reducing the address to
    // its local part is exactly the leak this rule kills.
    const r = resolveSenderIdentity({
      senderId: ME,
      viewer: { id: ME, name: 'nimaj22@gmail.com', username: null, avatarUrl: null },
    });
    expect(r.name).toBe('Member');
    expect(r.name).not.toBe('nimaj22');
  });

  it('skips an address from the embedded sender and falls to a genuine later source', () => {
    // The server's embedded sender carries an address, but the viewer (this is
    // their own row) has a real name — resolution skips the address and uses it
    // rather than collapsing the address to its local part.
    const r = resolveSenderIdentity({
      senderId: ME,
      sender: { name: 'nimaj22@gmail.com' },
      viewer,
    });
    expect(r.name).toBe('Benjamin Amadi');
    expect(r.name).not.toBe('nimaj22');
  });

  it('drops an address coming from the roster, never its local part', () => {
    const r = resolveSenderIdentity({
      senderId: 'user-other',
      rosterMember: { name: 'someone@example.com' },
    });
    expect(r.name).toBe('Member');
    expect(r.name).not.toBe('someone');
  });
});

describe('firstNonEmailValue', () => {
  it('returns the first non-empty, non-email candidate in order', () => {
    expect(firstNonEmailValue(null, '  ', 'Ada', 'Ben')).toBe('Ada');
  });

  it('skips a literal email address and keeps looking', () => {
    // The core rule: an address is not a display value, so it is passed over —
    // never reduced to its local part.
    expect(firstNonEmailValue('nimaj22@example.com', 'Benjamin Amadi')).toBe('Benjamin Amadi');
  });

  it('returns null when every candidate is empty or an address', () => {
    expect(firstNonEmailValue(null, undefined, 'a@b.co')).toBeNull();
  });

  it('keeps a real name that merely contains an @', () => {
    // A nickname is allowed to be odd; only a strict address is refused.
    expect(firstNonEmailValue('DJ @ Night')).toBe('DJ @ Night');
  });
});

describe('withEmailSafeName', () => {
  it('drops an email-shaped name but preserves id and avatarUrl', () => {
    const safe = withEmailSafeName({
      id: 'u1',
      userId: 'u1',
      name: 'nimaj22@example.com',
      username: null,
      avatarUrl: 'https://example.test/a.png',
    });
    expect(safe.name).toBeNull();
    expect(safe.id).toBe('u1');
    expect(safe.userId).toBe('u1');
    expect(safe.avatarUrl).toBe('https://example.test/a.png');
  });

  it('keeps a genuine name untouched', () => {
    const safe = withEmailSafeName({ id: 'u1', name: 'Benjamin Amadi', username: 'ben' });
    expect(safe.name).toBe('Benjamin Amadi');
    expect(safe.username).toBe('ben');
  });
});
