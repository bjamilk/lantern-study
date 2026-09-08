import {
  CONTEXTUAL_BAR_ANIMATION_MS,
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarClearance,
  contextualBarHeight,
  contextualBarTransitionMs,
  resolveContextualSpec,
  shouldAnimateContextualBar,
} from './contextualBarLayout';
import { tabBarClearance, TAB_BAR_CONTENT_HEIGHT } from './screenInsets';

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

  it('is null while the keyboard is up — the IME covers the row', () => {
    // Build 166, note editor with the keyboard open (21-kbd-up.png): the row
    // was under the IME, on screen but unpressable. A row a thumb cannot reach
    // is worse than no row, and lifting it would cover the text being typed.
    expect(
      resolveContextualSpec({
        spec: SPEC,
        immersive: false,
        withinChrome: true,
        keyboardVisible: true,
      })
    ).toBeNull();
  });

  it('comes straight back when the keyboard goes down', () => {
    // The suppression is a rule, not a latch: the same inputs with the
    // keyboard down give the same row back, unchanged.
    expect(
      resolveContextualSpec({
        spec: SPEC,
        immersive: false,
        withinChrome: true,
        keyboardVisible: false,
      })
    ).toBe(SPEC);
  });

  it('treats an absent keyboard flag as "down"', () => {
    // Every caller that predates the rule keeps today's behaviour.
    expect(resolveContextualSpec({ spec: SPEC, immersive: false, withinChrome: true })).toBe(SPEC);
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

describe('contextualBarClearance in replace mode', () => {
  // Study and Shop take the global bar's place (founder decision, 2026-09-08).
  // The row stands where the bar was, so the bar's own 56 dp content height
  // must come back out of the base — a screen pads for one strip, not two.
  it('takes the global bar back out so the row stands in its place', () => {
    const base = tabBarClearance(0);
    expect(
      contextualBarClearance({
        base,
        contentHeight: 44,
        present: true,
        replaceMode: true,
        globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
      })
    ).toBe(base + 44 - TAB_BAR_CONTENT_HEIGHT);
  });

  it('is exactly the removed bar shorter than the same route in above mode', () => {
    // The whole point of the mode: the difference between the two is the global
    // bar's content height and nothing else. If the subtraction is dropped this
    // fails, because replace mode would clear for two bars like above mode does.
    const base = tabBarClearance(24);
    const above = contextualBarClearance({ base, contentHeight: 44, present: true });
    const replace = contextualBarClearance({
      base,
      contentHeight: 44,
      present: true,
      replaceMode: true,
      globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
    });
    expect(above - replace).toBe(TAB_BAR_CONTENT_HEIGHT);
    // And it is the honest safe-area sum: 44 dp row + the floored inset + gap +
    // extra, with no 56 dp bar in it.
    expect(replace).toBe(tabBarClearance(24) - TAB_BAR_CONTENT_HEIGHT + 44);
  });

  it('never returns less than the row even when the base is degenerate', () => {
    // A NaN base with the bar subtracted would go negative; the floor keeps it
    // at the strip a screen must clear.
    expect(
      contextualBarClearance({
        base: Number.NaN,
        contentHeight: 44,
        present: true,
        replaceMode: true,
        globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
      })
    ).toBe(44);
  });

  it('is the plain base in either mode when the row is hidden (the immersive case)', () => {
    // An immersive route, or any route with no registry entry: `present` is
    // false, nothing stands in the bar's place, so there is no bar to subtract
    // and no row to add. Both modes fall back to the global bar's own
    // clearance. (The keyboard is NOT this case: it hides the row inside the
    // component, while the clearance callers still pass `present` from the
    // route's spec — correctly, because in replace mode the exit control keeps
    // the slot occupied at the row's own height.)
    const base = tabBarClearance(48);
    expect(
      contextualBarClearance({
        base,
        contentHeight: 44,
        present: false,
        replaceMode: true,
        globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT,
      })
    ).toBe(base);
    expect(contextualBarClearance({ base, contentHeight: 44, present: false })).toBe(base);
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
