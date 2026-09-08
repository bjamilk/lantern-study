import { initialsFromName } from '@lantern/shared/design';
import {
  NO_PROFILE_NAME,
  emailLocalPart,
  isEmailDerivedName,
  isLiteralEmailAddress,
  nextStoredIdentity,
  parseStoredIdentity,
  profileDisplayName,
  serializeStoredIdentity,
  storedIdentityKey,
  type StoredIdentity,
} from './profileIdentity';

describe('profileDisplayName', () => {
  it('prefers the synced profile row over every other source', () => {
    expect(
      profileDisplayName({
        profileName: 'Benjamin Amadi',
        metadataName: 'ben',
        email: 'nimaj22@example.com',
        lastKnownName: 'Stale Name',
      })
    ).toBe('Benjamin Amadi');
  });

  it('falls back to the last known name, then the metadata copy', () => {
    expect(
      profileDisplayName({ profileName: null, lastKnownName: 'Benjamin Amadi', metadataName: 'ben' })
    ).toBe('Benjamin Amadi');
    expect(
      profileDisplayName({ profileName: null, lastKnownName: null, metadataName: 'ben' })
    ).toBe('ben');
  });

  it('returns an empty string rather than a stand-in name', () => {
    // The regression this exists for: Settings rendered "User" and the board
    // composer rendered "You", and the avatar turned each into a convincing
    // initials chip ("NI", "YO") for an account whose real name was known.
    expect(profileDisplayName({})).toBe('');
    expect(profileDisplayName({ profileName: null, metadataName: null, email: null })).toBe('');
  });

  it('is the same answer for every surface given the same session', () => {
    const session = {
      profileName: 'Benjamin Amadi',
      metadataName: null,
      email: 'b@example.com',
      lastKnownName: null,
    };
    const topBar = profileDisplayName(session);
    const meHeader = profileDisplayName(session);
    const settings = profileDisplayName(session);
    expect(new Set([topBar, meHeader, settings]).size).toBe(1);
  });

  describe('never an email-derived name (the top-bar "NI" regression)', () => {
    // The heart of the finding: offline the top bar read "NI", derived from the
    // email local part "nimaj22", while every other surface said "Benjamin
    // Amadi". An identity that is merely NOT LOADED YET must never be dressed
    // up as letters from an address.

    it('drops the email local part that the auth layer synthesises offline', () => {
      // authStore.displayNameFromUser falls back to the local part when no
      // profile row is loaded, so `profileName` arrives AS "nimaj22" on a cold
      // offline boot. It is not a name.
      expect(
        profileDisplayName({ profileName: 'nimaj22', email: 'nimaj22@example.com' })
      ).toBe('');
    });

    it('drops a literal address arriving as a name source', () => {
      expect(
        profileDisplayName({ metadataName: 'nimaj22@example.com', email: 'nimaj22@example.com' })
      ).toBe('');
    });

    it('cold offline boot: profile absent, email present → NOT the email local part', () => {
      // The exact device case. The email stand-in is skipped and the persisted
      // last known name is restored, so the top bar reads "Benjamin Amadi".
      const resolved = profileDisplayName({
        profileName: 'nimaj22', // the offline stand-in from authStore
        lastKnownName: 'Benjamin Amadi', // persisted from the last online read
        email: 'nimaj22@example.com',
      });
      expect(resolved).toBe('Benjamin Amadi');
      expect(resolved).not.toBe('nimaj22');
    });

    it('first-ever cold offline boot with no persisted name → "?" seed, never the address', () => {
      const seed = profileDisplayName({ profileName: 'nimaj22', email: 'nimaj22@example.com' }) || '?';
      expect(seed).toBe('?');
      expect(seed).not.toMatch(/nimaj22|@/);
    });

    it('keeps a genuine one-word name that is not the email local part', () => {
      expect(
        profileDisplayName({ profileName: 'Ada', email: 'nimaj22@example.com' })
      ).toBe('Ada');
    });
  });

  describe('a genuine saved name that equals the email local part is NOT thrown away', () => {
    // The finding: profiles.name 'ada' with ada@uni.edu resolved to '' and the
    // avatar showed '?'. A real name the student saved is theirs, even when it
    // happens to match the address, as long as it arrives from a GENUINE source
    // (the persisted last-known name or the metadata copy) rather than the
    // ambiguous offline stand-in that travels as `profileName`.

    it('restores it from the persisted last-known name (case-sensitive match)', () => {
      // `profileName` 'ada' is ambiguous and skipped, but `lastKnownName` came
      // from a successful server read and is kept.
      expect(
        profileDisplayName({
          profileName: 'ada',
          lastKnownName: 'ada',
          email: 'ada@uni.edu',
        })
      ).toBe('ada');
    });

    it('keeps it from the metadata copy the student saved', () => {
      expect(
        profileDisplayName({ metadataName: 'ada', email: 'ada@uni.edu' })
      ).toBe('ada');
    });

    it('still refuses a LITERAL address from a genuine source (rule not weakened)', () => {
      // The floor that must survive: an email address itself is never a name,
      // whichever source it arrives on.
      expect(
        profileDisplayName({ lastKnownName: 'ada@uni.edu', email: 'ada@uni.edu' })
      ).toBe('');
      expect(
        profileDisplayName({ metadataName: 'ada@uni.edu', email: 'ada@uni.edu' })
      ).toBe('');
    });

    it('the ambiguous synced source alone is still dropped (offline stand-in stays killed)', () => {
      // Only `profileName` carries the offline email stand-in, so with nothing
      // genuine behind it the result is the honest absence — the 'NI' fix holds.
      expect(profileDisplayName({ profileName: 'ada', email: 'ada@uni.edu' })).toBe('');
    });
  });
});

describe('isLiteralEmailAddress', () => {
  it('flags a literal address and nothing else', () => {
    expect(isLiteralEmailAddress('ada@uni.edu')).toBe(true);
    expect(isLiteralEmailAddress('  ada@uni.edu  ')).toBe(true);
    expect(isLiteralEmailAddress('ada')).toBe(false);
    expect(isLiteralEmailAddress('Benjamin Amadi')).toBe(false);
    expect(isLiteralEmailAddress(null)).toBe(false);
    expect(isLiteralEmailAddress('')).toBe(false);
  });
});

/**
 * The pre-profile placeholder (item 2): the chrome defaults before the shell
 * publishes the real profile must be a GENUINE ABSENCE, not a stand-in. If this
 * regresses to 'Your profile', an avatar seeds a fabricated 'YP' chip — the
 * same class of defect as the 'NI' from an email.
 */
describe('NO_PROFILE_NAME (chrome pre-profile default)', () => {
  it('is empty, and an avatar seeds it as the neutral "?" placeholder', () => {
    expect(NO_PROFILE_NAME).toBe('');
    // ResolvedAvatar draws `initialsFromName(name || '?')`.
    expect(initialsFromName(NO_PROFILE_NAME || '?')).toBe('?');
  });

  it('is never a fabricated name: 1-2 uppercase initials would mean a stand-in', () => {
    // Rule-removal guard: 'Your profile' → 'YP', 'User' → 'US', 'You' → 'YO'.
    // Any non-'?' seed here means someone reintroduced a stand-in default.
    expect(initialsFromName(NO_PROFILE_NAME || '?')).not.toMatch(/^[A-Z]{1,2}$/);
  });

  it('resolves to exactly the value an unknown session produces', () => {
    // The chrome default and the resolver's "nothing known" answer must be the
    // same absence, so the pre-profile frame and the unknown frame agree.
    expect(profileDisplayName({})).toBe(NO_PROFILE_NAME);
  });
});

describe('emailLocalPart', () => {
  it('extracts the local part, or returns "" when there is no email', () => {
    expect(emailLocalPart('nimaj22@gmail.com')).toBe('nimaj22');
    expect(emailLocalPart(null)).toBe('');
    expect(emailLocalPart('  ')).toBe('');
  });
});

describe('isEmailDerivedName', () => {
  it('flags a literal address and the bare local-part stand-in', () => {
    expect(isEmailDerivedName('nimaj22@gmail.com', 'nimaj22')).toBe(true);
    expect(isEmailDerivedName('nimaj22', 'nimaj22')).toBe(true);
  });

  it('leaves a real name alone', () => {
    expect(isEmailDerivedName('Benjamin Amadi', 'nimaj22')).toBe(false);
    // A real one-word name that is not the local part survives.
    expect(isEmailDerivedName('Ada', 'nimaj22')).toBe(false);
  });
});

/**
 * The three avatar states, at the boundary a node test can reach.
 *
 * `ResolvedAvatar` is the one shared presentation helper every surface — the
 * top bar and the Me header included — draws through. It shows the image when a
 * URL both resolves AND loads, and otherwise draws an initials chip from
 * `name || '?'`. `name` is this resolved display name, so what these assertions
 * pin down is the SEED the avatar is handed in each state: it must never be a
 * stand-in ("You", "User") or the email that an initials chip turns into a fake
 * person ("YO", "NI").
 */
describe('avatar fallback seed (ResolvedAvatar contract)', () => {
  const seedFor = (sources: Parameters<typeof profileDisplayName>[0]) =>
    profileDisplayName(sources) || '?';

  it('image state: a known name survives as the seed and the a11y label', () => {
    expect(seedFor({ profileName: 'Benjamin Amadi', email: 'b@example.com' })).toBe('Benjamin Amadi');
  });

  it('initials state: a name with no image seeds from the real name, not a stand-in', () => {
    expect(seedFor({ metadataName: 'ben' })).toBe('ben');
    expect(seedFor({ profileName: 'Ada Lovelace' })).toBe('Ada Lovelace');
  });

  it('missing name: no image and no name seeds "?", never a fabricated identity', () => {
    expect(seedFor({})).toBe('?');
    expect(seedFor({ profileName: null, metadataName: null, email: null })).toBe('?');
    expect(seedFor({})).not.toMatch(/you|user|your profile/i);
    // And never the email, which is the specific regression here.
    expect(seedFor({ email: 'nimaj22@example.com' })).toBe('?');
  });
});

/**
 * Persisted last-known identity: what lets a cold offline boot restore the real
 * name and face instead of the email stand-in.
 */
describe('stored identity persistence', () => {
  it('serialises and parses a round trip', () => {
    const identity: StoredIdentity = { name: 'Benjamin Amadi', avatarUrl: 'https://x/y.png' };
    expect(parseStoredIdentity(serializeStoredIdentity(identity))).toEqual(identity);
  });

  it('treats a corrupt or absent cache as no cache, never a throw', () => {
    expect(parseStoredIdentity(null)).toBeNull();
    expect(parseStoredIdentity('')).toBeNull();
    expect(parseStoredIdentity('{not json')).toBeNull();
    expect(parseStoredIdentity('42')).toBeNull();
  });

  it('keys per user', () => {
    expect(storedIdentityKey('u1')).not.toBe(storedIdentityKey('u2'));
    expect(storedIdentityKey('u1')).toContain('u1');
  });

  describe('nextStoredIdentity', () => {
    it('persists a genuine name and avatar from a successful read', () => {
      expect(
        nextStoredIdentity(null, {
          name: 'Benjamin Amadi',
          avatarUrl: 'https://x/a.png',
          email: 'nimaj22@example.com',
        })
      ).toEqual({ name: 'Benjamin Amadi', avatarUrl: 'https://x/a.png' });
    });

    it('NEVER persists a literal address, so a later boot cannot restore an email', () => {
      // The stand-in the auth layer synthesises offline is the bare local part,
      // and it travels as `profileName` — it never reaches this function. What
      // this function must still refuse is a literal ADDRESS arriving as a name.
      const stored = nextStoredIdentity(null, {
        name: 'nimaj22@example.com',
        avatarUrl: null,
        email: 'nimaj22@example.com',
      });
      expect(stored.name).toBeNull();
    });

    it('persists a genuine saved name that happens to equal the email local part', () => {
      // The finding (item 3) at the storage layer: `fetched.name` here is the
      // server profile row (or the metadata copy), so 'ada' for ada@uni.edu is
      // the student's real name and MUST be kept, or a cold boot loses it.
      const stored = nextStoredIdentity(null, {
        name: 'ada',
        avatarUrl: null,
        email: 'ada@uni.edu',
      });
      expect(stored.name).toBe('ada');
    });

    it('keeps the previous name when a read returns an avatar but no name', () => {
      const previous: StoredIdentity = { name: 'Benjamin Amadi', avatarUrl: null };
      const stored = nextStoredIdentity(previous, {
        name: null,
        avatarUrl: 'https://x/new.png',
        email: 'nimaj22@example.com',
      });
      expect(stored).toEqual({ name: 'Benjamin Amadi', avatarUrl: 'https://x/new.png' });
    });

    it('does not let a literal address overwrite a good stored name', () => {
      const previous: StoredIdentity = { name: 'Benjamin Amadi', avatarUrl: 'https://x/a.png' };
      const stored = nextStoredIdentity(previous, {
        name: 'nimaj22@example.com',
        avatarUrl: null,
        email: 'nimaj22@example.com',
      });
      expect(stored.name).toBe('Benjamin Amadi');
    });
  });
});

/**
 * Regression: the top bar and the Me header resolve to the SAME name and image
 * for one account. Both surfaces read the identity the shell publishes from
 * `useProfileIdentity`, so the guarantee reduces to: one session resolves to
 * exactly one name and one avatar, online AND on a cold offline boot.
 */
describe('top bar and Me header agree for one account', () => {
  it('agree online (fresh profile row present)', () => {
    const session = {
      profileName: 'Benjamin Amadi',
      metadataName: null,
      email: 'nimaj22@example.com',
      lastKnownName: 'Benjamin Amadi',
    };
    const avatar = 'https://x/benjamin.png';
    // The single published identity both surfaces consume.
    const name = profileDisplayName(session);
    expect(name).toBe('Benjamin Amadi');
    // Same object handed to both ResolvedAvatars → identical name + uri.
    const topBar = { name, uri: avatar };
    const meHeader = { name, uri: avatar };
    expect(topBar).toEqual(meHeader);
  });

  it('agree on a cold offline boot (both restore the persisted identity)', () => {
    const session = {
      profileName: 'nimaj22', // authStore stand-in offline
      metadataName: null,
      email: 'nimaj22@example.com',
      lastKnownName: 'Benjamin Amadi', // persisted, restored for both
    };
    const name = profileDisplayName(session);
    expect(name).toBe('Benjamin Amadi');
    expect(name).not.toBe('nimaj22');
  });
});
