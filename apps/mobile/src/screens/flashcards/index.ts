/**
 * Barrel for the flashcards screens: the deck list, one deck, FSRS review, and
 * the three study modes (cram, match, learn).
 *
 * Each screen is exported twice — named and as `*Default` — because the
 * navigator and the tests import them differently. Adding a screen here is not
 * enough to reach it; it also has to be registered in the navigator.
 */
export { FlashcardsScreen, default as FlashcardsScreenDefault } from './FlashcardsScreen';
export { DeckDetailScreen, default as DeckDetailScreenDefault } from './DeckDetailScreen';
export { FlashcardReviewScreen, default as FlashcardReviewScreenDefault } from './FlashcardReviewScreen';
export { CramSessionScreen, default as CramSessionScreenDefault } from './CramSessionScreen';
export { MatchStudyScreen, default as MatchStudyScreenDefault } from './MatchStudyScreen';
export { LearnStudyScreen, default as LearnStudyScreenDefault } from './LearnStudyScreen';
