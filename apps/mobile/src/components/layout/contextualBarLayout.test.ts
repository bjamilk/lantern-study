import {
  CONTEXTUAL_BAR_ANIMATION_MS,
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarClearance,
  contextualBarHeight,
  contextualBarTransitionMs,
  resolveContextualSpec,
  shouldAnimateContextualBar,
} from './contextualBarLayout';
import { tabBarClearance } from './screenInsets';

const SPEC = { key: 'study', items: [] };

describe('resolveContextualSpec', () => {
  it('passes the registry answer through on a tabbed, non-immersive route', () => {
    expect(resolveContextualSpec({ spec: SPEC, immersive: false, withinChrome: true })).toBe(SPEC);
  });

  it('is null when the registry has no entry for the route', () => {
    expect(resolveContextualSpec({ spec: null, immersive: false, withinChrome: true })).toBeNull();
    expect(
      resolveContextualSpec({ spec: undefined, immersive: false, withinChrome: true })
    ).toBeNull();
  });

  it('is null on an immersive route even when the registry has an entry', () => {
    // A study session, a chat with its own header: both bars unmount, and a
    // stray strip over the session footer is exactly what this prevents.
    expect(resolveContextualSpec({ spec: SPEC, immersive: true, withinChrome: true })).toBeNull();
  });

  it('is null outside the chrome, where there is no bar to sit above', () => {
    expect(resolveContextualSpec({ spec: SPEC, immersive: false, withinChrome: false })).toBeNull();
  });
});

describe('CONTEXTUAL_BAR_CONTENT_HEIGHT', () => {
  it('is 44 — the number the spec names and Material\'s minimum target', () => {
    expect(CONTEXTUAL_BAR_CONTENT_HEIGHT).toBe(44);
  });
});

describe('contextualBarHeight', () => {
  it('is the content height when present and 0 when not', () => {
    expect(contextualBarHeight(true, 44)).toBe(44);
    expect(contextualBarHeight(false, 44)).toBe(0);
  });

  it('treats a non-finite or negative height as 0 rather than poisoning layout', () => {
    expect(contextualBarHeight(true, Number.NaN)).toBe(0);
    expect(contextualBarHeight(true, -12)).toBe(0);
  });
});

describe('contextualBarClearance', () => {
  it('adds the row to the tab-bar clearance so the last list row clears both', () => {
    const base = tabBarClearance(0);
    expect(contextualBarClearance({ base, contentHeight: 44, present: true })).toBe(base + 44);
  });

  it("is today's shell exactly when no row is on screen", () => {
    const base = tabBarClearance(48);
    expect(contextualBarClearance({ base, contentHeight: 44, present: false })).toBe(base);
  });

  it('never returns less than the row it has to clear', () => {
    expect(contextualBarClearance({ base: Number.NaN, contentHeight: 44, present: true })).toBe(44);
  });
});

describe('the swap animation', () => {
  it('runs for 150 ms by default', () => {
    expect(contextualBarTransitionMs(false)).toBe(CONTEXTUAL_BAR_ANIMATION_MS);
    expect(CONTEXTUAL_BAR_ANIMATION_MS).toBe(150);
    expect(shouldAnimateContextualBar(false)).toBe(true);
  });

  it('is instant under the reduce-motion setting', () => {
    expect(contextualBarTransitionMs(true)).toBe(0);
    expect(shouldAnimateContextualBar(true)).toBe(false);
  });
});
