import { describe, expect, it } from 'vitest';

import {
  NEUTRAL_AVATAR_MARK,
  NEUTRAL_DISPLAY_NAME,
  resolveAvatarIdentity,
  resolveDisplayName,
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
