/**
 * Contrast gate for the grid/list toggle (ViewModeToggle.tsx).
 *
 * This control says everything with SHAPE and FILL: there is no `Grid` or
 * `List` word on screen, and no tick. Which of the two is on is carried by one
 * segment being filled and by a 16px glyph inside it. That makes every pair
 * here a WCAG 1.4.11 non-text graphic, and a pair that fails is not a control
 * that looks a bit flat — it is a control whose state cannot be read at all.
 *
 * The pairs measured are exactly the three a student's eye has to separate:
 * the glyph from the segment it sits in (twice, because the two segments have
 * different fills), and the selected segment from the unselected one beside it.
 * Measured with the shared helpers so this cannot disagree with the palette
 * gate, and in high contrast too — that mode repaints the fills.
 */
import {
  contrastRatio,
  darkTheme,
  lightTheme,
} from '@lantern/shared/design';
import { applyHighContrastToColors } from '@lantern/shared/settings';

/** WCAG 1.4.11: a graphic that carries meaning needs 3:1. */
const NON_TEXT = 3;

const PALETTES = [
  { name: 'light', colors: lightTheme },
  { name: 'dark', colors: darkTheme },
  { name: 'light high contrast', colors: applyHighContrastToColors(lightTheme) },
  { name: 'dark high contrast', colors: applyHighContrastToColors(darkTheme) },
];

describe('view mode toggle contrast', () => {
  // `useSegmentSkin(true)` — the pair the selected segment draws with.
  it.each(PALETTES)('$name: the selected glyph reads on its own fill', ({ colors }) => {
    expect(contrastRatio(colors.textInverse, colors.primaryFill)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  // `useSegmentSkin(false)`.
  it.each(PALETTES)('$name: the unselected glyph reads on its own fill', ({ colors }) => {
    expect(contrastRatio(colors.text, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(PALETTES)('$name: the selected segment is visibly the selected one', ({ colors }) => {
    // Without this the toggle still LOOKS fine — two glyphs, a rounded box —
    // and simply does not say which view you are in.
    expect(contrastRatio(colors.primaryFill, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
