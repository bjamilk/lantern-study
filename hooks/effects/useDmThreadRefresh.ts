/**
 * The one DM-thread refresher the rest of the app shares.
 *
 * Exports: useDmThreadRefresh() → refreshDmThreadsForUser(userId); and
 *  `mapFetchedDmThreads`, which the bootstrap fan-out maps its own response with
 *  so both paths shape a thread the same way.
 * Touches: fetchDmThreads + fetchDMUnreadCounts (services/supabase) and
 *  `updateDmThreads` on stores/groupStore.
 * Gotchas:
 *  - Threads and unread counts are fetched together, and a unread-count failure
 *    degrades to `{}` rather than failing the whole refresh.
 *  - The merge is SOFT: optimistic first-message threads survive it. The
 *    bootstrap's own merge is 'server', because a real empty inbox has to be
 *    able to clear stale threads.
 *  - This hook registers no effect. It is called where the callback was defined,
 *    and its consumers (the realtime channels, the manual refresh event) hold
 *    the returned function.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included.
 */
import { useCallback } from 'react';
import { useGroupStore } from '../../stores/groupStore';
import { fetchDmThreads, fetchDMUnreadCounts } from '../../services/supabase';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../../utils/dmThreads';

export function mapFetchedDmThreads(fetched: any[], dmUnreadCounts: Record<string, number>) {
    if (!Array.isArray(fetched)) return [];
    return fetched.map((t: any) => mapDmThreadFromApi(t, dmUnreadCounts));
}

export function useDmThreadRefresh() {
    const { updateDmThreads } = useGroupStore();

    // Shared DM-thread refresher used by the realtime handlers and the manual refresh event.
    // Threads and unread counts are fetched together; a unread-count failure degrades to {}
    // rather than failing the whole refresh.
    const refreshDmThreadsForUser = useCallback(async (userId: string) => {
        try {
            const [fetchedThreads, dmUnreadCounts] = await Promise.all([
                fetchDmThreads(userId),
                fetchDMUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
            ]);
            if (Array.isArray(fetchedThreads)) {
                const mapped = mapFetchedDmThreads(fetchedThreads, dmUnreadCounts);
                // Soft merge: keep optimistic first-message threads; never wipe on failure
                // (failures throw before we get here).
                updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'soft'));
            }
        } catch (err) {
            console.warn('[DM] Failed to refresh threads:', err);
        }
    }, [updateDmThreads]);

    return refreshDmThreadsForUser;
}
