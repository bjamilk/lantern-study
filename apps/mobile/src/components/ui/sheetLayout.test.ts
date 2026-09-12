import {
  SHEET_MIN_BODY_HEIGHT,
  SHEET_MIN_VISIBLE_HEIGHT,
  sheetLayout,
} from './sheetLayout';

const PHONE = { windowHeight: 892, topInset: 48 };

describe('sheetLayout', () => {
  it('caps a resting sheet at its share of the room below the status bar', () => {
    const layout = sheetLayout({ ...PHONE, maxHeightRatio: 0.8 });
    // room = 892 - 48 = 844; 80% of it.
    expect(layout.maxSheetHeight).toBe(675);
    expect(layout.liftBy).toBe(0);
  });

  it('returns pixels, never a fraction — the percentage is the bug it replaces', () => {
    const layout = sheetLayout(PHONE);
    expect(Number.isInteger(layout.maxSheetHeight)).toBe(true);
    expect(layout.maxSheetHeight).toBeGreaterThan(1);
    expect(layout.maxBodyHeight).toBeGreaterThan(1);
  });

  it('keeps the sheet top edge below the status bar at every keyboard height', () => {
    for (const keyboardHeight of [0, 120, 300, 420, 700, 900]) {
      const { maxSheetHeight, liftBy } = sheetLayout({ ...PHONE, keyboardHeight });
      const topEdge = PHONE.windowHeight - liftBy - maxSheetHeight;
      expect(topEdge).toBeGreaterThanOrEqual(PHONE.topInset);
    }
  });

  it('shrinks the sheet by exactly what the keyboard takes', () => {
    const rest = sheetLayout({ ...PHONE, keyboardHeight: 0 });
    const typing = sheetLayout({ ...PHONE, keyboardHeight: 340 });
    expect(typing.liftBy).toBe(340);
    // 844 - 340 = 504, tighter than the 675 resting cap.
    expect(typing.maxSheetHeight).toBe(504);
    expect(typing.maxSheetHeight).toBeLessThan(rest.maxSheetHeight);
  });

  it('gives the space back when the keyboard hides', () => {
    const typing = sheetLayout({ ...PHONE, keyboardHeight: 340 });
    const after = sheetLayout({ ...PHONE, keyboardHeight: 0 });
    expect(typing.liftBy).toBeGreaterThan(0);
    expect(after).toEqual(sheetLayout(PHONE));
    expect(after.liftBy).toBe(0);
  });

  it('stops lifting once the sheet would have nothing left on screen', () => {
    const layout = sheetLayout({ ...PHONE, keyboardHeight: 860 });
    expect(layout.liftBy).toBe(844 - SHEET_MIN_VISIBLE_HEIGHT);
    expect(layout.maxSheetHeight).toBe(SHEET_MIN_VISIBLE_HEIGHT);
  });

  it('takes the header and footer out of the body, not out of the footer', () => {
    const layout = sheetLayout({ ...PHONE, headerHeight: 90, footerHeight: 76 });
    expect(layout.maxBodyHeight).toBe(675 - 90 - 76);
  });

  it('never crushes the body to a sliver when the chrome is tall', () => {
    // Build 186: keyboard up, footer measured, body asked to be negative — the
    // 14 px sliver with a zero-height label.
    const layout = sheetLayout({
      ...PHONE,
      keyboardHeight: 560,
      headerHeight: 120,
      footerHeight: 200,
    });
    expect(layout.maxBodyHeight).toBeGreaterThanOrEqual(SHEET_MIN_BODY_HEIGHT);
  });

  it('survives a window it has not measured yet', () => {
    expect(sheetLayout({ windowHeight: 0 })).toEqual({
      maxSheetHeight: 0,
      maxBodyHeight: 0,
      liftBy: 0,
    });
    expect(sheetLayout({ windowHeight: Number.NaN, topInset: Number.NaN })).toEqual({
      maxSheetHeight: 0,
      maxBodyHeight: 0,
      liftBy: 0,
    });
  });

  it('clamps a nonsense ratio instead of letting the sheet exceed the room', () => {
    expect(sheetLayout({ ...PHONE, maxHeightRatio: 4 }).maxSheetHeight).toBe(844);
    expect(sheetLayout({ ...PHONE, maxHeightRatio: 0 }).maxSheetHeight).toBe(675);
  });
});
