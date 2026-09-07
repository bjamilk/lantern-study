export const MIN_FLASHCARD_COUNT = 10;
/**
 * Ceiling for one generation run. Raised from 20 to 30 with the options sheet:
 * a run costs one AI use whatever the count, and the server clamps to this same
 * range (`generateFlashcardsFromNotes`), so a sheet offering 30 gets 30.
 */
export const MAX_FLASHCARD_COUNT = 30;

/** Clamp flashcard generation count to the supported range (10–30). */
export function normalizeFlashcardCount(count?: number): number {
  const n = count ?? MIN_FLASHCARD_COUNT;
  return Math.min(MAX_FLASHCARD_COUNT, Math.max(MIN_FLASHCARD_COUNT, n));
}
