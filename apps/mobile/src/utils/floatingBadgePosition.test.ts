import {
  anchorFromDrop,
  anchorLeft,
  anchorTop,
  badgeTravel,
  clampTopRatio,
  parseBadgeAnchor,
  BADGE_SIZE,
  BADGE_WIDTH,
  DEFAULT_BADGE_ANCHOR,
} from './floatingBadgePosition';

// A Pixel-8-shaped window with a status bar and the app's tab bar clearance.
const bounds = { width: 1080, height: 2400, topInset: 60, bottomClearance: 130 };

describe('badgeTravel', () => {
  it('keeps the badge clear of the status bar and the tab bar', () => {
    const { min, max } = badgeTravel(bounds);
    expect(min).toBe(60 + 16);
    expect(max).toBe(2400 - 130 - 16 - BADGE_SIZE);
    expect(max).toBeGreaterThan(min);
  });

  it('collapses to a single point rather than inverting on a very short window', () => {
    // Split-screen: the insets alone exceed the height.
    const { min, max } = badgeTravel({ width: 1080, height: 200, topInset: 60, bottomClearance: 130 });
    expect(max).toBe(min);
    expect(max).toBeGreaterThanOrEqual(min);
  });
});

describe('clampTopRatio', () => {
  it('clamps outside 0..1', () => {
    expect(clampTopRatio(-3)).toBe(0);
    expect(clampTopRatio(9)).toBe(1);
    expect(clampTopRatio(0.25)).toBe(0.25);
  });

  it('falls back to the default for a non-finite ratio', () => {
    expect(clampTopRatio(NaN)).toBe(DEFAULT_BADGE_ANCHOR.topRatio);
    expect(clampTopRatio(Infinity)).toBe(DEFAULT_BADGE_ANCHOR.topRatio);
  });
});

describe('anchorTop / anchorLeft', () => {
  it('places the default anchor mid-band on the right, as before', () => {
    const { min, max } = badgeTravel(bounds);
    expect(anchorTop(DEFAULT_BADGE_ANCHOR, bounds)).toBe(Math.round(min + 0.5 * (max - min)));
    expect(anchorLeft(DEFAULT_BADGE_ANCHOR, bounds)).toBe(1080 - 16 - BADGE_WIDTH);
  });

  it('never places the badge above the status bar or below the tab bar', () => {
    const { min, max } = badgeTravel(bounds);
    expect(anchorTop({ side: 'right', topRatio: 0 }, bounds)).toBe(min);
    expect(anchorTop({ side: 'right', topRatio: 1 }, bounds)).toBe(max);
    // A stored ratio from a taller device must still land inside the band.
    expect(anchorTop({ side: 'right', topRatio: 4 }, bounds)).toBe(max);
  });

  it('parks against the left margin on the left side', () => {
    expect(anchorLeft({ side: 'left', topRatio: 0.5 }, bounds)).toBe(16);
  });
});

describe('anchorFromDrop', () => {
  it('snaps to whichever side the badge centre is nearer', () => {
    // Midpoint is 540; the badge's own centre is left + width/2 (36 by default).
    expect(anchorFromDrop({ left: 500, top: 800 }, bounds).side).toBe('left'); // centre 536
    expect(anchorFromDrop({ left: 510, top: 800 }, bounds).side).toBe('right'); // centre 546
    expect(anchorFromDrop({ left: 0, top: 800 }, bounds).side).toBe('left');
    expect(anchorFromDrop({ left: 1000, top: 800 }, bounds).side).toBe('right');
  });

  it('round-trips a vertical drop back to the same pixel', () => {
    const dropTop = 900;
    const anchor = anchorFromDrop({ left: 900, top: dropTop }, bounds);
    expect(anchorTop(anchor, bounds)).toBe(dropTop);
  });

  it('clamps a drop above the status bar down into the band', () => {
    const anchor = anchorFromDrop({ left: 900, top: -200 }, bounds);
    expect(anchor.topRatio).toBe(0);
    expect(anchorTop(anchor, bounds)).toBe(badgeTravel(bounds).min);
  });

  it('clamps a drop below the tab bar up into the band', () => {
    const anchor = anchorFromDrop({ left: 900, top: 99999 }, bounds);
    expect(anchor.topRatio).toBe(1);
    expect(anchorTop(anchor, bounds)).toBe(badgeTravel(bounds).max);
  });

  it('does not divide by zero when there is no room to travel', () => {
    const tiny = { width: 1080, height: 200, topInset: 60, bottomClearance: 130 };
    const anchor = anchorFromDrop({ left: 900, top: 150 }, tiny);
    expect(Number.isFinite(anchor.topRatio)).toBe(true);
    expect(anchor.topRatio).toBe(0);
  });
});

describe('parseBadgeAnchor', () => {
  it('accepts a stored anchor', () => {
    expect(parseBadgeAnchor({ side: 'left', topRatio: 0.2 })).toEqual({ side: 'left', topRatio: 0.2 });
  });

  it('falls back for junk, missing fields and wrong types', () => {
    expect(parseBadgeAnchor(null)).toEqual(DEFAULT_BADGE_ANCHOR);
    expect(parseBadgeAnchor('nonsense')).toEqual(DEFAULT_BADGE_ANCHOR);
    expect(parseBadgeAnchor({})).toEqual(DEFAULT_BADGE_ANCHOR);
    expect(parseBadgeAnchor({ side: 'up', topRatio: 'x' })).toEqual(DEFAULT_BADGE_ANCHOR);
  });

  it('clamps an out-of-range stored ratio instead of trusting it', () => {
    expect(parseBadgeAnchor({ side: 'right', topRatio: 12 })).toEqual({ side: 'right', topRatio: 1 });
  });
});
