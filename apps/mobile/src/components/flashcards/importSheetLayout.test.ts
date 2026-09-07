import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IMPORT_SHEET_BOTTOM_GUTTER,
  IMPORT_SHEET_MAX_SHARE,
  IMPORT_SHEET_MIN_SHARE,
  planImportSheetLayout,
} from './importSheetLayout';

describe('planImportSheetLayout', () => {
  it('opens at 90% of the window on a phone with a small status bar', () => {
    const { height } = planImportSheetLayout({
      windowHeight: 2400,
      topInset: 48,
      bottomInset: 24,
    });
    expect(height).toBe(2160);
  });

  it('never exceeds the max share, however small the insets', () => {
    const { height } = planImportSheetLayout({ windowHeight: 800, topInset: 0, bottomInset: 0 });
    expect(height).toBe(Math.round(800 * IMPORT_SHEET_MAX_SHARE));
  });

  it('shrinks toward the floor when the top inset eats the window', () => {
    const { height } = planImportSheetLayout({ windowHeight: 1000, topInset: 250 });
    expect(height).toBe(750);
  });

  it('never falls below the min share, however large the top inset', () => {
    const { height } = planImportSheetLayout({ windowHeight: 1000, topInset: 900 });
    expect(height).toBe(Math.round(1000 * IMPORT_SHEET_MIN_SHARE));
  });

  it('clears the gesture bar under the last control', () => {
    expect(planImportSheetLayout({ windowHeight: 2400, bottomInset: 24 }).contentPaddingBottom).toBe(
      24 + IMPORT_SHEET_BOTTOM_GUTTER
    );
  });

  it('survives a window that has not measured yet', () => {
    expect(planImportSheetLayout({ windowHeight: 0 })).toEqual({
      height: 0,
      contentPaddingBottom: IMPORT_SHEET_BOTTOM_GUTTER,
    });
  });

  it('treats nonsense insets as zero rather than producing NaN', () => {
    const layout = planImportSheetLayout({
      windowHeight: 1000,
      topInset: Number.NaN,
      bottomInset: -30,
    });
    expect(layout.height).toBe(900);
    expect(layout.contentPaddingBottom).toBe(IMPORT_SHEET_BOTTOM_GUTTER);
  });

  it('always returns a number, never a percentage string', () => {
    expect(typeof planImportSheetLayout({ windowHeight: 2400 }).height).toBe('number');
  });
});

/**
 * The regression guard. The sheet's body vanished because the wrapper carried
 * a percentage max-height instead of a definite one, and that is invisible in
 * every unit test: a node environment cannot lay the component out. Read the
 * source instead, so the crush cannot come back quietly.
 */
describe('ImportCardsSheet source', () => {
  const source = readFileSync(join(__dirname, 'ImportCardsSheet.tsx'), 'utf8');

  it('sizes the sheet from the tested planner', () => {
    expect(source).toContain('planImportSheetLayout');
    expect(source).toContain('restingHeight: sheet.height');
  });

  it('takes its rendered height from the keyboard rule, not the resting one', () => {
    // The resting height above is what the sheet WANTS; what it gets also has
    // to survive a keyboard. planBottomSheetKeyboard lifts and shrinks it, and
    // returns the resting geometry unchanged once the keyboard is gone — which
    // the KeyboardAvoidingView it replaced never did on Android.
    expect(source).toContain('planBottomSheetKeyboard');
    expect(source).toContain('style={{ height: frame.height }}');
    expect(source).toContain('paddingBottom: frame.liftBy');
  });

  it('carries no percentage height on the sheet wrapper', () => {
    expect(source).not.toMatch(/maxHeight:\s*'\d+%'/);
    expect(source).not.toMatch(/height:\s*'\d+%'/);
  });

  it('keeps the header out of the flex fight, so the body owns the space', () => {
    expect(source).toContain('className="shrink-0 flex-row items-center gap-3');
  });

  it('pays the bottom inset from the planner, not a hand-written literal', () => {
    // Only at rest: with the sheet lifted the gesture bar is behind the
    // keyboard, so paying its inset as well would strand the last control.
    expect(source).toContain('sheet.contentPaddingBottom');
    expect(source).toMatch(/paddingBottom:.*sheet\.contentPaddingBottom/);
  });
});
