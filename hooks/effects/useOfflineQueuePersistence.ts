/**
 * Persists the two offline stores that outlive a reload.
 *
 * Exports: useOfflineQueuePersistence({ currentUser }) → void.
 * Touches: the localStorage keys 'offlineBundles' and 'pendingSyncResults', and
 *  savePendingSyncResult (services/supabase) for the opportunistic cloud backup;
 *  reads stores/testStore and services/offlineQueueOwner.
 * Gotcha: both effects read the LIVE store through getState(), never the render
 *  snapshot their deps carry. On the commit where `currentUser` flips to another
 *  account the snapshot is still the PREVIOUS student's array, and writing it
 *  back resurrects exactly what the cross-account purge just deleted.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import type { User } from '../../types';
import { useTestStore } from '../../stores/testStore';
import { savePendingSyncResult } from '../../services/supabase';
import { isOfflineQueueOwner } from '../../services/offlineQueueOwner';

interface UseOfflineQueuePersistenceParams {
    currentUser: User | null;
}

export function useOfflineQueuePersistence({
    currentUser,
}: UseOfflineQueuePersistenceParams): void {
    const { offlineBundles, pendingSyncResults } = useTestStore();

    // --- Persist offline data ---
    // Mirrors the downloaded offline bundles to localStorage on every change so they survive
    // a reload with no network. Re-runs on the offlineBundles array identity.
    // FIXED (F9): the 'offlineBundles' key is not user-scoped, and this effect
    // had no user gate, so signing out and straight back in as someone else
    // handed the next account the previous student's downloaded bundles (the
    // store is read from this key at construction and again by
    // `initFromStorage`). Two halves close it: `useTestStore.reset()` — which
    // the sign-out registry calls — now REMOVES this key, and the write below
    // is gated on there being a signed-in user, so a reset that lands in the
    // same commit as the account switch cannot be written straight back.
    // Unlike `pendingSyncResults` below, a bundle is re-downloadable content
    // and not unsynced student work, so clearing it destroys nothing (F2's
    // never-purge rule is about the queues, and it still holds for them).
    // The live store is read for the same reason the queue effect below reads
    // it: the render snapshot still holds the previous account's array on the
    // commit where `currentUser` flips.
    useEffect(() => {
        if (!currentUser) return;
        localStorage.setItem(
            'offlineBundles',
            JSON.stringify(useTestStore.getState().offlineBundles)
        );
    }, [offlineBundles, currentUser]);

    // Persists the offline test-result queue and opportunistically backs it up to the cloud.
    // Deps are [pendingSyncResults, currentUser] — those only SCHEDULE the run; the data
    // itself is read from the live store, for the reason spelled out below.
    useEffect(() => {
        // Read the LIVE store, never the render snapshot: on the commit where
        // currentUser flips to a new user, this effect's closure still held
        // the previous user's queue and re-uploaded it under the new user id
        // — resurrecting exactly what the cross-account purge above deleted.
        // The owner-stamp gate closes the same hole for the cloud upload.
        const live = useTestStore.getState().pendingSyncResults;
        localStorage.setItem('pendingSyncResults', JSON.stringify(live));
        if (currentUser && live.length > 0 && isOfflineQueueOwner(currentUser.id)) {
            live.forEach(result => {
                savePendingSyncResult(currentUser.id, {
                    id: result.id,
                    resultData: result,
                    createdAt: new Date().toISOString(),
                    synced: false
                }).catch(error => {
                    console.error('[Pending Results Sync] Failed to save to cloud:', error);
                });
            });
        }
    }, [pendingSyncResults, currentUser]);
}
