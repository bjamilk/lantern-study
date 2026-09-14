/**
 * Contrast gate for Home's inline review card (InlineReviewCard.tsx).
 *
 * The card is the one place on Home where a student GRADES something, and it
 * paints the four grade chips with the review screen's own skin
 * (`gradeChipSkin`, screens/flashcards/FlashcardReviewScreen.tsx): each chip's
 * label sits on its own fill, not on the card surface. A chip whose label does
 * not read is a student guessing which button means "didn't know".
 *
 * The pairs asserted here are exactly the four the screen and the card both
 * use, plus the card's own inks on the surface behind them:
 *
 *   again  colors.text     on colors.errorBackground
 *   hard   colors.text     on colors.surface
 *   good   colors.success  on colors.successBackground
 *   easy   accent.ink      on accent.tint          (the flashcards lime)
 *   prompt colors.text / textSecondary / textTertiary on colors.surface
 *
 * "Again" is the one that is NOT the review screen's own ink, and this file is
 * why: the screen sets it in `colors.error`, which measures 4.23:1 (light) and
 * 4.45:1 (dark) on the pale red fill. `error` is a ring/page-ground red by
 * design, not a label-on-tint red, and there is no "ink on errorBackground"
 * token, so the card takes the page ink and keeps the red fill.
 *
 * Dark's `errorBackground` / `successBackground` are EIGHT-digit tokens
 * (`#ef444420`) — 12.5% fills, not solid colours. They are composited over the
 * card surface before measuring: handing a contrast helper an alpha hex gets
 * the alpha byte read as part of the blue channel, which silently reports 1.00
 * and would have made this gate a rubber stamp.
 *
 * Measured in both palettes with the same helpers as
 * packages/shared/src/design/contrast.ts, so this cannot disagree with the
 * palette gate or with readinessCardContrast.test.ts.
 *
 * All four labels are set at the `body` step, which is normal-size text, so
 * AA_NORMAL is the bar for every one of them — AA_LARGE is not available here.
 */
import {
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
} from '@lantern/shared/design';

const MODES = [
  { mode: 'light' as const, palette: lightTheme, accents: featureAccentsLight },
  { mode: 'dark' as const, palette: darkTheme, accents: featureAccentsDark },
];

function ratio(ink: string, ground: string): number {
  return Number(contrastRatio(ink, ground).toFixed(2));
}

/**
 * `#rrggbbaa` over an opaque ground, as the renderer draws it. A 6-digit hex
 * is returned untouched, so the same call is correct in both palettes.
 */
function flatten(color: string, ground: string): string {
  const hex = color.replace('#', '');
  if (hex.length !== 8) return color;
  const alpha = parseInt(hex.slice(6, 8), 16) / 255;
  const under = ground.replace('#', '');
  const channels = [0, 2, 4].map((at) => {
    const top = parseInt(hex.slice(at, at + 2), 16);
    const bottom = parseInt(under.slice(at, at + 2), 16);
    return Math.round(top * alpha + bottom * (1 - alpha));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(MODES)('InlineReviewCard contrast ($mode)', ({ mode, palette, accents }) => {
  const on = (fill: string) => flatten(fill, palette.surface);
  const chips = [
    { rating: 'again', ink: palette.text, ground: on(palette.errorBackground) },
    { rating: 'hard', ink: palette.text, ground: palette.surface },
    { rating: 'good', ink: palette.success, ground: on(palette.successBackground) },
    { rating: 'easy', ink: accents.flashcards.ink, ground: accents.flashcards.tint },
  ];

  it.each(chips)('the $rating chip label reads on its own fill', ({ rating, ink, ground }) => {
    // Reported as an object so a failure names WHICH chip and which palette
    // rather than printing two bare numbers.
    const measured = ratio(ink, ground);
    expect({ mode, rating, passes: measured >= AA_NORMAL, measured }).toEqual({
      mode,
      rating,
      passes: true,
      measured,
    });
  });

  it.each(['text', 'textSecondary', 'textTertiary'] as const)(
    'the card copy (%s) reads on the card surface',
    (ink) => {
      const measured = ratio(palette[ink], palette.surface);
      expect({ mode, ink, passes: measured >= AA_NORMAL, measured }).toEqual({
        mode,
        ink,
        passes: true,
        measured,
      });
    }
  );

  it('the chip border is visible against the card it sits on', () => {
    // Not a text ratio — a 1px separator only has to be distinguishable, and
    // the "hard" chip is the case that needs it: its fill IS the surface, so
    // without the border it is an invisible button.
    expect(ratio(palette.border, palette.surface)).toBeGreaterThan(1);
  });
});
