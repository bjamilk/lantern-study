/**
 * Plain-language flashcard copy shared by web and mobile.
 * Internal mode ids / session logic stay unchanged — only user-facing labels live here.
 */

export type FlashcardStudyModeId =
  | 'smart_review'
  | 'quiz'
  | 'match'
  | 'speed_run'
  | 'timed_drill';

export const FLASHCARD_MODE_LABELS: Record<
  FlashcardStudyModeId,
  { label: string; subtitle: string }
> = {
  smart_review: {
    label: 'Smart review',
    subtitle: 'We show the cards you are about to forget',
  },
  quiz: {
    label: 'Quiz yourself',
    subtitle: 'Multiple-choice practice',
  },
  match: {
    label: 'Match game',
    subtitle: 'Pair terms quickly',
  },
  speed_run: {
    label: 'Speed run',
    subtitle: 'Go through every card once',
  },
  timed_drill: {
    label: 'Timed drill',
    subtitle: 'Beat the clock',
  },
};

export const FLASHCARD_STAT_LABELS = {
  notStarted: 'Not started',
  readyToReview: 'Ready to review',
  total: 'Total',
  avgDifficulty: 'Avg difficulty',
  trickyCards: 'Tricky cards',
  mastered: 'Mastered',
  learning: 'Learning',
} as const;

export type FlashcardGradeId = 'again' | 'hard' | 'good' | 'easy';

export const FLASHCARD_GRADE_LABELS: Record<
  FlashcardGradeId,
  { label: string; meaning: string }
> = {
  again: { label: 'Again', meaning: "didn't know" },
  hard: { label: 'Hard', meaning: 'barely' },
  good: { label: 'Good', meaning: 'got it' },
  easy: { label: 'Easy', meaning: 'too easy' },
};

/** Card list status badge labels (replaces New / Due / Learning / Mastered jargon where needed). */
export const FLASHCARD_CARD_STATUS_LABELS = {
  new: FLASHCARD_STAT_LABELS.notStarted,
  due: FLASHCARD_STAT_LABELS.readyToReview,
  learning: FLASHCARD_STAT_LABELS.learning,
  mastered: FLASHCARD_STAT_LABELS.mastered,
} as const;

/**
 * Primary CTA for studying a deck or all due cards.
 * - dueCount > 0 → "Study N cards"
 * - totalCards > 0, nothing due → "Start studying"
 * - empty deck → "Add cards first"
 */
export function getStudyCtaLabel(dueCount: number, totalCards: number): string {
  if (totalCards <= 0) return 'Add cards first';
  if (dueCount > 0) {
    return dueCount === 1 ? 'Study 1 card' : `Study ${dueCount} cards`;
  }
  return 'Start studying';
}

/** Header CTA when reviewing across all decks. */
export function getStudyAllDueLabel(dueCount: number): string {
  if (dueCount <= 0) return 'Study';
  return dueCount === 1 ? 'Study 1 due card' : `Study all ${dueCount} due`;
}

export function getDeckListStatsLine(readyCount: number, totalCards: number): string {
  const ready =
    readyCount <= 0
      ? 'Nothing ready'
      : readyCount === 1
        ? '1 ready to review'
        : `${readyCount} ready to review`;
  const cards = totalCards === 1 ? '1 card' : `${totalCards} cards`;
  return `${ready} · ${cards}`;
}
