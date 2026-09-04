import {
  keyboardBottomOffset,
  keyboardSafeMaxHeight,
  scrollClearanceForActionBar,
  stickyBarPaddingBottom,
} from './keyboardSafeLayout';

describe('keyboardBottomOffset', () => {
  it('is the gap between the window bottom and the keyboard top', () => {
    expect(keyboardBottomOffset(800, 500)).toBe(300);
  });

  it('is 0 when the keyboard is off-screen or below the window', () => {
    expect(keyboardBottomOffset(800, 800)).toBe(0);
    expect(keyboardBottomOffset(800, 900)).toBe(0);
  });

  it('never returns NaN for unmeasurable geometry', () => {
    expect(keyboardBottomOffset(Number.NaN, 500)).toBe(0);
    expect(keyboardBottomOffset(800, Number.NaN)).toBe(0);
  });
});

describe('stickyBarPaddingBottom', () => {
  it('pays the full resting clearance while the keyboard is closed', () => {
    expect(
      stickyBarPaddingBottom({ keyboardOffset: 0, restingClearance: 102, keyboardExtra: 16 })
    ).toBe(102);
  });

  it('drops to the small gap once the keyboard hides the tab bar', () => {
    // Otherwise the bar floats ~102px above the keyboard in a dead band.
    expect(
      stickyBarPaddingBottom({ keyboardOffset: 300, restingClearance: 102, keyboardExtra: 16 })
    ).toBe(16);
  });
});

describe('keyboardSafeMaxHeight', () => {
  const base = { windowHeight: 800, panelTopY: 200, margin: 8, minHeight: 140 };

  it('applies no cap while the keyboard is closed', () => {
    expect(keyboardSafeMaxHeight({ ...base, keyboardOffset: 0 })).toBeUndefined();
  });

  it('applies no cap before the panel has been measured', () => {
    expect(keyboardSafeMaxHeight({ ...base, panelTopY: 0, keyboardOffset: 300 })).toBeUndefined();
  });

  it('caps the panel to the room left above the keyboard', () => {
    // 800 window - 300 keyboard - 200 panel top - 8 margin
    expect(keyboardSafeMaxHeight({ ...base, keyboardOffset: 300 })).toBe(292);
  });

  it('never collapses the panel below its floor', () => {
    expect(keyboardSafeMaxHeight({ ...base, keyboardOffset: 600 })).toBe(140);
  });
});

describe('scrollClearanceForActionBar', () => {
  it('reserves the measured bar height when a bar is rendered', () => {
    expect(scrollClearanceForActionBar({ actionBarHeight: 280, baseClearance: 36 })).toBe(280);
  });

  it('falls back to the page clearance when no bar is rendered', () => {
    expect(scrollClearanceForActionBar({ actionBarHeight: 0, baseClearance: 36 })).toBe(36);
  });

  it('never lets a short bar reduce the page clearance', () => {
    expect(scrollClearanceForActionBar({ actionBarHeight: 20, baseClearance: 36 })).toBe(36);
  });
});
