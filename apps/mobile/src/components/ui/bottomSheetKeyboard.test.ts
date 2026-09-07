import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BOTTOM_SHEET_MIN_VISIBLE_HEIGHT,
  bottomSheetTopEdge,
  planBottomSheetKeyboard,
} from './bottomSheetKeyboard';

// The device the defect was filmed on (build 171): 1080x2400, ~72px status
// bar, an 870px keyboard, a sheet that wants 92% of the window.
const WINDOW = 2400;
const TOP_INSET = 72;
const RESTING = Math.round(WINDOW * 0.92);
const KEYBOARD = 870;

describe('planBottomSheetKeyboard', () => {
  it('leaves the sheet exactly where it was when no keyboard is up', () => {
    expect(
      planBottomSheetKeyboard({
        windowHeight: WINDOW,
        restingHeight: RESTING,
        keyboardOverlap: 0,
        topInset: TOP_INSET,
      })
    ).toEqual({ height: RESTING, liftBy: 0 });
  });

  it('returns to rest after a keyboard has been up and gone again', () => {
    const raised = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: RESTING,
      keyboardOverlap: KEYBOARD,
      topInset: TOP_INSET,
    });
    const dropped = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: RESTING,
      keyboardOverlap: 0,
      topInset: TOP_INSET,
    });
    expect(raised.liftBy).toBe(KEYBOARD);
    // The whole defect in one assertion: the hide path is a pure function of
    // an overlap of 0, so it cannot keep a residual lift.
    expect(dropped.liftBy).toBe(0);
    expect(dropped.height).toBe(RESTING);
  });

  it('lifts by the keyboard and shrinks to fit instead of overflowing the top', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: RESTING,
      keyboardOverlap: KEYBOARD,
      topInset: TOP_INSET,
    });
    expect(layout.liftBy).toBe(KEYBOARD);
    expect(layout.height).toBe(WINDOW - TOP_INSET - KEYBOARD);
    expect(bottomSheetTopEdge(WINDOW, layout)).toBe(TOP_INSET);
  });

  it('never puts the header above the status bar, at any keyboard height', () => {
    for (let keyboard = 0; keyboard <= WINDOW + 400; keyboard += 37) {
      const layout = planBottomSheetKeyboard({
        windowHeight: WINDOW,
        restingHeight: RESTING,
        keyboardOverlap: keyboard,
        topInset: TOP_INSET,
      });
      expect(bottomSheetTopEdge(WINDOW, layout)).toBeGreaterThanOrEqual(TOP_INSET);
    }
  });

  it('stops lifting once the sheet would have nothing left to show', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: 900,
      restingHeight: 828,
      keyboardOverlap: 800,
      topInset: 60,
    });
    expect(layout.height).toBe(BOTTOM_SHEET_MIN_VISIBLE_HEIGHT);
    expect(layout.liftBy).toBe(900 - 60 - BOTTOM_SHEET_MIN_VISIBLE_HEIGHT);
    expect(bottomSheetTopEdge(900, layout)).toBe(60);
  });

  it('does not grow a sheet that asks for less than the window', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: 600,
      keyboardOverlap: 0,
      topInset: TOP_INSET,
    });
    expect(layout.height).toBe(600);
  });

  it('keeps a short sheet whole rather than clamping it up to the minimum', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: 180,
      keyboardOverlap: KEYBOARD,
      topInset: TOP_INSET,
    });
    expect(layout.height).toBe(180);
    expect(layout.liftBy).toBe(KEYBOARD);
  });

  it('survives a window that has not measured yet', () => {
    expect(
      planBottomSheetKeyboard({ windowHeight: 0, restingHeight: 0, keyboardOverlap: 0 })
    ).toEqual({ height: 0, liftBy: 0 });
  });

  it('treats nonsense numbers as zero rather than producing NaN', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: RESTING,
      keyboardOverlap: Number.NaN,
      topInset: -40,
    });
    expect(layout).toEqual({ height: RESTING, liftBy: 0 });
  });

  it('always returns numbers, never percentage strings', () => {
    const layout = planBottomSheetKeyboard({
      windowHeight: WINDOW,
      restingHeight: RESTING,
      keyboardOverlap: KEYBOARD,
    });
    expect(typeof layout.height).toBe('number');
    expect(typeof layout.liftBy).toBe('number');
  });
});

/**
 * The regression guard.
 *
 * `KeyboardAvoidingView behavior="padding"` inside a transparent,
 * `statusBarTranslucent` Modal is what stranded the generate sheet: on Android
 * the hide event is fed back through the same handler as the show event, so the
 * padding is recomputed rather than cleared and ~200px of it never comes back.
 * A node environment cannot lay a component out, so read the source instead.
 */
describe('bottom sheet sources', () => {
  const components = join(__dirname, '..');
  const SHEETS: Array<{ name: string; path: string }> = [
    { name: 'AIGenerateFlashcardsModal', path: join(components, 'AIGenerateFlashcardsModal.tsx') },
    { name: 'ImportCardsSheet', path: join(components, 'flashcards', 'ImportCardsSheet.tsx') },
    { name: 'TestConfigModal', path: join(components, 'TestConfigModal.tsx') },
  ];

  // Matched on real usage, not on the word: the files explain in prose why the
  // component is gone, and that explanation must not trip its own guard.
  it.each(SHEETS)('$name renders no KeyboardAvoidingView', ({ path }) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/<\s*KeyboardAvoidingView/);
    expect(source).not.toMatch(/^\s*KeyboardAvoidingView,\s*$/m);
  });

  it.each(SHEETS)('$name drives no bare keyboard behavior prop', ({ path }) => {
    // `behavior="padding"` is the half of the old approach that never came
    // back to 0 on Android; nothing here may reintroduce it without the rule.
    expect(readFileSync(path, 'utf8')).not.toMatch(/behavior=[{"]/);
  });

  it.each(SHEETS)('$name sizes itself from the tested rule', ({ path }) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('planBottomSheetKeyboard');
    expect(source).toContain('useKeyboardOverlap');
  });

  it.each(SHEETS)('$name lifts with padding the rule owns, not a literal', ({ path }) => {
    expect(readFileSync(path, 'utf8')).toMatch(/paddingBottom:\s*\w+\.liftBy/);
  });

  it.each(SHEETS)('$name carries no percentage height on the sheet wrapper', ({ path }) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/maxHeight:\s*'\d+%'/);
    expect(source).not.toMatch(/height:\s*'\d+%'/);
  });

  it.each(SHEETS)('$name can be dismissed with the hardware back button', ({ path }) => {
    // Without onRequestClose the second BACK (the first dismisses the
    // keyboard) does nothing, which is half of "open with no way out".
    expect(readFileSync(path, 'utf8')).toMatch(/onRequestClose=\{/);
  });

  it.each(SHEETS)('$name gives its close control a hit area that follows it', ({ path }) => {
    expect(readFileSync(path, 'utf8')).toMatch(/hitSlop=\{/);
  });
});
