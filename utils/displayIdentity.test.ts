import { describe, expect, it } from 'vitest';

import {
  NEUTRAL_AVATAR_MARK,
  NEUTRAL_DISPLAY_NAME,
  resolveAvatarIdentity,
  resolveDisplayName,
  withEmailSafeName,
} from './displayIdentity';

describe('resolveDisplayName', () => {
  it('prefers the first real name candidate', () => {
    expect(resolveDisplayName(['Ada Lovelace', 'ignored'])).toBe('Ada Lovelace');
  });

  it('falls back to a neutral placeholder when there is no real name', () => {
    expect(resolveDisplayName([null, undefined, '   '])).toBe(NEUTRAL_DISPLAY_NAME);
  });

  it('accepts a custom fallback', () => {
    expect(resolveDisplayName([], 'Member')).toBe('Member');
  });

  it('skips a candidate that is a strict email address', () => {
    // The core defect: an email must never become a display name...
    expect(resolveDisplayName(['nimaj22@gmail.com'])).toBe(NEUTRAL_DISPLAY_NAME);
  });

  it('never surfaces the local part of an email as a name', () => {
    // ...nor may it collapse to the local part ("nimaj22").
    expect(resolveDisplayName(['nimaj22@gmail.com'])).not.toBe('nimaj22');
    expect(resolveDisplayName(['nimaj22@gmail.com'])).not.toContain('nimaj22');
  });

  it('falls through an email candidate to a later real name', () => {
    expect(resolveDisplayName(['nimaj22@gmail.com', 'Jamin O.'])).toBe('Jamin O.');
  });

  it('keeps a real name that merely resembles an address', () => {
    // A name may be odd; only a *strict* address is rejected.
    expect(resolveDisplayName(['DJ @ Night'])).toBe('DJ @ Night');
  });

  it('trims surrounding whitespace on a real name', () => {
    expect(resolveDisplayName(['  Ada  '])).toBe('Ada');
  });
});

describe('resolveAvatarIdentity', () => {
  it('draws initials and label from a real name', () => {
    expect(resolveAvatarIdentity('Ada Lovelace')).toEqual({
      initials: 'AL',
      label: 'Ada Lovelace',
    });
  });

  it('renders a neutral mark and label for a missing name', () => {
    expect(resolveAvatarIdentity('')).toEqual({
      initials: NEUTRAL_AVATAR_MARK,
      label: NEUTRAL_DISPLAY_NAME,
    });
    expect(resolveAvatarIdentity(null)).toEqual({
      initials: NEUTRAL_AVATAR_MARK,
      label: NEUTRAL_DISPLAY_NAME,
    });
  });

  it('never invents initials from an email, and never speaks the email', () => {
    const identity = resolveAvatarIdentity('nimaj22@gmail.com');
    expect(identity.initials).toBe(NEUTRAL_AVATAR_MARK);
    expect(identity.initials).not.toBe('NI');
    // The accessibility label must not carry the address or its local part.
    expect(identity.label).toBe(NEUTRAL_DISPLAY_NAME);
    expect(identity.label).not.toContain('@');
    expect(identity.label).not.toContain('nimaj22');
  });

  it('seeds the label from the resolved name only (not a raw email)', () => {
    expect(resolveAvatarIdentity('Grace Hopper').label).toBe('Grace Hopper');
  });
});

describe('withEmailSafeName', () => {
  it('drops an email-shaped name so the shared label helper cannot show its local part', () => {
    // The shared helper collapses 'nimaj22@gmail.com' to 'nimaj22'. Nulling the
    // field here is what stops that local part reaching a chat row.
    const safe = withEmailSafeName({ id: 'u1', name: 'nimaj22@gmail.com', username: null });
    expect(safe.name).toBeNull();
    expect(safe.name).not.toBe('nimaj22');
  });

  it('preserves the id so avatar and roster matching still work', () => {
    const safe = withEmailSafeName({ id: 'u1', userId: 'u1', name: 'a@b.co', avatarUrl: 'x' });
    expect(safe.id).toBe('u1');
    expect(safe.userId).toBe('u1');
    expect(safe.avatarUrl).toBe('x');
  });

  it('keeps a genuine name and username untouched', () => {
    const safe = withEmailSafeName({ name: 'Grace Hopper', username: 'grace' });
    expect(safe.name).toBe('Grace Hopper');
    expect(safe.username).toBe('grace');
  });

  it('keeps a real name that merely contains an @', () => {
    expect(withEmailSafeName({ name: 'DJ @ Night' }).name).toBe('DJ @ Night');
  });
});
