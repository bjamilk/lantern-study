/**
 * The web app's effect composer: every long-lived side effect App.tsx needs,
 * called in one place, in one order.
 *
 * This file used to BE all of them — 29 `useEffect`s in a single 2,400-line
 * function. Each concern now lives in its own module under `hooks/effects/`,
 * moved body-for-body with its comments, and what remains here is the order
 * they run in. That order is the behaviour this file owns: React runs effects
 * in registration order, and several of these depend on it (the cross-account
 * queue purge has to land before anything persists or replays a queue; every
 * Realtime channel has to be created after the token-ready promotion).
 *
 * Exports: useAppEffects({ dataLoaded, setDataLoaded, bootstrapLoad, setBootstrapLoad,
 *  onChallengeNotification }) → { refreshDashboardGamification, dailyQuests, serverStreak,
 *  streakFreezes, questsLoaded, authTokenReady }.
 * Touches: nothing directly any more, beyond the auth store and the
 *  `authTokenReady` gate below. Each hook's own banner says what it touches.
 *
 * Gotchas:
 *  - `authTokenReady` is owned HERE rather than inside `useAuthRestore`, because
 *    the presence heartbeat reads it and registers its effect BEFORE the restore
 *    effects do. State has no registration order; effects do.
 *  - Do not reorder the calls below to make the file read more tidily. Two tests
 *    fail if you do: `apps/web/src/useAppEffects.surface.test.ts` (reads the
 *    order out of the source) and `hooks/effects/appEffectsOrder.test.ts`
 *    (renders the composer and reads the order out of the registrations).
 *  - `useDailyStudyReminder` is called before the gamification hook for the same
 *    reason: that is the order those two registered their effects in.
 *
 * Reading order for the modules, which is also the order they run:
 *  useDailyStudyReminder → useGamificationRefresh → useDmThreadRefresh (no
 *  effects; it provides the shared refresher) → usePresenceHeartbeat →
 *  useAuthRestore → useAccountLifecycle → useBootstrapFanout →
 *  useRealtimeSubscriptions → useOfflineQueuePersistence → useThemeDomSync →
 *  useDeepLinkConsumption → useSrsReminders → useOnlineQueueReplay.
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useAuthStore } from '../stores/authStore';
import { bootstrapAuthFromStorage, getStoredSessionExpiresAt } from '../services/supabase';
import { isAccessTokenFreshEnough } from '../utils/authBootstrap';
import { type BootstrapLoadState } from './useAuthHandlers';
import { useDailyStudyReminder } from './useDailyStudyReminder';
import { useGamificationRefresh } from './effects/useGamificationRefresh';
import { useDmThreadRefresh } from './effects/useDmThreadRefresh';
import { usePresenceHeartbeat } from './effects/usePresenceHeartbeat';
import { useAuthRestore } from './effects/useAuthRestore';
import { useAccountLifecycle } from './effects/useAccountLifecycle';
import { useBootstrapFanout } from './effects/useBootstrapFanout';
import { useRealtimeSubscriptions } from './effects/useRealtimeSubscriptions';
import { useOfflineQueuePersistence } from './effects/useOfflineQueuePersistence';
import { useThemeDomSync } from './effects/useThemeDomSync';
import { useDeepLinkConsumption } from './effects/useDeepLinkConsumption';
import { useSrsReminders } from './effects/useSrsReminders';
import { useOnlineQueueReplay } from './effects/useOnlineQueueReplay';

interface UseAppEffectsParams {
    dataLoaded: boolean;
    setDataLoaded: (v: boolean) => void;
    bootstrapLoad: BootstrapLoadState;
    setBootstrapLoad: Dispatch<SetStateAction<BootstrapLoadState>>;
    onChallengeNotification?: (type: string, challengeId: string) => void;
}

export function useAppEffects({
    dataLoaded,
    setDataLoaded,
    bootstrapLoad,
    setBootstrapLoad,
    onChallengeNotification,
}: UseAppEffectsParams) {
    const { currentUser, setCurrentUser, setAuthLoading, isAuthLoading, setPasswordRecovery } = useAuthStore();
    // Only treat cold-start as token-ready when the stored access token is still fresh.
    // Expired local JWTs must wait for resolve/refresh before authenticated fan-out.
    const [authTokenReady, setAuthTokenReady] = useState(() => {
        const boot = bootstrapAuthFromStorage();
        return Boolean(boot && isAccessTokenFreshEnough(getStoredSessionExpiresAt()));
    });

    useDailyStudyReminder(currentUser);

    // --- Dashboard gamification: quests, streak, freezes, heatmap ---
    const {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
    } = useGamificationRefresh({ setCurrentUser });

    // --- The shared DM-thread refresher (realtime handlers + the manual refresh event) ---
    const refreshDmThreadsForUser = useDmThreadRefresh();

    // --- Presence heartbeat for online status ---
    usePresenceHeartbeat({ currentUser, authTokenReady });

    // --- Session restore, the auth-state handler, and token-ready promotion ---
    useAuthRestore({
        currentUser,
        isAuthLoading,
        authTokenReady,
        setAuthTokenReady,
        setCurrentUser,
        setAuthLoading,
        setPasswordRecovery,
        setDataLoaded,
        setBootstrapLoad,
    });

    // --- Account lifecycle: queue purge, appearance, settings sync, profile setup ---
    // Stays ahead of the persist/replay hooks below: the purge has to land before
    // anything observes the queue.
    useAccountLifecycle({ currentUser, authTokenReady, setCurrentUser });

    // --- The signed-in bootstrap fan-out, and the budget-extras write-back ---
    useBootstrapFanout({
        currentUser,
        authTokenReady,
        isAuthLoading,
        dataLoaded,
        setDataLoaded,
        setBootstrapLoad,
        refreshDashboardGamification,
    });

    // --- Realtime: notifications, DMs, group messages, notes, profile, membership ---
    useRealtimeSubscriptions({
        currentUser,
        authTokenReady,
        refreshDmThreadsForUser,
        onChallengeNotification,
    });

    // --- Persist offline data + the offline test-result queue ---
    useOfflineQueuePersistence({ currentUser });

    // --- Theme sync to DOM (signed-out visitors always see light — landing & auth) ---
    useThemeDomSync({ currentUser });

    // --- Deep-link entry: an OS / service-worker notification click ---
    useDeepLinkConsumption();

    // --- SRS Notifications: the due-cards badge and the reminder scheduler ---
    useSrsReminders({ currentUser });

    // --- Replay both offline queues when the browser comes back online ---
    useOnlineQueueReplay({ currentUser });

    return {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
        authTokenReady,
    };
}
