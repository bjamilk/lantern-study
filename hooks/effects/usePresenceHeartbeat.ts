/**
 * Beats the presence heartbeat that drives "online now" for other students.
 *
 * Exports: usePresenceHeartbeat({ currentUser, authTokenReady }) → void.
 * Touches: services/presenceHeartbeat (POST /users/presence/heartbeat) on a
 *  two-minute interval.
 * Gotchas:
 *  - Gated on `authTokenReady`, not just `currentUser` — the same gate the
 *    lifecycle, paused-session and gamification paths use — so guest and
 *    stale-session landings never POST the endpoint at all.
 *  - `currentUser.settings` is a dependency on purpose: that is what makes
 *    toggling "show online status" start or stop the interval immediately.
 *  - The interval self-cancels on an unrecovered 401/403, so a dead session
 *    stops beating instead of spamming Unauthorized.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effect registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import type { User } from '../../types';
import { normalizeUserSettings } from '@lantern/shared/settings';
import {
    sendPresenceHeartbeat,
    shouldRunPresenceHeartbeat,
} from '../../services/presenceHeartbeat';

interface UsePresenceHeartbeatParams {
    currentUser: User | null;
    authTokenReady: boolean;
}

export function usePresenceHeartbeat({
    currentUser,
    authTokenReady,
}: UsePresenceHeartbeatParams): void {
    // --- Presence heartbeat for online status ---
    // Gate on authTokenReady (same as lifecycle / paused sessions / gamification)
    // so guest + stale-session landings never POST /presence/heartbeat.
    // Re-runs on currentUser.id / currentUser.settings / authTokenReady: the settings dep is
    // what makes toggling "show online status" start or stop the 2-minute interval. The
    // interval self-cancels on an unrecovered 401/403 so a dead session stops beating.
    useEffect(() => {
        const showOnlineStatus = currentUser
            ? normalizeUserSettings(currentUser.settings).privacy.showOnlineStatus
            : false;
        if (!shouldRunPresenceHeartbeat({
            userId: currentUser?.id,
            authTokenReady,
            showOnlineStatus,
        })) {
            return;
        }
        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | undefined;

        const beat = async () => {
            if (cancelled) return;
            const keepGoing = await sendPresenceHeartbeat();
            // Unrecovered 401/403 or missing token — stop spamming Unauthorized.
            if (!keepGoing && interval) {
                clearInterval(interval);
                interval = undefined;
            }
        };

        void beat();
        interval = setInterval(() => void beat(), 2 * 60 * 1000);
        return () => {
            cancelled = true;
            if (interval) clearInterval(interval);
        };
    }, [currentUser?.id, currentUser?.settings, authTokenReady]);
}
