import type { Flashcard } from '@lantern/shared';
import { isCardDue } from '@lantern/shared';

export interface DeckCardStats {
  total: number;
  newCards: number;
  dueCards: number;
  mastered: number;
}

export function getDeckCardStats(
  deckId: string,
  flashcardsByDeck: Record<string, Flashcard[]>
): DeckCardStats {
  const cards = flashcardsByDeck[deckId] || [];
  const newCards = cards.filter(card => !card.srsData?.repetitions).length;
  const dueCards = cards.filter(card => isCardDue(card.srsData)).length;
  const mastered = cards.filter(card => (card.srsData?.repetitions || 0) >= 5).length;

  return {
    total: cards.length,
    newCards,
    dueCards,
    mastered,
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
  if (isMastered) return { label: 'Mastered', color: '#10b981' };
  if (isCardDue(card.srsData)) return { label: 'Due', color: '#f97316' };
  if (!card.srsData?.repetitions) return { label: 'New', color: '#6366f1' };
  return { label: 'Learning', color: '#8b5cf6' };
}
