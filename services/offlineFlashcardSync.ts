import { reviewFlashcard } from './supabase';
import { useFlashcardStore } from '../stores/flashcardStore';

export interface FlashcardReviewSyncResult {
  synced: number;
  remaining: number;
}

/** Replay queued flashcard reviews to the API (FIFO). Stops on first failure. */
export async function syncPendingFlashcardReviews(): Promise<FlashcardReviewSyncResult> {
  const store = useFlashcardStore.getState();
  const { pendingFlashcardReviews } = store;
  if (pendingFlashcardReviews.length === 0) {
    return { synced: 0, remaining: 0 };
  }

  const syncedIds: string[] = [];

  for (const review of pendingFlashcardReviews) {
    try {
      const updated = await reviewFlashcard(review.flashcardId, review.rating);
      const newSrsData = updated?.srs_data ?? updated?.srsData;
      if (newSrsData) {
        store.updateFlashcards(prev =>
          prev.map(fc => (fc.id === review.flashcardId ? { ...fc, srsData: newSrsData } : fc))
        );
      }
      syncedIds.push(review.id);
    } catch (error) {
      console.error('[FlashcardReviewSync] Failed for', review.flashcardId, error);
      break;
    }
  }

  if (syncedIds.length > 0) {
    store.removePendingReviews(syncedIds);
  }

  const remaining = useFlashcardStore.getState().pendingFlashcardReviews.length;
  return { synced: syncedIds.length, remaining };
}
