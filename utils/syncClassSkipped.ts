/**
 * The account half of "Skip for now" on the Sync-with-your-class card.
 *
 * Exports: `recordSyncClassSkip` (the one call the card makes) and
 *  `syncClassSkippedFromSettings` (the sign-in merge).
 * Touches: `useUIStore.syncClassSkipped` (the offline-first cache, still
 *  keyed per user id) and `saveUserSettingsDetailed` with a
 *  `syncClassSkipped`-only patch — the same shape `onboardingVisited.ts` next
 *  door sends, for the same reason.
 *
 * WHY: the flag was per DEVICE on both clients and shared nothing (#142). A
 * student who said "I have no syllabus for this set" on the laptop was asked
 * again on the phone, and again on the next laptop. It is a DECISION about a
 * set, so it belongs to the account.
 *
 * Why it is here and not in `stores/uiStore.ts`: that store is pure and does
 * no network, and its contract test imports it directly. The network lives on
 * this side of the line.
 *
 * Gotchas:
 *  - MONOTONIC. The patch only ever carries set ids that ARE skipped, and
 *    `applySettingsPatch` unions on top of what is stored, so no stale tab,
 *    queue merge or retry can un-hide a card. Nothing un-skips a set.
 *  - The card NEVER waits for the write: the local cache is updated
 *    synchronously, the card is already gone, and a failure is logged rather
 *    than toasted — there is nothing a student could do about it, and the next
 *    sign-in self-heals from the cache.
 *  - The account map is BOUNDED (`SYNC_CLASS_SKIPPED_CAP`, oldest dropped), so
 *    a student with hundreds of sets may be asked once more on a set they last
 *    touched long ago. The local cache is not pruned with it; the merge is a
 *    union, so the device keeps knowing what the account has forgotten.
 */
import {
  mergeSyncClassSkipped,
  normalizeSyncClassSkipped,
  normalizeUserSettings,
} from '@lantern/shared/settings';
import { saveUserSettingsDetailed } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';

/** This device's skipped sets for one account, straight out of the cache. */
function localSkips(userId: string): Record<string, boolean> {
    return useUIStore.getState().syncClassSkipped[userId] ?? {};
}

/**
 * The patch to send: skipped set ids stamped with a time, and nothing else.
 * `false` is never sent, which is what makes every layer below monotonic
 * without any of them having to know it.
 */
export function syncClassSkippedPatch(
    skips: Record<string, boolean>,
    at: number = Date.now()
): Record<string, number> {
    const patch: Record<string, number> = {};
    for (const [setId, skipped] of Object.entries(skips)) {
        if (skipped === true) patch[setId] = at;
    }
    return normalizeSyncClassSkipped(patch);
}

/** Fire-and-forget the patch, and keep the in-memory profile in step. */
function pushSkips(userId: string, patch: Record<string, number>): void {
    if (Object.keys(patch).length === 0) return;

    const user = useAuthStore.getState().currentUser;
    if (user?.id === userId) {
        const current = normalizeUserSettings(user.settings);
        useAuthStore.getState().setCurrentUser({
            ...user,
            settings: {
                ...current,
                syncClassSkipped: mergeSyncClassSkipped(current.syncClassSkipped, patch),
                updatedAt: new Date().toISOString(),
            },
        });
    }

    // Category patch only — the server deep-merges, so a concurrent theme or
    // study save is not clobbered by this one.
    void saveUserSettingsDetailed(userId, { syncClassSkipped: patch }).then((result) => {
        if (!result.ok) {
            // Not surfaced: the card is already gone on this device, and the
            // next sign-in re-sends what the profile is missing.
            console.warn('Failed to sync a skipped Sync-with-your-class card');
        }
    });
}

/**
 * Record that this student has dismissed the card for one set.
 *
 * Local first, then the account — and only on the FIRST tap: once the flag is
 * set, `markSyncClassSkipped` reports no change and nothing is sent.
 */
export function recordSyncClassSkip(
    userId: string | null | undefined,
    studySetId: string | null | undefined
): void {
    if (!userId || !studySetId) return;
    const changed = useUIStore.getState().markSyncClassSkipped(userId, studySetId);
    if (!changed) return;
    pushSkips(userId, syncClassSkippedPatch({ [studySetId]: true }));
}

/**
 * Merge the account's stored skips into this device on sign-in.
 *
 * Both ways, like the checklist flags next door: the profile's set ids are
 * added to the cache, and any this device knows that the profile does not — a
 * write that failed, a skip made before this shipped, or one the account's cap
 * dropped — is pushed back up.
 */
export function syncClassSkippedFromSettings(
    userId: string | null | undefined,
    rawSettings: unknown
): void {
    if (!userId) return;
    const remote = normalizeSyncClassSkipped(
        normalizeUserSettings(rawSettings).syncClassSkipped
    );
    useUIStore.getState().mergeSyncClassSkipped(userId, Object.keys(remote));

    const local = localSkips(userId);
    const missingOnProfile = Object.entries(local)
        .filter(([setId, skipped]) => skipped === true && remote[setId] === undefined)
        .map(([setId]) => setId);
    if (missingOnProfile.length > 0) {
        pushSkips(
            userId,
            syncClassSkippedPatch(Object.fromEntries(missingOnProfile.map((id) => [id, true])))
        );
    }
}
