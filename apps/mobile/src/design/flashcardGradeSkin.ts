/**
 * The one grade-chip skin, shared by every place a student grades a card:
 * `screens/flashcards/FlashcardReviewScreen.tsx` (the session) and
 * `components/dashboard/InlineReviewCard.tsx` (Home's inline card). A grade
 * has to look the same wherever it is given, and — more to the point — a
 * pairing that fails contrast has to be fixable in ONE place.
 *
 * Both callers held their own copy of this switch. The copies had drifted on
 * exactly one chip: "Again" was `colors.error` on `colors.errorBackground` in
 * the session, which measures 4.23:1 in light and 4.45:1 in dark — both under
 * AA for the normal-size label it paints. The tokens say why: `error` is tuned
 * to read on the PAGE ground (it is the ring/border red), not on the pale red
 * fill, and there is no "ink on errorBackground" token. So the fill stays red —
 * that is the chip's identity, and the swipe gesture's colour — and the label
 * takes the page ink, which is what the neighbouring "Hard" chip already uses.
 *
 * `flashcardGradeSkinContrast.test.ts` gates all four pairs in both palettes.
 */
import type { FeatureAccentPair, FlashcardGradeId } from '@lantern/shared';

/** The palette fields the skin reads — a `ThemeColors` satisfies it, and so
 * does a bare shared `ThemePalette`, which is what the contrast gate hands it. */
export interface FlashcardGradeSkinPalette {
  text: string;
  surface: string;
  success: string;
  successBackground: string;
  errorBackground: string;
}

/** A chip's fill and the colour of the label drawn on it. */
export interface FlashcardGradeSkin {
  backgroundColor: string;
  color: string;
}

export function flashcardGradeSkin(
  rating: FlashcardGradeId,
  colors: FlashcardGradeSkinPalette,
  accent: FeatureAccentPair
): FlashcardGradeSkin {
  switch (rating) {
    case 'again':
      // Red fill, page ink — see the note above for why not `colors.error`.
      return { backgroundColor: colors.errorBackground, color: colors.text };
    case 'hard':
      return { backgroundColor: colors.surface, color: colors.text };
    case 'good':
      return { backgroundColor: colors.successBackground, color: colors.success };
    case 'easy':
      return { backgroundColor: accent.tint, color: accent.ink };
  }
}

export default flashcardGradeSkin;
