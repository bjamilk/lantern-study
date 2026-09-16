/**
 * The web app's effect barrel: every long-lived side effect App.tsx needs, in one hook —
 * session restore and auth-state handling, the signed-in bootstrap fan-out, all Realtime
 * subscriptions, theme/settings DOM sync, offline-queue persistence and replay, and the
 * SRS reminder scheduler.
 *
 * Exports: useAppEffects({ dataLoaded, setDataLoaded, bootstrapLoad, setBootstrapLoad,
 *  onChallengeNotification }) → { refreshDashboardGamification, dailyQuests, serverStreak,
 *  streakFreezes, questsLoaded, authTokenReady }.
 * Touches: auth/group/test/flashcard/budget/ui/notes/toast stores; supabase Realtime channels
 *  (notifications, dm_threads, dm_messages, messages, notes, note_collaborators, profiles,
 *  group_members) and the REST/BFF fetchers in services/supabase; localStorage keys
 *  'theme', 'offlineBundles', 'pendingSyncResults', 'monthlyBudget' and the onboarding flag;
 *  window events 'lantern:streak-updated', 'lantern:refresh-dm-threads', 'online',
 *  'visibilitychange'; the Notification API via utils/webNotifications.
 * Gotchas:
 *  - USER SWITCH / STALE CLOSURES: several effects outlive the account they were created
 *    for. Anything that writes a store or uploads a queue re-reads `use*Store.getState()`
 *    inside the effect body; an effect whose dep array carries the array itself would hold
 *    the PRE-purge snapshot and resurrect the previous user's data.
 *  - Every authenticated effect gates on `authTokenReady`, not just `currentUser`. Realtime
 *    channels subscribed without a live JWT pass RLS filters that drop every event.
 *  - `realtimeEpoch` is part of each channel name; bumping it (tab focus, CHANNEL_ERROR,
 *    TIMED_OUT) is how channels are recreated with a fresh token. `bumpRealtimeEpoch` is
 *    rate-limited so a persistently failing channel cannot spin a recreate loop.
 *  - A refresh merge (`mergeChatMessagesById(cached, serverList)`) is incoming-wins, which
 *    is server-wins ONLY in that argument order — swapping them lets the persisted cache
 *    clobber fresh server rows (reactions/edits vanish after a cold start).
 *  - SIGNED_OUT is not proof the user is signed out: a refresh-token 400 fires one
 *    spuriously. The handler tries to recover from the authority (BFF in cookie mode,
 *    stored session in legacy mode) before clearing anything, under a cooldown.
 *  - Theme is applied by toggling the `dark` class only; colour values live in index.css.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { User } from '../types';
import { useAuthStore } from '../stores/authStore';
import { reportUnexpectedSignOut, wasRecentIntentionalSignOut } from '../services/sentry';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUIStore } from '../stores/uiStore';
import { resolvePlatformAdmin } from '../utils/platformAdmin';
import { resolveDisplayName } from '../utils/displayIdentity';
import {
    supabase, setCachedAuthToken,
    fetchUserProfile, createUserProfile,
    ensureAuthTokenReady,
    bootstrapAuthFromStorage,
    readPersistedAuthUser,
    shouldRefreshStoredSession,
    resolveClientSession,
    clearClientAuthSession,
    clearAllClientAuthStorage,
    getStoredSessionExpiresAt,
} from '../services/supabase';
import {
    isCookieAuthEnabled,
    exchangeCookieSession,
    refreshCookieSession,
} from '../services/authCookieSession';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { mapUserStatsFromApi, normalizeTestPresets } from '@lantern/shared/utils/apiMappers';
import { useDailyStudyReminder } from './useDailyStudyReminder';
import { useDeepLinkConsumption } from './effects/useDeepLinkConsumption';
import { useDmThreadRefresh } from './effects/useDmThreadRefresh';
import { useGamificationRefresh } from './effects/useGamificationRefresh';
import { useAuthRestore } from './effects/useAuthRestore';
import { useBootstrapFanout } from './effects/useBootstrapFanout';
import { useRealtimeSubscriptions } from './effects/useRealtimeSubscriptions';
import {
  INITIAL_BOOTSTRAP_LOAD_STATE,
  type BootstrapLoadState,
} from './useAuthHandlers';
import { isAccessTokenFreshEnough, shouldRestorePersistedAuthUser } from '../utils/authBootstrap';
import { resetSessionExpiredGuard } from '../services/sessionHandler';
import { useOfflineQueuePersistence } from './effects/useOfflineQueuePersistence';
import { useAccountLifecycle } from './effects/useAccountLifecycle';
import { usePresenceHeartbeat } from './effects/usePresenceHeartbeat';
import { useOnlineQueueReplay } from './effects/useOnlineQueueReplay';
import { useSrsReminders } from './effects/useSrsReminders';
import { useThemeDomSync } from './effects/useThemeDomSync';


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
    const {
        updateGroups,
        updateDmThreads,
        setNotifications,
    } = useGroupStore();
    const {
        setOfflineBundles,
        setPendingSyncResults,
        setTestResults, setUserQuestionStats,
    } = useTestStore();
    const {
        setDecks,
        setFlashcards,
    } = useFlashcardStore();
    const { transactions, setTransactions, budget, setBudget, savingsGoals, expenseSplits, walletBalance, setSavingsGoals, setExpenseSplits, setWalletBalance } = useBudgetStore();
    const {
        setTheme,
        lowDataMode, setLowDataMode,
    } = useUIStore();


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
