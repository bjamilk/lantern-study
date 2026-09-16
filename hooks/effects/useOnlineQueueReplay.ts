/**
 * Replays the two offline queues when the browser comes back online.
 *
 * Exports: useOnlineQueueReplay({ currentUser }) → void.
 * Touches: services/offlineFlashcardSync and services/offlineTestSync, the auth
 *  store (gamification fold-back) and the toast store; reads `isOnline` from
 *  stores/uiStore and both queues from their stores.
 * Gotchas:
 *  - The queues are read through getState(), never a dependency: a queue that
 *    was just purged on an account switch must not be resurrected from the
 *    pre-purge render snapshot.
 *  - Queued review replays skip CAS inside syncPendingFlashcardReviews, because
 *    repeated reviews of one card all carry the same pre-sync version and would
 *    otherwise self-409.
 *  - The test-result toast reports `remaining` honestly rather than claiming a
 *    full sync.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import { syncPendingFlashcardReviews } from '../../services/offlineFlashcardSync';
import { syncPendingTestResults } from '../../services/offlineTestSync';

interface UseOnlineQueueReplayParams {
    currentUser: User | null;
}

export function useOnlineQueueReplay({ currentUser }: UseOnlineQueueReplayParams): void {
    const { isOnline } = useUIStore();

    // Auto-sync queued flashcard reviews when back online
    // Re-runs on currentUser.id / isOnline — the isOnline flip is the trigger; the queue
    // itself is read through getState() (never a dep) so a newly-purged queue is not
    // resurrected from a pre-purge render snapshot. Queued review replays skip CAS inside
    // syncPendingFlashcardReviews, because repeated reviews of one card all carry the same
    // pre-sync version and would self-409.
    useEffect(() => {
        if (!currentUser?.id || !isOnline) return;
        const pending = useFlashcardStore.getState().pendingFlashcardReviews;
        if (pending.length === 0) return;

        let cancelled = false;
        syncPendingFlashcardReviews()
            .then(({ synced }) => {
                if (!cancelled && synced > 0) {
                    console.log(`[FlashcardReviewSync] Auto-synced ${synced} review(s)`);
                }
            })
            .catch((error) => {
                console.error('[FlashcardReviewSync] Auto-sync error:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, isOnline]);

    // Auto-sync queued offline test results when back online
    // Same shape as the flashcard sync: triggered by isOnline, queue read via getState().
    // Reports `remaining` honestly rather than claiming a full sync, and folds back any
    // gamification the server returned. `cancelled` suppresses the toast after unmount.
    useEffect(() => {
        if (!currentUser?.id || !isOnline) return;
        const pending = useTestStore.getState().pendingSyncResults;
        if (pending.length === 0) return;

        let cancelled = false;
        syncPendingTestResults(currentUser.id)
            .then(({ synced, remaining, gamification }) => {
                if (cancelled || synced === 0) return;
                console.log(`[TestResultSync] Auto-synced ${synced} result(s)`);
                if (gamification) {
                    const user = useAuthStore.getState().currentUser;
                    if (user) {
                        useAuthStore.getState().setCurrentUser({
                            ...user,
                            points: gamification.points,
                            badges: gamification.badges,
                            stats: gamification.stats,
                        });
                    }
                }
                useToastStore.getState().showToast(
                    remaining === 0
                        ? `${synced} offline test result(s) synced.`
                        : `Synced ${synced} offline test result(s); ${remaining} still pending.`,
                    'success'
                );
            })
            .catch((error) => {
                console.error('[TestResultSync] Auto-sync error:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, isOnline]);
}
