/**
 * Contrast gate for the shared flashcard grade-chip skin
 * (`flashcardGradeSkin.ts`) — the skin both the review session
 * (screens/flashcards/FlashcardReviewScreen.tsx) and Home's inline card
 * (components/dashboard/InlineReviewCard.tsx) paint their four chips with.
 *
 * Every chip's label sits on its OWN fill, not on the page ground, so a label
 * that does not read is a student guessing which button means "didn't know".
 * The pairs are read out of the helper rather than restated here, so the gate
 * cannot drift from what ships.
 *
 * Dark's `errorBackground` / `successBackground` are EIGHT-digit tokens
 * (`#ef444420`) — 12.5% fills, not solid colours. They are composited over the
 * ground behind them before measuring: handing a contrast helper an alpha hex
 * gets the alpha byte read as part of the blue channel, which silently reports
 * 1.00 and would make this gate a rubber stamp.
 *
 * All four labels are normal-size text (`body` / `text-sm`), so AA_NORMAL is
 * the bar for every one of them — AA_LARGE is not available here.
 */
import {
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
} from '@lantern/shared/design';
import type { FlashcardGradeId } from '@lantern/shared/flashcards/labels';
import { flashcardGradeSkin } from './flashcardGradeSkin';

const GRADES: readonly FlashcardGradeId[] = ['again', 'hard', 'good', 'easy'];

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

describe.each(MODES)('flashcardGradeSkin contrast ($mode)', ({ mode, palette, accents }) => {
  const accent = accents.flashcards;
  // The chip row sits on a card surface in both callers, so a translucent fill
  // composites over `surface`, not over the app background.
  const cases = GRADES.map((rating) => {
    const skin = flashcardGradeSkin(rating, palette, accent);
    return { rating, ink: skin.color, ground: flatten(skin.backgroundColor, palette.surface) };
  });

  it.each(cases)('the $rating chip label reads on its own fill', ({ rating, ink, ground }) => {
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

  it('keeps the red fill on Again — only the label changed', () => {
    expect(flashcardGradeSkin('again', palette, accent).backgroundColor).toBe(
      palette.errorBackground
    );
  });

  it('does not regress Again to colors.error, which fails AA on that fill', () => {
    // The pairing this skin replaced: 4.23:1 in light, 4.45:1 in dark. Asserted
    // so a future "restore the red label" edit has to argue with a number.
    const ground = flatten(palette.errorBackground, palette.surface);
    expect(ratio(palette.error, ground)).toBeLessThan(AA_NORMAL);
    expect(flashcardGradeSkin('again', palette, accent).color).not.toBe(palette.error);
  });

  it('the chip border is visible against the card it sits on', () => {
    // Not a text ratio — a 1px separator only has to be distinguishable, and
    // the "hard" chip is the case that needs it: its fill IS the surface, so
    // without the border it is an invisible button.
    expect(ratio(palette.border, palette.surface)).toBeGreaterThan(1);
  });
});
