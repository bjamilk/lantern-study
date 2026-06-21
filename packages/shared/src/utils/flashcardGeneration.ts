export const MIN_FLASHCARD_COUNT = 10;
export const MAX_FLASHCARD_COUNT = 20;

/** Clamp flashcard generation count to the supported range (10–20). */
export function normalizeFlashcardCount(count?: number): number {
  const n = count ?? MIN_FLASHCARD_COUNT;
  return Math.min(MAX_FLASHCARD_COUNT, Math.max(MIN_FLASHCARD_COUNT, n));
}
