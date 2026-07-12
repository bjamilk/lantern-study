/**
 * Offline flashcard review helpers — local FSRS + sync queue types
 */

import type { SrsData } from '../types';
import type { StudySettings } from '../settings/userSettings';
import { getSrsMaxInterval } from '../settings/studySession';
import { calculateFsrsData } from './fsrs';
import type { PerformanceRating } from './srs';

export interface PendingFlashcardReview {
  id: string;
  flashcardId: string;
  deckId: string;
  rating: PerformanceRating;
  reviewedAt: string;
}

export function createPendingFlashcardReview(
  flashcardId: string,
  deckId: string,
  rating: PerformanceRating,
  id?: string
): PendingFlashcardReview {
  return {
    id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    flashcardId,
    deckId,
    rating,
    reviewedAt: new Date().toISOString(),
  };
}

/** Apply FSRS locally (matches server reviewFlashcard scheduling). */
export function applyLocalFlashcardReview<T extends { srsData?: SrsData }>(
  card: T,
  rating: PerformanceRating,
  study: Pick<StudySettings, 'srsMaxInterval'>
): T {
  const newSrsData = calculateFsrsData(card.srsData, rating, {
    maxInterval: getSrsMaxInterval(study),
  });
  return { ...card, srsData: newSrsData };
}
