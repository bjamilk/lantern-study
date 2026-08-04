import type { Flashcard } from '@lantern/shared';
import { FLASHCARD_CARD_STATUS_LABELS, isCardDue } from '@lantern/shared';

export interface DeckCardStats {
  total: number;
  newCards: number;
  dueCards: number;
  mastered: number;
  /**
   * Cards the SRS has flagged as leeches — repeatedly failed. Web surfaces this
   * on the deck page and mobile did not, so a deck could be full of cards you
   * keep forgetting with nothing on the screen saying so.
   */
  trickyCards: number;
}

export function getDeckCardStats(
  deckId: string,
  flashcardsByDeck: Record<string, Flashcard[]>
): DeckCardStats {
  const cards = flashcardsByDeck[deckId] || [];
  const newCards = cards.filter(card => !card.srsData?.repetitions).length;
  // Due = whatever the shared predicate says, with no extra conditions. This
  // previously also required repetitions > 0, which made a card scheduled with a
  // past nextReviewDate but never reviewed count as due on web and not on mobile
  // — the source of the dashboard showing e.g. 38 due on web and 37 on mobile.
  // isCardDue already handles the no-date case by requiring repetitions > 0.
  const dueCards = cards.filter(card => isCardDue(card.srsData)).length;
  const mastered = cards.filter(card => (card.srsData?.repetitions || 0) >= 5).length;
  const trickyCards = cards.filter(card => card.srsData?.isLeech).length;

  return {
    total: cards.length,
    newCards,
    dueCards,
    mastered,
    trickyCards,
  };
}

export function groupFlashcardsByDeck(cards: Flashcard[]): Record<string, Flashcard[]> {
  return cards.reduce<Record<string, Flashcard[]>>((acc, card) => {
    const deckId = card.deckId;
    if (!deckId) return acc;
    if (!acc[deckId]) acc[deckId] = [];
    acc[deckId].push(card);
    return acc;
  }, {});
}

export function getCardDisplayText(card: Flashcard): { front: string; back: string } {
  if (card.type === 'CLOZE' && card.clozeText) {
    const front = card.clozeText.replace(/\{\{c\d+::([^}]+)\}\}/g, '[...]');
    const back = card.clozeText.replace(/\{\{c\d+::([^}]+)\}\}/g, '$1');
    return { front, back };
  }

  const front = card.front?.trim() || '';
  const back = card.back?.trim() || '';

  return {
    front: front || back || '(No question text)',
    back: back || '',
  };
}

export function getCardStatus(card: Flashcard): { label: string; color: string } {
  const isMastered = (card.srsData?.repetitions || 0) >= 5;
  if (isMastered) return { label: FLASHCARD_CARD_STATUS_LABELS.mastered, color: '#10b981' };
  if (!card.srsData?.repetitions) return { label: FLASHCARD_CARD_STATUS_LABELS.new, color: '#6366f1' };
  if (isCardDue(card.srsData)) return { label: FLASHCARD_CARD_STATUS_LABELS.due, color: '#f97316' };
  return { label: FLASHCARD_CARD_STATUS_LABELS.learning, color: '#8b5cf6' };
}
