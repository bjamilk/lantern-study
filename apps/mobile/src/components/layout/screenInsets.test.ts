import {
  DEFAULT_BOTTOM_EXTRA,
  SAFE_BOTTOM_INSET_FLOOR,
  TAB_BAR_BOTTOM_INSET_FLOOR,
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_GAP,
  fallbackInsets,
  resolveBottomClearance,
  resolveEdgePadding,
  safeBottomClearance,
  scrollDeltaToRevealInput,
  tabBarClearance,
  type ScreenEdgeInsets,
} from './screenInsets';

const insets = (top: number, bottom: number, left = 0, right = 0): ScreenEdgeInsets => ({
  top,
  bottom,
  left,
  right,
});

describe('tabBarClearance', () => {
  it('matches the bar geometry: 56 + max(inset, 20) + 10 + extra', () => {
    expect(tabBarClearance(48, 16)).toBe(TAB_BAR_CONTENT_HEIGHT + 48 + TAB_BAR_GAP + 16);
    expect(tabBarClearance(48, 16)).toBe(130);
  });

  it('floors the system inset at 20 for Android gesture nav', () => {
    // Gesture nav reports 0-ish; the bar itself pads by the same floor, so the
    // clearance must too or content lands under the bar on those devices.
    expect(tabBarClearance(0, 16)).toBe(102);
    expect(tabBarClearance(8, 16)).toBe(102);
    expect(tabBarClearance(TAB_BAR_BOTTOM_INSET_FLOOR, 16)).toBe(102);
    expect(tabBarClearance(21, 16)).toBe(103);
  });

  it('defaults extra to 16', () => {
    expect(tabBarClearance(0)).toBe(tabBarClearance(0, DEFAULT_BOTTOM_EXTRA));
  });

  it('always exceeds every literal the screens hand-rolled', () => {
    // pb-8 is 28px here (NativeWind inlines rem at 14, so 2rem = 28, not 32).
    for (const literal of [14, 20, 24, 28, 32, 35, 40, 48, 100]) {
      expect(tabBarClearance(0)).toBeGreaterThan(literal);
    }
  });

  it('treats a nonsense inset as zero rather than poisoning layout', () => {
    expect(tabBarClearance(Number.NaN, 16)).toBe(102);
    expect(tabBarClearance(-10, 16)).toBe(102);
  });
});

describe('safeBottomClearance', () => {
  it('is max(inset, 12) + extra', () => {
    expect(safeBottomClearance(34, 12)).toBe(46);
    expect(safeBottomClearance(0, 12)).toBe(SAFE_BOTTOM_INSET_FLOOR + 12);
    expect(safeBottomClearance(0)).toBe(28);
  });

  it('never returns less than the floor', () => {
    expect(safeBottomClearance(0, 0)).toBe(SAFE_BOTTOM_INSET_FLOOR);
  });
});

describe('resolveBottomClearance', () => {
  it('auto pays tab-bar clearance only when the bar is over the route', () => {
    expect(resolveBottomClearance({ mode: 'auto', bottomInset: 0, tabBarPresent: true })).toBe(102);
    expect(resolveBottomClearance({ mode: 'auto', bottomInset: 0, tabBarPresent: false })).toBe(28);
  });

  it('is the fix for the immersive-vs-tabbed split screens got wrong by hand', () => {
    // Cart (non-immersive) needed tab-bar clearance and got it; Offers, same
    // shape, paid insets.bottom + 16 and lost its Send button under the bar.
    const immersive = resolveBottomClearance({ mode: 'auto', bottomInset: 34, tabBarPresent: false });
    const tabbed = resolveBottomClearance({ mode: 'auto', bottomInset: 34, tabBarPresent: true });
    expect(tabbed).toBeGreaterThan(immersive);
    expect(tabbed - immersive).toBe(TAB_BAR_CONTENT_HEIGHT + TAB_BAR_GAP);
  });

  it('honours explicit overrides regardless of the host', () => {
    expect(resolveBottomClearance({ mode: 'tabBar', bottomInset: 0, tabBarPresent: false })).toBe(102);
    expect(resolveBottomClearance({ mode: 'safe', bottomInset: 0, tabBarPresent: true })).toBe(28);
  });

  it('none pays nothing, so a screen can pin its own footer', () => {
    expect(resolveBottomClearance({ mode: 'none', bottomInset: 34, tabBarPresent: true })).toBe(0);
  });

  it('adds the cookie-notice overlay in every mode, including none', () => {
    expect(
      resolveBottomClearance({ mode: 'none', bottomInset: 34, tabBarPresent: true, cookieNoticeInset: 120 })
    ).toBe(120);
    expect(
      resolveBottomClearance({ mode: 'auto', bottomInset: 0, tabBarPresent: false, cookieNoticeInset: 120 })
    ).toBe(148);
  });

  it('ignores the cookie notice once a choice is recorded (inset 0)', () => {
    expect(
      resolveBottomClearance({ mode: 'auto', bottomInset: 0, tabBarPresent: true, cookieNoticeInset: 0 })
    ).toBe(102);
  });
});

describe('resolveEdgePadding', () => {
  it('pays only the edges the container owns', () => {
    expect(resolveEdgePadding(insets(47, 34), ['top'])).toEqual({
      paddingTop: 47,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    });
  });

  it('pays nothing for top when a header above it already did', () => {
    // The double-pad case: ScreenHeader safeTop, or the in-flow TopBar.
    expect(resolveEdgePadding(insets(47, 34), []).paddingTop).toBe(0);
  });

  it('never emits bottom padding — bottom is resolveBottomClearance business', () => {
    expect(resolveEdgePadding(insets(47, 34), ['top', 'left', 'right']).paddingBottom).toBe(0);
  });

  it('carries the horizontal insets when asked', () => {
    expect(resolveEdgePadding(insets(47, 34, 12, 8), ['left', 'right'])).toEqual({
      paddingTop: 0,
      paddingRight: 8,
      paddingBottom: 0,
      paddingLeft: 12,
    });
  });
});

describe('fallbackInsets', () => {
  const initial = insets(47, 34);

  it('restores a detached fullScreenModal window that measures all zeroes', () => {
    expect(fallbackInsets(insets(0, 0), initial)).toEqual(initial);
  });

  it('leaves a correctly measured window alone', () => {
    expect(fallbackInsets(insets(59, 34), initial)).toEqual(insets(59, 34));
  });

  it('falls back per edge, not all-or-nothing', () => {
    // Android 3-button nav: top measured fine, bottom came back 0.
    expect(fallbackInsets(insets(24, 0), insets(24, 48))).toEqual(insets(24, 48));
  });

  it('is a no-op when initial metrics are unavailable', () => {
    expect(fallbackInsets(insets(0, 0), null)).toEqual(insets(0, 0));
    expect(fallbackInsets(insets(0, 0), undefined)).toEqual(insets(0, 0));
  });

  it('does not resurrect a genuinely zero inset when the initial one is zero too', () => {
    expect(fallbackInsets(insets(0, 0), insets(0, 0))).toEqual(insets(0, 0));
  });
});

describe('scrollDeltaToRevealInput', () => {
  it('is zero when the input already clears the keyboard', () => {
    expect(scrollDeltaToRevealInput({ inputBottomY: 300, keyboardTopY: 500 })).toBe(0);
  });

  it('scrolls exactly far enough to clear the keyboard plus the margin', () => {
    expect(scrollDeltaToRevealInput({ inputBottomY: 560, keyboardTopY: 500, margin: 16 })).toBe(76);
  });

  it('accounts for the margin when the input is flush against the keyboard', () => {
    expect(scrollDeltaToRevealInput({ inputBottomY: 500, keyboardTopY: 500, margin: 16 })).toBe(16);
  });

  it('never scrolls a visible field away', () => {
    expect(scrollDeltaToRevealInput({ inputBottomY: 0, keyboardTopY: 500, margin: 16 })).toBe(0);
  });

  it('returns 0 for unmeasurable geometry instead of jumping the list', () => {
    expect(scrollDeltaToRevealInput({ inputBottomY: Number.NaN, keyboardTopY: 500 })).toBe(0);
    expect(scrollDeltaToRevealInput({ inputBottomY: 560, keyboardTopY: Number.NaN })).toBe(0);
  });
});
