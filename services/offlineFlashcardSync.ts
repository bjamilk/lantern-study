import { mapFlashcardFromApi } from '@lantern/shared/utils';
import type { PendingFlashcardReview } from '@lantern/shared/utils/offlineReview';
import { reviewFlashcard } from './supabase';
import { useFlashcardStore } from '../stores/flashcardStore';
import { isVersionConflictError } from '@lantern/shared/api';

export interface FlashcardReviewSyncResult {
  synced: number;
  remaining: number;
  /** Entries permanently dropped this pass (deleted/inaccessible cards, retry cap). */
  dropped: number;
}

/** Drop an entry once this many sync attempts have been rejected by the server. */
const MAX_SYNC_ATTEMPTS = 5;

/**
 * Rejected-attempt counts per queue entry id. In-memory on purpose: network
 * failures (no HTTP status) never increment it, so being offline for a long
 * time — or reloading the page — can never age a valid grade out of the queue.
 */
const rejectedSyncAttempts = new Map<string, number>();

/**
 * Replay queued flashcard reviews to the API (FIFO).
 *
 * One bad entry no longer wedges the whole queue: reviews whose card is gone
 * or inaccessible (404/403) are dropped like 409-conflicts, entries the server
 * keeps rejecting are dropped after MAX_SYNC_ATTEMPTS, and other server
 * rejections skip to the next entry instead of aborting the pass. Only a
 * network-level failure (request never reached the server) stops the pass,
 * since every later entry would fail the same way.
 */
export async function syncPendingFlashcardReviews(): Promise<FlashcardReviewSyncResult> {
  const store = useFlashcardStore.getState();
  const { pendingFlashcardReviews } = store;
  if (pendingFlashcardReviews.length === 0) {
    return { synced: 0, remaining: 0, dropped: 0 };
  }

  const syncedIds: string[] = [];
  const droppedIds: string[] = [];

  const dropEntry = (review: PendingFlashcardReview, reason: string) => {
    console.warn(
      '[FlashcardReviewSync] Dropping queued review for',
      review.flashcardId,
      '—',
      reason
    );
    store.clearPendingLocalReview(review.flashcardId);
    rejectedSyncAttempts.delete(review.id);
    droppedIds.push(review.id);
  };

  for (const review of pendingFlashcardReviews) {
    try {
      // No CAS for queued replay: the local version snapshot goes stale as the
      // loop itself advances the server (each success bumps server version),
      // so the second queued review of a card self-409'd and was dropped.
      // Reviews are events — the server applies each on its current state.
      const updated = await reviewFlashcard(
        review.flashcardId,
        review.rating,
        undefined
      );
      const mapped = updated ? mapFlashcardFromApi(updated) : null;
      if (mapped?.srsData || mapped?.version != null) {
        store.clearPendingLocalReview(review.flashcardId);
        store.updateFlashcards(prev =>
          prev.map(fc =>
            fc.id === review.flashcardId
              ? {
                  ...fc,
                  ...(mapped.srsData ? { srsData: mapped.srsData } : {}),
                  ...(mapped.version != null ? { version: Number(mapped.version) } : {}),
                }
              : fc
          )
        );
      }
      rejectedSyncAttempts.delete(review.id);
      syncedIds.push(review.id);
    } catch (error) {
      if (isVersionConflictError(error)) {
        // Drop stale review; server already has a newer schedule.
        store.clearPendingLocalReview(review.flashcardId);
        rejectedSyncAttempts.delete(review.id);
        syncedIds.push(review.id);
        continue;
      }

      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status: number }).status
        : undefined;

      if (status === 404 || status === 403) {
        // The card was deleted or is no longer accessible — this entry can
        // never sync, so drop it instead of blocking everything behind it.
        dropEntry(review, `server rejected it with HTTP ${status}`);
        continue;
      }

      if (status === 401) {
        // Session expired: nothing in the queue can sync until re-auth, and
        // these are valid grades — keep them all and stop the pass.
        console.warn('[FlashcardReviewSync] Not authenticated — stopping this pass');
        break;
      }

      if (status != null) {
        // The server actively rejected this entry. Count the strike; give up
        // on the entry after MAX_SYNC_ATTEMPTS so it cannot clog the queue
        // forever, and keep syncing the rest either way.
        const attempts = (rejectedSyncAttempts.get(review.id) ?? 0) + 1;
        rejectedSyncAttempts.set(review.id, attempts);
        if (attempts >= MAX_SYNC_ATTEMPTS) {
          dropEntry(review, `rejected ${attempts} times (last HTTP ${status})`);
        } else {
          console.error(
            '[FlashcardReviewSync] Failed for',
            review.flashcardId,
            `(attempt ${attempts}/${MAX_SYNC_ATTEMPTS}, HTTP ${status})`,
            error
          );
        }
        continue;
      }

      // No HTTP status: the request never reached the server (offline, DNS,
      // aborted). Later entries would fail identically — retry next pass.
      console.error(
        '[FlashcardReviewSync] Network failure for',
        review.flashcardId,
        '— stopping this pass',
        error
      );
      break;
    }
  }

  const removableIds = [...syncedIds, ...droppedIds];
  if (removableIds.length > 0) {
    // Removing dropped ids here is what keeps pendingFlashcardReviewsCount
    // (OfflineModeScreen) honest — they are no longer "waiting to sync".
    store.removePendingReviews(removableIds);
  }

  const remaining = useFlashcardStore.getState().pendingFlashcardReviews.length;
  return { synced: syncedIds.length, remaining, dropped: droppedIds.length };
}
