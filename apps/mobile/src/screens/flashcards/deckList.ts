/**
 * Re-export of the shared Flashcards list helpers. The phone used to own this
 * file; web and mobile now read the same titles and study-first order.
 */
export {
  cleanDeckTitle,
  deckDisplaySubtitle,
  deckDisplayTitle,
  isEmptyGeneratedDeck,
  isGeneratedFromNoteDeck,
  sortDecksForList,
  type DeckListItem,
} from '@lantern/shared/flashcards';
