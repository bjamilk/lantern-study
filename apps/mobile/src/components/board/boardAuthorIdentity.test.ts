import {
  BOARD_AUTHOR_FALLBACK,
  looksLikeEmail,
  resolveBoardAuthorIdentity,
} from './boardAuthorIdentity';

describe('looksLikeEmail', () => {
  it.each([
    'ben@uni.edu.ng',
    'BEN@UNI.EDU.NG',
    '  ben.amadi@gmail.com  ',
    'Ben (ben@uni.edu.ng)',
  ])('spots %s', (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(['Benjamin Amadi', '@benamadi', 'Member', '', null, undefined])(
    'leaves %s alone',
    (value) => {
      expect(looksLikeEmail(value)).toBe(false);
    }
  );
});

describe('resolveBoardAuthorIdentity', () => {
  const known = { name: 'Benjamin Amadi', avatarUrl: 'https://cdn/ben.webp' };

  it('draws the row’s own identity on a live card', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: 'Ben A.', avatarUrl: 'https://cdn/new.webp' },
        known,
        isRemoved: false,
      })
    ).toEqual({ name: 'Ben A.', avatarUrl: 'https://cdn/new.webp' });
  });

  // The reported defect: the tombstone rendered whatever the removal payload
  // happened to carry, beside live cards by the same student.
  it('keeps the identity the client already has on a removed card', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: 'benjamin.amadi@uni.edu.ng', avatarUrl: null },
        known,
        isRemoved: true,
      })
    ).toEqual(known);
  });

  it('NEVER renders an email, even with nothing else to fall back to', () => {
    for (const isRemoved of [true, false]) {
      expect(
        resolveBoardAuthorIdentity({
          payload: { name: 'benjamin.amadi@uni.edu.ng' },
          known: null,
          isRemoved,
        })
      ).toEqual({ name: BOARD_AUTHOR_FALLBACK, avatarUrl: undefined });
    }
  });

  it('refuses an email on a live row too, and takes the roster name instead', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: 'ben@uni.edu.ng', avatarUrl: null },
        known,
        isRemoved: false,
      })
    ).toEqual(known);
  });

  it('falls through an unresolved "Member" to the source that knows the name', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: BOARD_AUTHOR_FALLBACK },
        known,
        isRemoved: false,
      }).name
    ).toBe('Benjamin Amadi');
  });

  it('uses the payload on a removed card when the client knows nothing', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: 'Ada Obi', avatarUrl: 'https://cdn/ada.webp' },
        known: null,
        isRemoved: true,
      })
    ).toEqual({ name: 'Ada Obi', avatarUrl: 'https://cdn/ada.webp' });
  });

  it('takes an avatar from whichever source has one', () => {
    expect(
      resolveBoardAuthorIdentity({
        payload: { name: 'Ada Obi', avatarUrl: '   ' },
        known: { name: null, avatarUrl: 'https://cdn/ada.webp' },
        isRemoved: false,
      })
    ).toEqual({ name: 'Ada Obi', avatarUrl: 'https://cdn/ada.webp' });
  });

  it('says "Member" rather than nothing when neither source has a name', () => {
    expect(
      resolveBoardAuthorIdentity({ payload: {}, known: null, isRemoved: true })
    ).toEqual({ name: BOARD_AUTHOR_FALLBACK, avatarUrl: undefined });
  });
});
