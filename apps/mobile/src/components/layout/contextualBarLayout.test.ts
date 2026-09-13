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

describe('contextualBarClearance stacks the row ON TOP of the global bar', () => {
  // Build 185's device pass put the five tabs back on every route, so the row
  // and the bar are BOTH on screen and a screen has to clear both. The old
  // `replace` arithmetic subtracted the bar's 56 dp content height; if that
  // subtraction survived anywhere, the last row of every Study and Shop list
  // would sit under the bar — the offline-box failure, exactly.
  it('adds the row to the full bar clearance, never subtracting the bar', () => {
    const base = tabBarClearance(0);
    const withRow = contextualBarClearance({ base, contentHeight: 44, present: true });
    expect(withRow).toBe(base + 44);
    expect(withRow).toBeGreaterThan(base);
    // The bar's own height is still in there: this is two strips, not one.
    expect(withRow).toBeGreaterThan(44 + TAB_BAR_CONTENT_HEIGHT);
  });

  it('takes no mode argument at all, so no caller can ask for the old shape', () => {
    // An extra key is ignored at runtime; the type rejects it. The point of the
    // assertion is that the SAME number comes back either way — there is no
    // second behaviour left to select.
    const base = tabBarClearance(24);
    const plain = contextualBarClearance({ base, contentHeight: 44, present: true });
    const withStray = contextualBarClearance({
      ...({ replaceMode: true, globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT } as object),
      base,
      contentHeight: 44,
      present: true,
    });
    expect(withStray).toBe(plain);
  });

  it('is the plain base when the row is hidden (the immersive case)', () => {
    const base = tabBarClearance(48);
    expect(contextualBarClearance({ base, contentHeight: 44, present: false })).toBe(base);
  });
});

describe('a row that stands IN the bar\u2019s place (the set row)', () => {
  // The 2026-09-08 replace mode had this arithmetic and the build-185 revert
  // deleted it. It is back because one row replaces the bar again — and a
  // screen that still padded for BOTH would leave a 56 dp band of dead ground
  // between its last item and the row.
  it('pays for the row instead of for the bar', () => {
    const base = tabBarClearance(48);
    expect(
      contextualBarClearance({
        base,
        contentHeight: 44,
        present: true,
        replace: true,
        tabBarContentHeight: 56,
      })
    ).toBe(base + 44 - 56);
  });

  it('still adds the row on every other registry', () => {
    const base = tabBarClearance(48);
    expect(contextualBarClearance({ base, contentHeight: 44, present: true })).toBe(base + 44);
    expect(
      contextualBarClearance({ base, contentHeight: 44, present: true, replace: false, tabBarContentHeight: 56 })
    ).toBe(base + 44);
  });

  it('never clears less than the row itself, whatever it is told', () => {
    // The offline-box rule: err toward clearing too much. A nonsense bar height
    // must not produce a clearance that leaves the last item under the chrome.
    expect(
      contextualBarClearance({
        base: 10,
        contentHeight: 44,
        present: true,
        replace: true,
        tabBarContentHeight: 900,
      })
    ).toBe(44);
  });

  it('subtracts nothing when there is no row at all', () => {
    const base = tabBarClearance(48);
    expect(
      contextualBarClearance({
        base,
        contentHeight: 44,
        present: false,
        replace: true,
        tabBarContentHeight: 56,
      })
    ).toBe(base);
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
