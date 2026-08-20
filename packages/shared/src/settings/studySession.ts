import type { SrsData } from '../types';
import type { StudyActivityDay } from '../types';
import type { StudySettings } from './userSettings';
import { formatActivityLocalDate } from '../utils/activity';
import { getCardsDue, isCardDue, sortCardsByDueDate } from '../utils/srs';

export interface FlashcardLike {
  id: string;
  srsData?: SrsData;
}

export function isNewFlashcard(card: FlashcardLike): boolean {
  // repetitions alone cannot distinguish "never reviewed" from "lapsed":
  // grading Again resets repetitions to 0, but every reviewed card carries a
  // nextReviewDate. Treating a lapsed card as new let daily new-card caps
  // silently drop it from the review queue.
  return !card.srsData?.repetitions && !card.srsData?.nextReviewDate;
}

export interface TodayStudyCounts {
  flashcards: number;
  tests: number;
  newFlashcards: number;
}

export function getTodayStudyCounts(activityDays: StudyActivityDay[]): TodayStudyCounts {
  const today = formatActivityLocalDate(new Date());
  const row = activityDays.find((d) => d.date === today);
  const breakdown = row?.breakdown ?? {};
  return {
    flashcards: breakdown.flashcard ?? 0,
    tests: breakdown.test ?? 0,
    newFlashcards: breakdown.flashcard_new ?? 0,
  };
}

export interface BuildReviewQueueOptions {
  srsNewCardsPerDay: number;
  /** From synced study_activity for today */
  newCardsIntroducedToday?: number;
}

/** Build an SRS review queue respecting new-card caps (daily goal is progress-only). */
export function buildFlashcardReviewQueue<T extends FlashcardLike>(
  cards: T[],
  options: BuildReviewQueueOptions
): T[] {
  const due = sortCardsByDueDate(
    getCardsDue(cards).filter((c) => !isNewFlashcard(c))
  );
  const newCards = cards.filter(isNewFlashcard);
  const newIntroducedToday = options.newCardsIntroducedToday ?? 0;
  const newLimit = Math.max(0, options.srsNewCardsPerDay - newIntroducedToday);
  const newSlice = newCards.slice(0, newLimit);

  return [...due, ...newSlice];
}

/** Cards still due for review (any deck). */
export function countReviewableCards<T extends FlashcardLike>(
  cards: T[],
  options: BuildReviewQueueOptions
): number {
  return buildFlashcardReviewQueue(cards, options).length;
}

export function capSrsInterval(interval: number, maxInterval: number): number {
  const max = Math.max(1, maxInterval);
  return Math.max(1, Math.min(interval, max));
}

export function getSrsMaxInterval(study: Pick<StudySettings, 'srsMaxInterval'>): number {
  return Math.max(1, study.srsMaxInterval || 365);
}

export function isCardDueForReview(card: FlashcardLike): boolean {
  if (isNewFlashcard(card)) return true;
  return isCardDue(card.srsData);
}
