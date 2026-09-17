/**
 * The account half of the Home checklist's "has ever opened" flags.
 *
 * Exports: `recordSurfaceVisit` (the one call a routed landing makes),
 *  `syncOnboardingVisitedFromSettings` (the sign-in merge) and
 *  `onboardingVisitedPatch` (the settings patch both of them send).
 * Touches: `useUIStore.visitedSurfaces` (the offline-first cache) and
 *  `saveUserSettingsDetailed` (a `onboardingVisited`-only settings patch, the
 *  same shape `featureTipStore` sends for `featureTips`). It writes the merged
 *  copy back into `useAuthStore.currentUser.settings` so the profile in memory
 *  matches what was sent.
 *
 * Why it is here and not in `stores/uiStore.ts`: that store is pure and does
 * no network, and its contract test imports it directly. The network lives on
 * this side of the line.
 *
 * Gotchas:
 *  - MONOTONIC in both directions. The patch carries ONLY the flags that are
 *    true, so no queue merge, retry or stale tab can send a `false` that
 *    un-ticks a surface; the server ORs on top of that
 *    (`applySettingsPatch`). `mergeVisitedSurfaces` ORs on the way in.
 *  - Navigation NEVER waits for the write. `recordSurfaceVisit` updates the
 *    local cache synchronously and fires the save off; a failure is logged,
 *    not toasted — a student mid-navigation has nothing to do about it, and
 *    the flag is already true locally and will be re-sent on the next visit
 *    to a surface they have not yet recorded.
 *  - The flags are recorded per user id, so signing out (which does not clear
 *    the cache) and signing in as somebody else cannot tick their checklist:
 *    the second account reads its own key, which is empty until its own
 *    profile arrives.
 */
import {
    mergeOnboardingVisited,
    normalizeOnboardingVisited,
    normalizeUserSettings,
} from '@lantern/shared/settings';
import type { AppMode } from '../types';
import { saveUserSettingsDetailed } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { VISITED_SURFACES, useUIStore, type VisitedSurface } from '../stores/uiStore';

type VisitedFlags = Partial<Record<VisitedSurface, boolean>>;

/** This device's flags for one account, straight out of the cache. */
function localFlags(userId: string): VisitedFlags {
    return useUIStore.getState().visitedSurfaces[userId] ?? {};
}

/**
 * The patch to send: the true flags only, never a false one. That is what
 * makes every layer between here and the row monotonic without any of them
 * having to know it.
 */
export function onboardingVisitedPatch(flags: VisitedFlags): Record<string, boolean> {
    const patch: Record<string, boolean> = {};
    for (const surface of VISITED_SURFACES) {
        if (flags[surface] === true) patch[surface] = true;
    }
    return patch;
}

/** Fire-and-forget the patch, and keep the in-memory profile in step. */
function pushVisited(userId: string, flags: VisitedFlags): void {
    const patch = onboardingVisitedPatch(flags);
    if (Object.keys(patch).length === 0) return;

    const user = useAuthStore.getState().currentUser;
    if (user?.id === userId) {
        const current = normalizeUserSettings(user.settings);
        useAuthStore.getState().setCurrentUser({
            ...user,
            settings: {
                ...current,
                onboardingVisited: mergeOnboardingVisited(current.onboardingVisited, patch),
                updatedAt: new Date().toISOString(),
            },
        });
    }

    // Category patch only — the server deep-merges, so a concurrent theme or
    // study save is not clobbered by this one.
    void saveUserSettingsDetailed(userId, { onboardingVisited: patch }).then((result) => {
        if (!result.ok) {
            // Not surfaced: the local flag is already set, the checklist is
            // already right on this device, and the next unrecorded visit
            // re-sends. Nothing for the student to act on.
            console.warn('Failed to sync onboarding checklist progress');
        }
    });
}

/**
 * Record that this student has landed on a checklist surface.
 *
 * Local first, then the account — and only on the FIRST visit: once the flag
 * is set, `markSurfaceVisited` reports no change and nothing is sent, so
 * walking in and out of the Library all day costs one write.
 */
export function recordSurfaceVisit(
    userId: string | null | undefined,
    mode: AppMode
): void {
    if (!userId) return;
    const changed = useUIStore.getState().markSurfaceVisited(userId, mode);
    if (!changed) return;
    pushVisited(userId, localFlags(userId));
}

/**
 * Merge the account's stored flags into this device on sign-in.
 *
 * OR in both directions: the profile's flags are added to the cache, and if
 * this device knows a surface the profile has not got — a write that failed,
 * or a visit made before this shipped — it is pushed back up. Without that
 * self-heal the first localStorage wipe would lose it for good.
 */
export function syncOnboardingVisitedFromSettings(
    userId: string | null | undefined,
    rawSettings: unknown
): void {
    if (!userId) return;
    const remote = normalizeOnboardingVisited(
        normalizeUserSettings(rawSettings).onboardingVisited
    );
    useUIStore.getState().mergeVisitedSurfaces(userId, remote);

    const local = localFlags(userId);
    const missingOnProfile = VISITED_SURFACES.some(
        (surface) => local[surface] === true && remote[surface] !== true
    );
    if (missingOnProfile) pushVisited(userId, local);
}
