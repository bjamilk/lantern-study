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
import { useEffect, useCallback, useState, useRef, type Dispatch, type SetStateAction } from 'react';
import { OfflineSessionBundle, TransactionType, Transaction, User } from '../types';
import { useAuthStore } from '../stores/authStore';
import { reportUnexpectedSignOut, wasRecentIntentionalSignOut } from '../services/sentry';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUIStore } from '../stores/uiStore';
import { useNotesStore } from '../stores/notesStore';
import { initialUserStats } from '../utils/helpers';
import { resolvePlatformAdmin } from '../utils/platformAdmin';
import { resolveDisplayName } from '../utils/displayIdentity';
import {
    supabase, setCachedAuthToken,
    fetchGroups, fetchGroupMembers,
    fetchMessages, fetchDirectMessages,
    fetchDecks, fetchAllFlashcards, mapDecksFromApi,
    fetchTestResults, fetchUserQuestionStats,
    fetchDashboardSummary,
    fetchNotifications,
    fetchGroupUnreadCounts, fetchDMUnreadCounts, fetchDmThreads,
    fetchOfflineBundles,
    fetchUserPreferences, saveUserPreferences,
    fetchUserBudget, saveUserBudget,
    syncBudgetTransactionsToCloud,
    fetchPendingSyncResults,
    syncPendingResultsToCloud,
    markAllNotificationsAsRead, deleteAllNotifications,
    fetchUserProfile, createUserProfile,
    fetchUserSettings,
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
import {
    ONBOARDING_COMPLETE_STORAGE_KEY,
    isOnboardingCompleteFlag,
    normalizeUserSettings,
} from '@lantern/shared/settings';
import { mapMessageFromApi, computeStudyStreak, mergeChatMessagesById, matchesClientMessageId } from '@lantern/shared/utils';
import { mapUserStatsFromApi, normalizeTestPresets } from '@lantern/shared/utils/apiMappers';
import { applyUserSettingsToDom } from '../utils/applyUserSettingsToDom';
import { shouldOpenAcademicSetup, readAcademicSetupDismissed } from '../utils/academicSetup';

/**
 * Onboarding has not been finished or skipped yet — the same flag App.tsx
 * seeds `showOnboarding` from. Read live rather than passed in, because the
 * profile-setup effect runs long before App has a value to hand down.
 *
 * A browser that refuses localStorage answers "not pending", so a student in a
 * locked-down browser still gets asked for a missing username.
 */
function isOnboardingPending(): boolean {
    try {
        return !isOnboardingCompleteFlag(localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY));
    } catch {
        return false;
    }
}
import { fetchStudyActivity, fetchDailyQuests, recordLoginStreak, syncGamificationProgress } from '../services/gamificationStreak';
import { saveBudgetExtras } from '../services/budgetExtrasSync';
import { normalizeMonthlyPlans, readPlanForMonth } from '@lantern/shared/utils';
import { fetchBudgetWalletData } from '../services/budgetApi';
import { useDailyStudyReminder } from './useDailyStudyReminder';
import { useDeepLinkConsumption } from './effects/useDeepLinkConsumption';
import { DirectMessage } from '../types';
import { useToastStore } from '../stores/toastStore';
import {
  INITIAL_BOOTSTRAP_LOAD_STATE,
  type BootstrapLoadState,
} from './useAuthHandlers';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../utils/dmThreads';
import { mergeFetchedGroups } from '../utils/groupListMerge';
import { isAccessTokenFreshEnough, shouldRestorePersistedAuthUser } from '../utils/authBootstrap';
import { resetSessionExpiredGuard } from '../services/sessionHandler';
import { ensureOfflineQueueOwner } from '../services/offlineQueueOwner';
import { useOfflineQueuePersistence } from './effects/useOfflineQueuePersistence';
import { usePresenceHeartbeat } from './effects/usePresenceHeartbeat';
import { useOnlineQueueReplay } from './effects/useOnlineQueueReplay';
import { useSrsReminders } from './effects/useSrsReminders';
import { useThemeDomSync } from './effects/useThemeDomSync';

// A spurious SIGNED_OUT (refresh-token 400) can be recovered when a valid session
// still lives in storage. Bound the recovery so a session that is genuinely dying
// can't ping-pong recover→fail→recover: only attempt it once per this window.
const SPURIOUS_SIGNOUT_RECOVERY_COOLDOWN_MS = 15_000;
let lastSpuriousSignoutRecoveryAt = 0;

// 'error' counts as settled — a domain that failed must not hold the boot spinner open.
function allBootstrapDomainsSettled(state: BootstrapLoadState): boolean {
  return Object.values(state).every((status) => status !== 'pending');
}

function mapFetchedDmThreads(fetched: any[], dmUnreadCounts: Record<string, number>) {
    if (!Array.isArray(fetched)) return [];
    return fetched.map((t: any) => mapDmThreadFromApi(t, dmUnreadCounts));
}

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
  const { groups, setGroups, updateGroups,
        dmThreads, updateDmThreads,
        setAllMessages,
        updateMessages,
        updateDirectMessages,
        setNotifications, updateNotifications, notifications
    } = useGroupStore();
    const {
        setOfflineBundles,
        setPendingSyncResults,
        setTestResults, setUserQuestionStats,
        setStudyActivityDays,
    } = useTestStore();
    const {
        setDecks,
        setFlashcards,
    } = useFlashcardStore();
    const { transactions, setTransactions, budget, setBudget, savingsGoals, expenseSplits, walletBalance, setSavingsGoals, setExpenseSplits, setWalletBalance } = useBudgetStore();
    const {
        setTheme,
        openModal, lowDataMode, setLowDataMode,
        selectedChat,
    } = useUIStore();

    const [dailyQuests, setDailyQuests] = useState<any[]>([]);
    const [serverStreak, setServerStreak] = useState(0);
    const [streakFreezes, setStreakFreezes] = useState(0);
    const [questsLoaded, setQuestsLoaded] = useState(false);
    /** Bumped on tab focus / channel errors so Realtime resubscribes with a live JWT. */
    const [realtimeEpoch, setRealtimeEpoch] = useState(0);
    const lastRealtimeBumpRef = useRef(0);
    const bumpRealtimeEpoch = useCallback(() => {
        const now = Date.now();
        // Avoid tight CHANNEL_ERROR → recreate loops.
        if (now - lastRealtimeBumpRef.current < 5000) return;
        lastRealtimeBumpRef.current = now;
        setRealtimeEpoch((value) => value + 1);
    }, []);

    // Dashboard gamification refresh (quests, login streak, study-activity heatmap, profile
    // points/badges/stats) as four independent Promise.allSettled slots — one failing must
    // not blank the other three. Slot 3 (profile sync) falls back to a direct profile fetch;
    // both write paths re-read the store and compare ids so a user switch mid-flight cannot
    // stamp one account's points onto another. Always ends with questsLoaded = true.
    const refreshDashboardGamification = useCallback(async () => {
        const user = useAuthStore.getState().currentUser;
        if (!user?.id) return;

        const tokenReady = await ensureAuthTokenReady();
        if (!tokenReady) {
            console.warn('[Gamification] Deferred — auth token not ready');
            return;
        }

        const userId = user.id;
        const results = await Promise.allSettled([
            fetchDailyQuests(),
            recordLoginStreak(),
            fetchStudyActivity(),
            syncGamificationProgress(),
        ]);

        if (results[0].status === 'fulfilled') {
            setDailyQuests(Array.isArray(results[0].value) ? results[0].value : []);
        } else {
            console.warn('[Gamification] Daily quests fetch failed:', results[0].reason);
        }

        if (results[1].status === 'fulfilled') {
            const s = results[1].value;
            setServerStreak(s?.current_streak ?? s?.currentStreak ?? 0);
            setStreakFreezes(s?.streak_freezes ?? s?.streakFreezes ?? 0);
        } else {
            console.warn('[Gamification] Streak record failed:', results[1].reason);
        }

        if (results[2].status === 'fulfilled') {
            const days = Array.isArray(results[2].value) ? results[2].value : [];
            setStudyActivityDays(days);
            const computedStreak = computeStudyStreak(days).current;
            setServerStreak((prev) => Math.max(prev, computedStreak));
        } else {
            console.warn('[Gamification] Study activity fetch failed:', results[2].reason);
        }

        if (results[3].status === 'fulfilled') {
            const synced = results[3].value;
            const current = useAuthStore.getState().currentUser;
            if (synced && current?.id === userId) {
                setCurrentUser({
                    ...current,
                    points: synced.points ?? current.points,
                    badges: synced.badges ?? current.badges,
                    stats: synced.stats ?? current.stats,
                });
            }
        } else {
            console.warn('[Gamification] Profile sync failed:', results[3].reason);
            try {
                const profile = await fetchUserProfile(userId);
                const current = useAuthStore.getState().currentUser;
                if (profile && current?.id === userId) {
                    setCurrentUser({
                        ...current,
                        points: (profile.points as number) ?? current.points,
                        badges: (profile.badges as User['badges']) ?? current.badges,
                        stats: (profile.stats as User['stats']) ?? current.stats,
                    });
                }
            } catch (profileErr) {
                console.warn('[Gamification] Profile refresh fallback failed:', profileErr);
            }
        }

        setQuestsLoaded(true);
    }, [setCurrentUser, setStudyActivityDays]);

    useDailyStudyReminder(currentUser);

    // Mount-once ([] deps): lets any code that already knows the new streak (e.g. a review
    // submit response) push it here via a window event, instead of forcing a refetch.
    useEffect(() => {
        const onStreakUpdated = (event: Event) => {
            const streak = (event as CustomEvent<{ streak?: number }>).detail?.streak;
            if (typeof streak === 'number' && streak >= 0) {
                setServerStreak(streak);
            }
        };
        window.addEventListener('lantern:streak-updated', onStreakUpdated);
        return () => window.removeEventListener('lantern:streak-updated', onStreakUpdated);
    }, []);

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

    // --- Presence heartbeat for online status ---
    usePresenceHeartbeat({ currentUser, authTokenReady });

    // --- Restore session on app load ---
    // Mount-once ([] deps) and deliberately so: it owns the single supabase
    // onAuthStateChange subscription for the app's lifetime, so it must never re-run on a
    // user change. Everything inside therefore reads useAuthStore.getState() rather than the
    // closed-over `currentUser`. Three stages: fast boot from storage → background
    // validation against the server → the auth-event handler below.
    useEffect(() => {
        let isMounted = true;

        // Normaliser: profile row (camelCase or snake_case, depending on which endpoint
        // produced it) + auth user → the app's User. Used by boot, by profile creation, and
        // by SIGNED_IN, so a field dropped here is dropped on every entry path.
        const userFromProfile = (
            profile: Record<string, unknown>,
            email: string,
            authUser?: { app_metadata?: Record<string, unknown>; email?: string | null }
        ): User => ({
            id: profile.id as string,
            name: profile.name as string,
            avatarUrl: (profile.avatarUrl as string) || (profile.avatar_url as string) || '',
            email,
            password: '',
            phoneNumber: (profile.phoneNumber as string) || (profile.phone as string) || '',
            points: (profile.points as number) || 0,
            badges: (profile.badges as User['badges']) || [],
            stats: mapUserStatsFromApi(profile.stats || {}),
            settings: normalizeUserSettings(profile.settings),
            // Account-scoped presets live on profiles.test_presets — must survive bootstrap.
            testPresets: normalizeTestPresets(profile),
            username: (profile.username as string) || undefined,
            firstName: (profile.firstName as string) || (profile.first_name as string) || undefined,
            lastName: (profile.lastName as string) || (profile.last_name as string) || undefined,
            isAdmin: resolvePlatformAdmin(authUser, profile.settings as Record<string, unknown>),
            // Academic identity (Phase 1): null = known-missing, the same rule
            // stores/authStore.ts applies on sign-in. This mapper runs on every
            // boot and on SIGNED_IN, and it used to drop these fields — leaving
            // them `undefined`, which every academic gate reads as "profile not
            // loaded, never ask". That silently skipped the required onboarding
            // step and the dashboard nudge for any account that reloaded.
            institutionId: (profile.institutionId as User['institutionId']) ?? null,
            institution: (profile.institution as User['institution']) ?? null,
            faculty: (profile.faculty as User['faculty']) ?? null,
            programme: (profile.programme as User['programme']) ?? null,
            studyLevel: (profile.studyLevel as User['studyLevel']) ?? null,
            entryYear: (profile.entryYear as User['entryYear']) ?? null,
            expectedGraduationYear:
                (profile.expectedGraduationYear as User['expectedGraduationYear']) ?? null,
        });

        // Stage 1 — fast boot: paint a signed-in shell from storage before any network call.
        // Only promotes authTokenReady when the stored access token is still fresh; a
        // near-expiry token waits for stage 2 so the fan-out does not fire 401s.
        const applyFastBoot = (): boolean => {
            const boot = bootstrapAuthFromStorage();
            if (!boot) return false;

            let user = useAuthStore.getState().currentUser;
            if (!user) {
                const persisted = readPersistedAuthUser();
                if (shouldRestorePersistedAuthUser(boot, persisted)) {
                    user = persisted as unknown as User;
                    setCurrentUser(user);
                }
            }
            if (!user || user.id !== boot.userId) return false;

            // Defer API fan-out until refresh if the access token is near expiry.
            if (isAccessTokenFreshEnough(getStoredSessionExpiresAt())) {
                setAuthTokenReady(true);
            }
            return true;
        };

        // Stage 2 — validate the session for real, behind a 6s race so a hanging /session
        // cannot wedge boot. Failure is classified, and the classes take different branches:
        //  - 'network' with a cached user → INCONCLUSIVE. Keep the user signed in; a
        //    transient outage must never wipe the session or the unsynced work behind it.
        //  - 'revoked' / 'missing' with a cached user → genuine. Clear auth storage, drop
        //    currentUser and reset bootstrap state.
        // On success: adopt the session, refresh it if it expires within 5 minutes, then
        // reconcile the profile (404 → create one from auth metadata; other errors keep the
        // cached user; `is_banned`/`account_status: 'banned'` force a sign-out).
        const syncSessionInBackground = async (hadFastBoot: boolean) => {
            try {
                const resolved = await Promise.race([
                    resolveClientSession(),
                    new Promise<never>((_, reject) => {
                        window.setTimeout(() => reject(new Error('session restore timed out')), 6000);
                    }),
                ]);
                if (!isMounted) return;

                if (!resolved.ok) {
                    const hasCachedUser = Boolean(
                        useAuthStore.getState().currentUser || readPersistedAuthUser()?.id
                    );
                    if (resolved.reason === 'network' && hasCachedUser) {
                        console.warn(
                            '[Auth] Session restore inconclusive (network) — keeping cached user'
                        );
                        if (hadFastBoot || bootstrapAuthFromStorage()) {
                            setAuthTokenReady(true);
                        }
                        return;
                    }
                    if (
                        hasCachedUser &&
                        (resolved.reason === 'revoked' || resolved.reason === 'missing')
                    ) {
                        console.warn('[Auth] No active session — clearing stale cached user');
                        await clearClientAuthSession();
                        clearAllClientAuthStorage();
                        setCurrentUser(null);
                        setAuthTokenReady(false);
                        setDataLoaded(false);
                        setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
                    }
                    return;
                }

                const session = resolved.session;
                if (isCookieAuthEnabled()) {
                    // The error was silently discarded here, which cost a day:
                    // when setSession fails, every direct PostgREST query runs
                    // as anon (42501) while API calls keep working on the
                    // cached Bearer token — a half-broken state with no signal.
                    const { error: setSessionError } = await supabase.auth.setSession({
                        access_token: session.access_token,
                        refresh_token: session.refresh_token,
                    });
                    if (setSessionError) {
                        console.warn('[CookieAuth] setSession failed:', setSessionError.message);
                    }
                }

                if (session.access_token) {
                    setCachedAuthToken(session.access_token, session.user.id);
                    resetSessionExpiredGuard();
                    setAuthTokenReady(true);
                }

                let authUser = session.user;
                if (isCookieAuthEnabled()) {
                    // shouldRefreshStoredSession() reads localStorage, which is
                    // deliberately empty in cookie mode — judge staleness from
                    // the restored session itself.
                    const expiresSoon =
                        typeof session.expires_at === 'number' &&
                        session.expires_at - Date.now() / 1000 < 300;
                    if (expiresSoon) {
                        try {
                            const refreshed = await refreshCookieSession();
                            if (refreshed?.user) {
                                setCachedAuthToken(refreshed.access_token, refreshed.user.id);
                                authUser = refreshed.user;
                            }
                        } catch (refreshErr) {
                            console.warn('[Auth] cookie refresh failed, using existing session');
                        }
                    }
                } else if (shouldRefreshStoredSession()) {
                    try {
                        const { data: refreshData } = await supabase.auth.refreshSession();
                        if (refreshData?.session?.user) {
                            setCachedAuthToken(refreshData.session.access_token, refreshData.session.user.id);
                            authUser = refreshData.session.user;
                        }
                    } catch (refreshErr) {
                        console.warn('[Auth] refreshSession failed, using existing session');
                    }
                }

                const cached =
                    useAuthStore.getState().currentUser ??
                    (readPersistedAuthUser() as unknown as User | null);

                if (cached && cached.id === session.user.id) {
                    setCurrentUser({
                        ...cached,
                        email: authUser.email || cached.email,
                        isAdmin: resolvePlatformAdmin(
                            authUser,
                            cached.settings as Record<string, unknown>
                        ),
                    });
                }

                try {
                    const profile = await fetchUserProfile(session.user.id);
                    if (!isMounted || !profile) {
                        return;
                    }

                    const isBanned =
                        profile.settings?.is_banned === true ||
                        profile.settings?.account_status === 'banned';
                    if (isBanned) {
                        await clearClientAuthSession();
                        if (isMounted) {
                            setCurrentUser(null);
                            setAuthTokenReady(false);
                        }
                        return;
                    }

                    setCurrentUser(userFromProfile(profile, authUser.email!, authUser));
                } catch (profileErr: any) {
                    const existingUser = useAuthStore.getState().currentUser;
                    if (
                        profileErr.message?.includes('404') ||
                        profileErr.message?.includes('status: 404')
                    ) {
                        const meta = (authUser.user_metadata || {}) as Record<string, unknown>;
                        // The account email is NOT a name candidate: its local
                        // part is not a name. resolveDisplayName drops an
                        // email-shaped value and yields the neutral placeholder
                        // when there is no real name, so this is never the email
                        // and never an empty string.
                        const userName = resolveDisplayName([
                            typeof meta.name === 'string' ? meta.name : null,
                            [meta.first_name, meta.last_name]
                                .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
                                .join(' '),
                        ]);
                        try {
                            // Same fields finishAuthSession writes: verifying
                            // via the EMAIL LINK boots here instead, and used
                            // to drop the username/name/phone the user chose
                            // at signup (then re-prompted for the username).
                            const newProfile = await createUserProfile({
                                id: session.user.id,
                                name: userName,
                                username: typeof meta.username === 'string' ? meta.username : undefined,
                                first_name: typeof meta.first_name === 'string' ? meta.first_name : undefined,
                                last_name: typeof meta.last_name === 'string' ? meta.last_name : undefined,
                                phone: typeof meta.phone === 'string' ? meta.phone : undefined,
                                points: 0,
                                stats: {},
                                settings: {},
                                badges: [],
                            });
                            if (isMounted) {
                                setCurrentUser(userFromProfile(newProfile, authUser.email!, authUser));
                            }
                        } catch (createError) {
                            console.error('Failed to create profile via API:', createError);
                        }
                    } else if (existingUser && existingUser.id === session.user.id) {
                        setCurrentUser({
                            ...existingUser,
                            isAdmin: resolvePlatformAdmin(
                                authUser,
                                existingUser.settings as Record<string, unknown>
                            ),
                        });
                    } else {
                        console.warn('[Auth] Profile fetch failed:', profileErr.message);
                    }
                }
            } catch (error: any) {
                console.warn('[Auth] Session validation failed:', error?.message || error);
            } finally {
                if (isMounted) {
                    setAuthLoading(false);
                }
            }
        };

        const hadFastBoot = applyFastBoot();
        if (hadFastBoot) {
            // Don't keep the boot spinner up while /session or getSession hangs.
            // The background sync still validates; this is what "fast boot" is for.
            setAuthLoading(false);
        } else {
            setAuthTokenReady(false);
        }
        void syncSessionInBackground(hadFastBoot);

        // Stage 3 — the auth-event handler. Handles SIGNED_OUT (with spurious-signout
        // recovery), PASSWORD_RECOVERY (token only, no profile load, so the reset screen is
        // not treated as a normal sign-in) and SIGNED_IN.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT') {
                // A refresh-token 400 — commonly a cross-tab rotation race — can fire
                // a spurious SIGNED_OUT even though a valid session still lives in
                // storage (the refresh that won the race wrote a fresh token another
                // tab now holds). Before tearing the session down, re-read the stored
                // session; if one is still live, treat this as spurious and keep the
                // user in. Legacy (localStorage) token mode only — that is where the
                // Supabase /auth/v1/token refresh race happens; cookie mode is a
                // different flow. Bounded by a cooldown so a genuinely dying session
                // still signs out instead of looping.
                const hadUser = Boolean(useAuthStore.getState().currentUser);
                if (
                    hadUser &&
                    // Never "recover" a logout the user actually asked for.
                    !wasRecentIntentionalSignOut() &&
                    Date.now() - lastSpuriousSignoutRecoveryAt > SPURIOUS_SIGNOUT_RECOVERY_COOLDOWN_MS
                ) {
                    try {
                        if (isCookieAuthEnabled()) {
                            // Cookie mode was excluded here until Sentry showed it is
                            // where this actually happens: 27 of 39 unexpected sign-outs
                            // came from real Chrome and Edge sessions, each preceded by a
                            // 400 on supabase.co/auth/v1/token. supabase-js keeps its own
                            // session and refreshes it even in cookie mode, so it can lose
                            // that race and emit SIGNED_OUT — while the HttpOnly cookie
                            // that actually authenticates the API is untouched.
                            //
                            // So ask the authority rather than the messenger: if the BFF
                            // still refreshes, the user is signed in, whatever supabase-js
                            // concluded.
                            const cookieSession = await refreshCookieSession();
                            if (cookieSession?.access_token) {
                                lastSpuriousSignoutRecoveryAt = Date.now();
                                setCachedAuthToken(
                                    cookieSession.access_token,
                                    cookieSession.user?.id
                                );
                                setAuthTokenReady(true);
                                return;
                            }
                        } else {
                            const { data: { session: liveSession } } = await supabase.auth.getSession();
                            const stillValid =
                                !!liveSession?.user &&
                                !!liveSession.access_token &&
                                typeof liveSession.expires_at === 'number' &&
                                liveSession.expires_at * 1000 > Date.now() + 5_000;
                            if (stillValid && liveSession) {
                                lastSpuriousSignoutRecoveryAt = Date.now();
                                setCachedAuthToken(liveSession.access_token, liveSession.user.id);
                                setAuthTokenReady(true);
                                // Recovered a live session — do not report or clear the user.
                                return;
                            }
                        }
                    } catch {
                        // Fall through to the normal sign-out below.
                    }
                }
                // Fires for clicked logouts and for sessions that died under the
                // user (refresh-token 400s) alike; the reporter separates them.
                reportUnexpectedSignOut({
                    hadUser,
                    path: typeof window !== 'undefined' ? window.location.pathname : '',
                });
                setAuthTokenReady(false);
                setPasswordRecovery(false);
                // Always clear — previously skipped while isAuthLoading, leaving stale users on /.
                setCurrentUser(null);
                setDataLoaded(false);
                setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
            } else if (event === 'PASSWORD_RECOVERY') {
                if (session?.access_token) {
                    setCachedAuthToken(session.access_token, session.user?.id);
                    setAuthTokenReady(true);
                }
                setPasswordRecovery(true);
            } else if (event === 'SIGNED_IN' && session?.user) {
                if (isCookieAuthEnabled() && session) {
                    await exchangeCookieSession(session);
                }
                if (useAuthStore.getState().isPasswordRecovery) {
                    if (session.access_token) {
                        setCachedAuthToken(session.access_token, session.user?.id);
                        setAuthTokenReady(true);
                    }
                    return;
                }
                if (session.access_token) {
                    setCachedAuthToken(session.access_token, session.user?.id);
                    resetSessionExpiredGuard();
                    setAuthTokenReady(true);
                }
                try {
                    const profile = await fetchUserProfile(session.user.id);
                    if (profile) {
                        const isBanned =
                            profile.settings?.is_banned === true ||
                            profile.settings?.account_status === 'banned';
                        if (isBanned) {
                            await supabase.auth.signOut();
                            setCurrentUser(null);
                            return;
                        }
                        setCurrentUser(userFromProfile(profile, session.user.email!, session.user));
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (!msg.includes('404') && !msg.includes('status: 404')) {
                        console.error('Failed to fetch profile on SIGNED_IN event:', err);
                    }
                }
            }
        });
        
        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []);

    // Promote token-ready after login when AuthScreen cached the token before SIGNED_IN fires
    // Re-runs on currentUser.id / isAuthLoading / authTokenReady; self-terminating, because
    // the effect's own success flips authTokenReady and the guard then short-circuits.
    useEffect(() => {
        if (!currentUser || isAuthLoading || authTokenReady) return;
        void ensureAuthTokenReady().then((ready) => {
            if (ready) setAuthTokenReady(true);
        });
    }, [currentUser?.id, isAuthLoading, authTokenReady]);

    // Cross-account guard: the offline queues live under fixed localStorage
    // keys and survive logout — before this, signing in as another user on the
    // same browser replayed the previous user's queued test results, flashcard
    // reviews, and qbank scores INTO the new account. Purge foreign queues
    // (storage AND the already-hydrated store copies) before any sync runs.
    // Re-runs on currentUser.id ONLY, and must stay that way: it has to land before the
    // sync/persist effects below observe the queue. It clears through getState() rather than
    // the render-scope arrays, which are the pre-purge snapshot on this same commit.
    useEffect(() => {
        if (!currentUser?.id) return;
        if (ensureOfflineQueueOwner(currentUser.id)) {
            useTestStore.getState().setPendingSyncResults([]);
            useFlashcardStore.getState().clearPendingReviews();
        }
    }, [currentUser?.id]);

    // --- Theme / appearance DOM sync (not privacy/study — avoids re-render storms while Settings is open) ---
    // Re-runs on currentUser.id plus the appearance/accessibility SUB-OBJECTS only —
    // depending on the whole settings object would re-apply the DOM on every privacy/study
    // keystroke while the Settings screen is open. Signed out (or settings not loaded yet)
    // it falls back to the localStorage 'theme' value, toggling the `dark` class and nothing
    // else; colour values themselves stay in index.css.
    const appearanceSettings = currentUser?.settings?.appearance;
    const accessibilitySettings = currentUser?.settings?.accessibility;
    useEffect(() => {
        if (currentUser?.settings) {
            applyUserSettingsToDom(normalizeUserSettings(currentUser.settings), {
                setTheme,
                setLowDataMode,
            });
            return;
        }

        const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (storedTheme) {
            setTheme(storedTheme);
            document.documentElement.classList.toggle('dark', storedTheme === 'dark');
        } else {
            setTheme('light');
            document.documentElement.classList.remove('dark');
        }
    }, [currentUser?.id, appearanceSettings, accessibilitySettings, setTheme, setLowDataMode]);

    // --- Sync canonical settings from API (cross-device) ---
    // Re-runs on currentUser.id + authTokenReady (one fetch per signed-in session, not per
    // settings edit). Last-write-wins by `updatedAt`, ties going to the server. The store is
    // re-read after the await and id-checked, so a slow response cannot write another
    // account's settings; `cancelled` covers unmount/user-switch mid-flight.
    useEffect(() => {
        if (!currentUser?.id || !authTokenReady) return;

        let cancelled = false;

        void (async () => {
            const remote = await fetchUserSettings(currentUser.id);
            if (cancelled || !remote) return;

            const user = useAuthStore.getState().currentUser;
            if (!user || user.id !== currentUser.id) return;

            const local = normalizeUserSettings(user.settings);
            const localTime = Date.parse(local.updatedAt || '') || 0;
            const remoteTime = Date.parse(remote.updatedAt || '') || 0;
            // Prefer remote when timestamps are equal/newer; local only wins if clearly newer.
            const merged = remoteTime >= localTime ? remote : local;

            if (JSON.stringify(merged) !== JSON.stringify(local)) {
                setCurrentUser({ ...user, settings: merged });
            }
            applyUserSettingsToDom(merged, { setTheme, setLowDataMode });
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, authTokenReady]);

    // --- Profile setup check (username, and academic identity once per dismissal) ---
    // Re-runs on currentUser.id / .username / .institutionId — i.e. exactly the fields that
    // can satisfy the check, so completing setup closes the prompt without a reload.
    // The onboarding flag is read live from localStorage, not from a dep.
    useEffect(() => {
        if (!currentUser) return;
        // A brand-new account used to meet TWO setup forms back to back: the
        // skippable "Set up your profile" modal, and then onboarding's required
        // academic step asking for the same institution. Onboarding goes first
        // and asks for everything it needs; App.tsx re-runs this check the
        // moment onboarding finishes, so anything still missing (a username, on
        // an account that never had one) is asked for exactly once, afterwards.
        if (isOnboardingPending()) return;
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/teach')) {
            if (!currentUser.username) openModal('usernameRequired');
            return;
        }
        if (shouldOpenAcademicSetup(currentUser, readAcademicSetupDismissed(currentUser.id))) {
            openModal('usernameRequired');
        }
    }, [currentUser?.id, currentUser?.username, currentUser?.institutionId]);

    // --- Data loading ---
    // The signed-in bootstrap fan-out. Re-runs on currentUser.id / dataLoaded / isAuthLoading
    // / authTokenReady; `dataLoaded` is what makes it run once per account (handleLogout and
    // the sign-out paths reset it, which is how a second account re-bootstraps).
    // Two waves: a critical phase for first paint, then the heavy deferred loads. Results are
    // re-indexed into a flat `results` array, and each slot is applied independently so one
    // failed domain degrades that domain only. Every apply is gated on shouldApplyBootstrap()
    // — cancelled flag plus a live store id check — so a slow fan-out for user A cannot write
    // into user B's session after a switch.
    useEffect(() => {
        if (!currentUser || dataLoaded || isAuthLoading || !authTokenReady) return;

        let cancelled = false;

        (async () => {
            const tokenReady = await ensureAuthTokenReady();
            if (!tokenReady) {
                console.warn('[Data Loading] Deferred — auth token not ready');
                return;
            }
            if (cancelled) return;

            console.log('[Data Loading] Starting PARALLEL data fetch for user:', currentUser.id);
            setBootstrapLoad(INITIAL_BOOTSTRAP_LOAD_STATE);
            const userId = currentUser.id;
            const currentMonthYear = new Date().toISOString().slice(0, 7);

            // Owner-stamp the budget store first: ensureOwner drops another user's cached
            // transactions, and only the surviving (owned) rows are pushed to the cloud below.
            useBudgetStore.getState().ensureOwner(userId);
            const scopedTransactions = useBudgetStore.getState().transactions;

            void refreshDashboardGamification();

            // Phase 1: critical path for first paint (groups, DMs, notifications, prefs)
            const criticalResults = await Promise.allSettled([
                fetchGroups(userId),
                fetchGroupUnreadCounts(userId),
                fetchDmThreads(userId),
                fetchDMUnreadCounts(userId),
                fetchNotifications(userId),
                fetchUserPreferences(userId),
            ]);

            // One aggregate round trip for test results + question stats,
            // falling back to the individual requests when the summary
            // endpoint is unavailable (e.g. older API deployments).
            const dashboardInputsPromise = (async () => {
                const summary = await fetchDashboardSummary();
                if (summary) return summary;
                const [testResults, userQuestionStats] = await Promise.all([
                    fetchTestResults(userId, { limit: 500, lean: true }),
                    fetchUserQuestionStats(userId),
                ]);
                return { testResults, userQuestionStats };
            })();

            // Phase 2: deferred heavy loads (paginated / background)
            const deferredResults = await Promise.allSettled([
                fetchDecks(userId, { includeShared: true }),
                fetchAllFlashcards(undefined, userId),
                dashboardInputsPromise.then(inputs => inputs.testResults),
                dashboardInputsPromise.then(inputs => inputs.userQuestionStats),
                fetchOfflineBundles(userId),
                fetchUserBudget(userId, currentMonthYear),
                syncBudgetTransactionsToCloud(userId, scopedTransactions),
            ]);

            // Flatten both waves into one fixed-order array; the `results[n]` indices below
            // are positional and must stay in step with this list.
            const results = [
                criticalResults[0], criticalResults[1], criticalResults[2], criticalResults[3],
                deferredResults[0], deferredResults[1], deferredResults[2], deferredResults[3],
                criticalResults[4],
                deferredResults[4],
                criticalResults[5],
                deferredResults[5],
                deferredResults[6],
            ];

            if (cancelled) return;

            const shouldApplyBootstrap = () =>
                !cancelled && useAuthStore.getState().currentUser?.id === userId;

            console.log('[Data Loading] All parallel fetches settled');

            const nextBootstrap: BootstrapLoadState = {
                groups: criticalResults[0].status === 'fulfilled' ? 'loaded' : 'error',
                dms: criticalResults[2].status === 'fulfilled' ? 'loaded' : 'error',
                notifications: criticalResults[4].status === 'fulfilled' ? 'loaded' : 'error',
                preferences: criticalResults[5].status === 'fulfilled' ? 'loaded' : 'error',
                decks: deferredResults[0].status === 'fulfilled' ? 'loaded' : 'error',
                flashcards: deferredResults[1].status === 'fulfilled' ? 'loaded' : 'error',
                tests:
                    deferredResults[2].status === 'fulfilled' && deferredResults[3].status === 'fulfilled'
                        ? 'loaded'
                        : 'error',
                offline: deferredResults[4].status === 'fulfilled' ? 'loaded' : 'error',
                budget:
                    deferredResults[5].status === 'fulfilled' && deferredResults[6].status === 'fulfilled'
                        ? 'loaded'
                        : 'error',
            };
            if (!shouldApplyBootstrap()) return;
            setBootstrapLoad(nextBootstrap);

            if (nextBootstrap.groups === 'error') {
                useToastStore.getState().showToast(
                    'Could not load your groups. Some features may be unavailable until you refresh.',
                    'error'
                );
            } else if (nextBootstrap.decks === 'error' || nextBootstrap.flashcards === 'error') {
                useToastStore.getState().showToast(
                    'Some study library data failed to load. Try refreshing the page.',
                    'error'
                );
            }

                if (!shouldApplyBootstrap()) return;

                // --- [0] Groups + [1] Unread counts ---
                const groupsResult = results[0];
                const unreadResult = results[1];
                // Remaps the API rows (mixed camel/snake case) and folds unread counts in,
                // preserving locally-loaded roster/pending-member data that the list endpoint
                // does not return — so an @mention roster is not blanked by a refresh.
                if (groupsResult.status === 'fulfilled') {
                    const fetchedGroups = groupsResult.value;
                    const unreadCounts = unreadResult.status === 'fulfilled' ? unreadResult.value : {};
                    updateGroups((prev) => mergeFetchedGroups(fetchedGroups, prev, unreadCounts));
                } else {
                    console.error('[Data Loading] Groups fetch failed:', groupsResult.reason);
                }

                // --- [2] DM threads + [3] DM unread counts ---
                const dmResult = results[2];
                const dmUnreadResult = results[3];
                if (dmResult.status === 'fulfilled') {
                    const fetchedDmThreads = dmResult.value;
                    const dmUnreadCounts = dmUnreadResult.status === 'fulfilled' ? dmUnreadResult.value : {};
                    const mapped = mapFetchedDmThreads(
                        Array.isArray(fetchedDmThreads) ? fetchedDmThreads : [],
                        dmUnreadCounts,
                    );
                    // Server-authoritative merge keeps only optimistic locals, so a real
                    // empty inbox clears stale threads without wiping in-flight creates.
                    updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'server'));
                }

                // --- [4] Decks + [5] Flashcards ---
                const decksResult = results[4];
                const flashcardsResult = results[5];
                if (decksResult.status === 'fulfilled') {
                    // Full mapping (userId/isShared included) so shared-deck
                    // affordances survive the bootstrap load.
                    setDecks(mapDecksFromApi(decksResult.value || []));
                }
                // A failed deck/card load must render as an error with Retry,
                // never as the "No flashcard decks yet" empty state.
                {
                    const flashcardStore = useFlashcardStore.getState();
                    const loadFailure =
                        decksResult.status === 'rejected'
                            ? decksResult.reason
                            : flashcardsResult.status === 'rejected'
                              ? flashcardsResult.reason
                              : null;
                    flashcardStore.setDeckLoadError(
                        loadFailure
                            ? (loadFailure instanceof Error && loadFailure.message) ||
                                  "Couldn't load your decks — check your connection."
                            : null
                    );
                    flashcardStore.setRetryDeckBootstrap(() => {
                        void (async () => {
                            const store = useFlashcardStore.getState();
                            try {
                                const [freshDecks, freshCards] = await Promise.all([
                                    fetchDecks(userId, { includeShared: true }),
                                    fetchAllFlashcards(undefined, userId),
                                ]);
                                store.setDecks(mapDecksFromApi(freshDecks || []));
                                store.setFlashcards(freshCards);
                                store.setDeckLoadError(null);
                            } catch (retryErr) {
                                store.setDeckLoadError(
                                    (retryErr instanceof Error && retryErr.message) ||
                                        "Couldn't load your decks — check your connection."
                                );
                            }
                        })();
                    });
                }
                void useNotesStore.getState().loadFolders();
                void useNotesStore.getState().loadNotes();

                if (flashcardsResult.status === 'fulfilled') {
                    // Already normalized via fetchAllFlashcards → mapFlashcardsFromApi
                    setFlashcards(flashcardsResult.value);
                }

                // --- [6] Test results ---
                // Cloud history plus any still-unsynced offline results. Dedupe is by id AND
                // by session start time, because a result synced by another device comes back
                // with a server id that the local pending copy never saw.
                if (results[6].status === 'fulfilled') {
                    const cloudResults = results[6].value;
                    // Re-read pendingSyncResults from the store at merge time (localStorage-backed)
                    const currentPending = useTestStore.getState().pendingSyncResults;
                    if (currentPending.length > 0) {
                        const cloudIds = new Set(cloudResults.map((r: any) => r.id).filter(Boolean));
                        const cloudStartTimes = new Set(cloudResults.map((r: any) => new Date(r.session?.startTime).getTime()));
                        const pendingNotYetSynced = currentPending.filter(r =>
                            !cloudIds.has(r.id) && !cloudStartTimes.has(new Date(r.session?.startTime).getTime())
                        );
                        setTestResults([...pendingNotYetSynced, ...cloudResults]);
                    } else {
                        setTestResults(cloudResults);
                    }
                }

                // --- [7] User question stats ---
                if (results[7].status === 'fulfilled') {
                    let fetchedStats = results[7].value;
                    // Summary/bootstrap may return {} when the aggregate path
                    // failed open. Retry the dedicated endpoint so "Questions
                    // to review" can still populate.
                    if (
                        !fetchedStats ||
                        typeof fetchedStats !== 'object' ||
                        Array.isArray(fetchedStats) ||
                        Object.keys(fetchedStats).length === 0
                    ) {
                        try {
                            fetchedStats = await fetchUserQuestionStats(userId);
                        } catch {
                            // keep prior empty/failed value
                        }
                    }
                    if (
                        fetchedStats &&
                        typeof fetchedStats === 'object' &&
                        !Array.isArray(fetchedStats)
                    ) {
                        setUserQuestionStats(fetchedStats);
                    }
                } else {
                    try {
                        const retryStats = await fetchUserQuestionStats(userId);
                        if (retryStats && typeof retryStats === 'object' && !Array.isArray(retryStats)) {
                            setUserQuestionStats(retryStats);
                        }
                    } catch {
                        // leave store as-is
                    }
                }

                // Both the fulfilled-but-empty and the rejected case retry the dedicated
                // stats endpoint once; either way the store is left untouched on failure
                // rather than being overwritten with {}.

                // --- [8] Notifications ---
                if (results[8].status === 'fulfilled') {
                    const fetchedNotifications = results[8].value;
                    setNotifications(Array.isArray(fetchedNotifications) ? fetchedNotifications : []);
                }

                // --- [9] Offline bundles ---
                if (results[9].status === 'fulfilled') {
                    const cloudBundles: OfflineSessionBundle[] = results[9].value;
                    // Cloud is the authoritative source filtered by user_id.
                    // Replace the store entirely to prevent cross-user contamination
                    // from the shared localStorage key and to eliminate duplicates.
                    setOfflineBundles(cloudBundles);
                }

                // --- [10] User preferences ---
                // Legacy slim prefs row. It only stores a RESOLVED light/dark theme, so it is
                // never allowed to overwrite a 'system' preference held in full settings.
                // Also rehydrates budget extras (goals, splits, per-month plans) and, when
                // there is no cloud row at all, seeds one from local state.
                if (results[10].status === 'fulfilled') {
                    const cloudPrefs = results[10].value;
                    if (cloudPrefs) {
                        // Theme comes from full UserSettings (supports system). Slim prefs
                        // only carry a resolved light/dark column — do not overwrite system.
                        const themePreference = cloudPrefs.preferences?.themePreference;
                        const fullTheme = useAuthStore.getState().currentUser?.settings?.appearance?.theme;
                        if (
                            fullTheme !== 'system' &&
                            themePreference !== 'system' &&
                            (cloudPrefs.theme === 'light' || cloudPrefs.theme === 'dark')
                        ) {
                            setTheme(cloudPrefs.theme);
                            localStorage.setItem('theme', cloudPrefs.theme);
                        }
                        if (typeof cloudPrefs.lowDataMode === 'boolean') {
                            setLowDataMode(cloudPrefs.lowDataMode === true);
                        } else if (typeof cloudPrefs.preferences?.lowDataMode === 'boolean') {
                            setLowDataMode(cloudPrefs.preferences.lowDataMode === true);
                        }
                        const extras = cloudPrefs.preferences?.budgetExtras;
                        if (extras && typeof extras === 'object') {
                            if (Array.isArray(extras.savingsGoals)) setSavingsGoals(extras.savingsGoals);
                            if (Array.isArray(extras.expenseSplits)) setExpenseSplits(extras.expenseSplits);
                            useBudgetStore.getState().setPlansByMonth(
                                normalizeMonthlyPlans(extras.plansByMonth)
                            );
                            // Read the CURRENT month's plan through the per-month
                            // store (with the legacy flat fields as fallback).
                            // Hydration used to restore only categoryBudgets, so
                            // plannedIncome/plannedSavings vanished on reload.
                            const monthPlan = readPlanForMonth(
                                extras,
                                currentMonthYear,
                                currentMonthYear
                            );
                            if (monthPlan) {
                                const currentBudget = useBudgetStore.getState().budget;
                                setBudget({
                                    monthlyLimit: currentBudget?.monthlyLimit ?? 0,
                                    monthYear: currentBudget?.monthYear ?? currentMonthYear,
                                    userId,
                                    categoryBudgets: monthPlan.plannedExpenses,
                                    plannedIncome: monthPlan.plannedIncome,
                                    plannedSavings: monthPlan.plannedSavings,
                                });
                            }
                        }
                    } else {
                        const localTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
                        const settingsTheme =
                            useAuthStore.getState().currentUser?.settings?.appearance?.theme;
                        saveUserPreferences(userId, {
                            theme: localTheme,
                            lowDataMode,
                            themePreference:
                                settingsTheme === 'system' || settingsTheme === 'light' || settingsTheme === 'dark'
                                    ? settingsTheme
                                    : localTheme,
                        }).catch(console.error);
                    }
                }

                // --- [11] User budget ---
                // Cloud row wins; otherwise the legacy 'monthlyBudget' localStorage blob is
                // adopted and written up once. categoryBudgets always come from the store,
                // since slot [10] above already hydrated them from the plans payload.
                if (results[11].status === 'fulfilled') {
                    const cloudBudget = results[11].value;
                    const existing = useBudgetStore.getState().budget;
                    if (cloudBudget) {
                        setBudget({
                            monthlyLimit: cloudBudget.monthlyLimit,
                            monthYear: currentMonthYear,
                            userId,
                            categoryBudgets: existing?.categoryBudgets,
                        });
                    } else {
                        const localBudgetStr = localStorage.getItem('monthlyBudget');
                        if (localBudgetStr) {
                            const localBudget = JSON.parse(localBudgetStr);
                            setBudget({
                                monthlyLimit: localBudget.monthlyLimit || 0,
                                monthYear: currentMonthYear,
                                userId,
                                categoryBudgets: existing?.categoryBudgets ?? localBudget.categoryBudgets,
                            });
                            saveUserBudget(userId, {
                                monthlyLimit: localBudget.monthlyLimit || 0,
                                monthYear: currentMonthYear
                            }).catch(console.error);
                        }
                    }
                }

                // --- [12] Transactions sync ---
                // syncBudgetTransactionsToCloud returns the merged local+cloud set; every row
                // is re-stamped with this userId so nothing unowned survives the merge.
                if (results[12].status === 'fulfilled') {
                    const mergedTransactions = results[12].value;
                    const transactionsWithUserId: Transaction[] = mergedTransactions.map((t: any) => ({
                        ...t,
                        userId: userId,
                        type: t.type as TransactionType,
                        category: t.category || '',
                        description: t.description || ''
                    }));
                    setTransactions(transactionsWithUserId);
                }

                // Authoritative wallet balance (never from preferences cache / localStorage)
                if (!cancelled) {
                    try {
                        const wallet = await fetchBudgetWalletData();
                        setWalletBalance(wallet.walletBalance);
                        if (Array.isArray(wallet.savingsGoals)) setSavingsGoals(wallet.savingsGoals);
                        if (Array.isArray(wallet.expenseSplits)) setExpenseSplits(wallet.expenseSplits);
                    } catch (err) {
                        console.error('[Budget Sync] Failed to load wallet:', err);
                    }
                }

                // Mark bootstrap settled — per-domain status tracks individual failures
                if (shouldApplyBootstrap() && allBootstrapDomainsSettled(nextBootstrap)) {
                    setDataLoaded(true);
                }

            // Sync pending results (non-critical, fire-and-forget).
            // Gate on live store state (the render-scope array can be a stale
            // pre-purge snapshot of another user's queue).
            if (!cancelled && useTestStore.getState().pendingSyncResults.length > 0) {
                const localPending = useTestStore.getState().pendingSyncResults;
                const cloudFormatted = localPending.map(result => ({
                    id: result.id,
                    resultData: result,
                    createdAt: result.session?.endTime
                        ? new Date(result.session.endTime).toISOString()
                        : new Date().toISOString(),
                    synced: false,
                }));
                syncPendingResultsToCloud(currentUser.id, cloudFormatted).then((merged) => {
                    if (cancelled) return;
                    const mergedResults = merged
                        .filter(row => !row.synced)
                        .map(row => row.resultData);
                    setPendingSyncResults(mergedResults);
                    console.log('[Pending Results Sync] Synced');
                }).catch(error => {
                    console.error('[Pending Results Sync] Error:', error);
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, dataLoaded, isAuthLoading, authTokenReady, refreshDashboardGamification, setBootstrapLoad]);

    // Sync budget extras (goals, splits, category budgets) — never walletBalance (server-owned)
    // Re-runs whenever any of those three collections changes identity; the 1.5s timer is a
    // trailing debounce, so dragging a category slider produces one write, not one per frame.
    // Gated on dataLoaded so bootstrap's own hydration does not immediately echo back up.
    useEffect(() => {
        if (!currentUser?.id || !dataLoaded) return;
        const timer = setTimeout(() => {
            saveBudgetExtras(currentUser.id, {
                savingsGoals,
                expenseSplits,
                categoryBudgets: budget?.categoryBudgets,
            }).catch(console.error);
        }, 1500);
        return () => clearTimeout(timer);
    }, [currentUser?.id, dataLoaded, savingsGoals, expenseSplits, budget?.categoryBudgets]);

    // --- Real-time notifications subscription ---
    // Always on — duel/challenge alerts must work even in low-data mode.
    // Wait for authTokenReady so the Realtime socket has a JWT (RLS filters otherwise drop all events).
    // Re-runs on currentUser.id / authTokenReady / realtimeEpoch — the epoch is in the channel
    // name, so bumping it tears the old channel down and resubscribes with a fresh token.
    // INSERT dedupes by id (the same notification can arrive twice across a resubscribe);
    // challenge notifications are routed to the challenge handler, DM-ish ones trigger a
    // thread refresh so the chat list badge matches.
    useEffect(() => {
        if (!currentUser || !authTokenReady) return;

        const notificationsSubscription = supabase
            .channel(`notifications:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    if (import.meta.env.DEV) {
                      console.log('Real-time notification received');
                    }
                    const notifType = payload.new.type as string | undefined;
                    const newNotification = {
                        id: payload.new.id,
                        message: payload.new.message,
                        date: payload.new.date,
                        read: payload.new.read,
                        link: payload.new.link,
                        type: notifType,
                        data: payload.new.data ?? {},
                    };
                    updateNotifications(prev => {
                        if (prev.some(n => n.id === newNotification.id)) return prev;
                        return [newNotification, ...prev];
                    });
                    if (notifType?.startsWith('challenge')) {
                        const challengeId = (payload.new.data as { challengeId?: string } | null)?.challengeId;
                        if (challengeId && onChallengeNotification) {
                            onChallengeNotification(notifType, challengeId);
                        } else {
                            openModal('challenges');
                        }
                    } else if (
                        notifType === 'dm_message' ||
                        notifType === 'marketplace_inquiry' ||
                        (payload.new.link as string | undefined)?.startsWith('dm:')
                    ) {
                        // New DMs and marketplace contact-seller both need the chat list refreshed.
                        void refreshDmThreadsForUser(currentUser.id);
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    const updated = payload.new;
                    updateNotifications(prev => prev.map(n =>
                        n.id === updated.id
                            ? {
                                ...n,
                                read: updated.read,
                                message: updated.message,
                                link: updated.link,
                                type: updated.type,
                                data: updated.data ?? {},
                            }
                            : n
                    ));
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    const deletedId = payload.old.id as string;
                    updateNotifications(prev => prev.filter(n => n.id !== deletedId));
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(notificationsSubscription);
        };
    }, [currentUser?.id, authTokenReady, realtimeEpoch, updateNotifications, openModal, onChallengeNotification, refreshDmThreadsForUser, bumpRealtimeEpoch]);

    // Manual refresh hook (e.g. after contact-seller creates a DM thread)
    // Re-runs on currentUser.id; the window event is the escape hatch for code that creates
    // a thread through the API and cannot wait for the Realtime INSERT to arrive.
    useEffect(() => {
        if (!currentUser?.id) return;
        const onRefresh = () => {
            void refreshDmThreadsForUser(currentUser.id);
        };
        window.addEventListener('lantern:refresh-dm-threads', onRefresh);
        return () => window.removeEventListener('lantern:refresh-dm-threads', onRefresh);
    }, [currentUser?.id, refreshDmThreadsForUser]);

    // New / updated DM threads (contact-seller, first message, message requests).
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch — low-data
    // mode skips this channel entirely (notifications above stay on regardless).
    // The subscription is unfiltered, so membership is checked client-side against
    // participant_ids; both INSERT and UPDATE just trigger a full thread refetch.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const channel = supabase
            .channel(`dm-threads:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'dm_threads' },
                (payload) => {
                    const row = payload.new as { participant_ids?: unknown };
                    const participants = Array.isArray(row.participant_ids)
                        ? row.participant_ids.map(String)
                        : [];
                    if (!participants.includes(currentUser.id)) return;
                    void refreshDmThreadsForUser(currentUser.id);
                }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'dm_threads' },
                (payload) => {
                    const row = payload.new as { participant_ids?: unknown };
                    const participants = Array.isArray(row.participant_ids)
                        ? row.participant_ids.map(String)
                        : [];
                    if (!participants.includes(currentUser.id)) return;
                    void refreshDmThreadsForUser(currentUser.id);
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, refreshDmThreadsForUser, bumpRealtimeEpoch]);

    // Stable key for membership filtering (does not recreate the DM channel).
    // The ref is what the message handler reads, so the thread list can change without
    // tearing down and resubscribing the channel. Re-runs on the joined id string only.
    const dmThreadIdsKey = dmThreads.map((t) => t.id).sort().join(',');
    const dmThreadIdsRef = useRef(new Set<string>());
    useEffect(() => {
        dmThreadIdsRef.current = new Set(dmThreadIdsKey ? dmThreadIdsKey.split(',') : []);
    }, [dmThreadIdsKey]);

    // --- Real-time DM messages: one channel for all threads (RLS + client filter) ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Thread
    // membership is filtered through dmThreadIdsRef (a ref, so the channel is not recreated
    // per thread), and an EMPTY set is treated as "don't filter" — otherwise the first
    // message of a brand-new thread would be dropped before the list has loaded.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        // Reconciliation order for an INSERT, first match wins:
        //  1. same id already present → ignore (duplicate delivery across a resubscribe)
        //  2. a row whose id is this payload's client_message_id → promote it to the server
        //     id in place, so the optimistic bubble does not duplicate
        //  3. self-send with a matching optimistic row and NO client_message_id → ignore
        //  4. otherwise append
        // An UPDATE patches the row in place and also rewrites any reply preview pointing at
        // it, so edits/removals propagate into quoted previews.
        const applyDmChange = (
            payload: { new: Record<string, unknown> },
            isUpdate: boolean
        ) => {
            const raw = payload.new as {
                id: string;
                thread_id: string;
                sender_id: string;
                text: string;
                timestamp: string;
                edited_at?: string;
                removed_at?: string;
                client_message_id?: string;
                reply_to_message_id?: string;
                thread_root_id?: string;
            };
            const threadId = raw.thread_id;
            if (!threadId) return;
            const threadIds = dmThreadIdsRef.current;
            if (threadIds.size > 0 && !threadIds.has(threadId)) return;
            const viewingThisThread =
                useUIStore.getState().selectedChat?.chatType === 'dm' &&
                useUIStore.getState().selectedChat?.id === threadId;
            const message: DirectMessage = {
                id: raw.id,
                threadId,
                senderId: raw.sender_id,
                text: raw.removed_at ? '' : raw.text,
                timestamp: new Date(raw.timestamp),
                editedAt: raw.edited_at,
                removedAt: raw.removed_at,
                isRemoved: !!raw.removed_at,
                clientMessageId: raw.client_message_id,
                replyToMessageId: raw.reply_to_message_id,
                threadRootId: raw.thread_root_id,
                replyCount: 0,
            };
            updateDirectMessages(prev => {
                const existing = prev[threadId] || [];
                if (isUpdate) {
                    return {
                        ...prev,
                        [threadId]: existing.map((item) => {
                            const replyTo = item.replyTo?.id === message.id
                                ? {
                                    ...item.replyTo,
                                    text: message.isRemoved ? undefined : message.text,
                                    isRemoved: !!message.isRemoved,
                                }
                                : item.replyTo;
                            return item.id === message.id
                                ? { ...item, ...message, replyCount: item.replyCount, replyTo }
                                : { ...item, replyTo };
                        }),
                    };
                }
                if (existing.some(m => m.id === message.id)) return prev;
                // `matchesClientMessageId`, not `===`: the echo is the WIRE id (bare
                // UUID) while the optimistic row's id is `temp-<uuid>`.
                if (
                    raw.client_message_id &&
                    existing.some(m => matchesClientMessageId(m.id, raw.client_message_id))
                ) {
                    return {
                        ...prev,
                        [threadId]: existing.map(m =>
                            matchesClientMessageId(m.id, raw.client_message_id)
                                ? { ...m, ...message, id: message.id }
                                : m
                        ),
                    };
                }
                // Self-sends from this device are usually optimistic; still accept other-device echoes.
                if (raw.sender_id === currentUser.id) {
                    const hasOptimistic = existing.some(
                        (m) =>
                            m.senderId === currentUser.id &&
                            m.text === message.text &&
                            (m.id.startsWith('msg-') ||
                              m.id.startsWith('temp-') ||
                              m.id.startsWith('optimistic-') ||
                              m.id.startsWith('local-') ||
                              m.clientMessageId === m.id)
                    );
                    if (hasOptimistic && !raw.client_message_id) return prev;
                }
                return { ...prev, [threadId]: [...existing, message] };
            });

            // Thread-list side effects. An UPDATE re-derives the preview server-side, so it
            // just refetches; an INSERT patches preview/timestamp/unread locally. Unread only
            // increments for an incoming message while that thread is NOT on screen, and any
            // incoming message un-archives the thread.
            if (isUpdate) {
                void refreshDmThreadsForUser(currentUser.id);
                return;
            }
            updateDmThreads(prev => prev.map(t => {
                if (t.id !== threadId) return t;
                const isIncoming = raw.sender_id !== currentUser.id;
                return {
                    ...t,
                    lastMessage: raw.removed_at ? t.lastMessage : raw.text,
                    lastMessageTimestamp: new Date(raw.timestamp),
                    unreadCount:
                        isIncoming && !viewingThisThread
                            ? (t.unreadCount || 0) + 1
                            : t.unreadCount,
                    isArchived: isIncoming ? false : t.isArchived,
                };
            }));
        };

        const channel = supabase
            .channel(`dm-messages-all:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'dm_messages' },
                (payload) => applyDmChange(payload as { new: Record<string, unknown> }, false)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'dm_messages' },
                (payload) => applyDmChange(payload as { new: Record<string, unknown> }, true)
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [
        currentUser?.id,
        authTokenReady,
        lowDataMode,
        realtimeEpoch,
        refreshDmThreadsForUser,
        updateDirectMessages,
        updateDmThreads,
        bumpRealtimeEpoch,
    ]);

    // Same ref pattern as dmThreadIdsRef: joined-group ids for client-side filtering of the
    // unfiltered messages channel, updated without recreating that channel.
    const groupIdsKey = groups.map((g) => g.id).sort().join(',');
    const groupIdsRef = useRef(new Set<string>());
    useEffect(() => {
        groupIdsRef.current = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
    }, [groupIdsKey]);

    // --- Real-time group messages for all joined groups (so chat updates before/with notifications) ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch.
    // Realtime payloads are RAW table rows: no joined profile, so the sender is patched up
    // from the group roster (name/avatar/username only — the id always stays sender_id, an
    // auth user id, never a membership-row id).
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const applyIncoming = (payloadNew: Record<string, unknown>, isUpdate: boolean) => {
            const groupId = String(payloadNew.group_id || '');
            if (!groupId) return;
            const groupIds = groupIdsRef.current;
            if (groupIds.size > 0 && !groupIds.has(groupId)) return;

            const mapped = mapMessageFromApi(payloadNew);
            const raw = payloadNew as {
                sender_id?: string;
                client_message_id?: string;
                content?: string;
                text?: string;
            };
            const rosterMember = useGroupStore
                .getState()
                .groups.find((g) => g.id === groupId)
                ?.members?.find(
                    (m) => m.id === raw.sender_id || (m as { userId?: string }).userId === raw.sender_id
                );
            if (
                rosterMember &&
                (!mapped.sender?.username ||
                    mapped.sender.name === 'Member' ||
                    mapped.sender.name === 'Unknown' ||
                    !mapped.sender?.avatarUrl)
            ) {
                mapped.sender = {
                    ...mapped.sender,
                    ...rosterMember,
                    // Keep auth user id — never replace with a membership-row id from roster.
                    id: raw.sender_id || mapped.sender?.id || rosterMember.id || 'unknown',
                    avatarUrl: mapped.sender?.avatarUrl || rosterMember.avatarUrl,
                    username: mapped.sender?.username || rosterMember.username,
                    name:
                      mapped.sender?.name &&
                      mapped.sender.name !== 'Member' &&
                      mapped.sender.name !== 'Unknown'
                        ? mapped.sender.name
                        : rosterMember.name || mapped.sender?.name || 'Member',
                };
            }
            // Realtime payloads omit nested profiles — still stamp sender.id from sender_id.
            if ((!mapped.sender?.id || mapped.sender.id === 'unknown') && raw.sender_id) {
                mapped.sender = {
                    ...(mapped.sender || {
                        name: 'Member',
                        points: 0,
                        badges: [],
                        stats: {} as any,
                    }),
                    id: raw.sender_id,
                };
            }

            // Question-message normaliser. A realtime row often omits the question payload,
            // so each field is kept from the previous copy when the incoming one is empty.
            // `questionType` is the field that carries the REAL question kind (`type` is just
            // the MessageType, 'QUESTION'); losing it renders a question with no options.
            const mergeQuestionMessage = (prevMsg: typeof mapped, nextMsg: typeof mapped) => {
                const merged = { ...prevMsg, ...nextMsg };
                // Never clobber a full local/question payload with empty remap fields.
                if ((!nextMsg.options || nextMsg.options.length === 0) && prevMsg.options?.length) {
                    merged.options = prevMsg.options;
                }
                if (
                    (!nextMsg.correctAnswerIds || nextMsg.correctAnswerIds.length === 0) &&
                    prevMsg.correctAnswerIds?.length
                ) {
                    merged.correctAnswerIds = prevMsg.correctAnswerIds;
                }
                if (!nextMsg.questionStem && prevMsg.questionStem) {
                    merged.questionStem = prevMsg.questionStem;
                }
                if (!nextMsg.questionType && prevMsg.questionType) {
                    merged.questionType = prevMsg.questionType;
                }
                if (!nextMsg.questionStatus && prevMsg.questionStatus) {
                    merged.questionStatus = prevMsg.questionStatus;
                }
                return merged;
            };

            // Same reconciliation ladder as the DM path: known id → merge; own send matched
            // by client_message_id → promote the optimistic row to the server id; own send
            // matched only by identical text → drop the echo; otherwise append.
            // An UPDATE for an unknown id is ignored rather than appended — a message the
            // cache never had must arrive through a fetch, not an edit event.
            updateMessages((prev) => {
                const existing = prev[groupId] || [];
                if (isUpdate) {
                    const idx = existing.findIndex((m) => m.id === mapped.id);
                    if (idx === -1) return prev;
                    const updated = [...existing];
                    updated[idx] = mergeQuestionMessage(updated[idx], mapped);
                    const withUpdatedPreviews = updated.map((message) =>
                        message.replyTo?.id === mapped.id
                            ? {
                                ...message,
                                replyTo: {
                                    ...message.replyTo,
                                    text: mapped.isRemoved ? undefined : mapped.text,
                                    questionStem: mapped.isRemoved
                                        ? undefined
                                        : mapped.questionStem,
                                    isRemoved: !!mapped.isRemoved,
                                },
                            }
                            : message
                    );
                    return { ...prev, [groupId]: withUpdatedPreviews };
                }
                if (existing.some((m) => m.id === mapped.id)) {
                    return {
                        ...prev,
                        [groupId]: existing.map((m) =>
                            m.id === mapped.id ? mergeQuestionMessage(m, mapped) : m
                        ),
                    };
                }
                if (raw.sender_id === currentUser.id) {
                    const clientMessageId = raw.client_message_id;
                    // `matchesClientMessageId`, not `===`: the echo is the WIRE id
                    // (bare UUID) while the optimistic row's id is `temp-<uuid>`.
                    if (
                        clientMessageId &&
                        existing.some((m) => matchesClientMessageId(m.id, clientMessageId))
                    ) {
                        return {
                            ...prev,
                            [groupId]: existing.map((m) =>
                                matchesClientMessageId(m.id, clientMessageId)
                                    ? {
                                        ...m,
                                        ...mapped,
                                        id: mapped.id,
                                        sender: mapped.sender?.id ? mapped.sender : m.sender,
                                      }
                                    : m
                            ),
                        };
                    }
                    const rawContent = raw.content || raw.text || mapped.text || '';
                    const hasOptimistic = existing.some(
                        (m) =>
                            m.sender?.id === currentUser.id &&
                            m.text === rawContent &&
                            m.id !== mapped.id
                    );
                    if (hasOptimistic) return prev;
                }
                return { ...prev, [groupId]: [...existing, mapped] };
            });

            // Sidebar preview + unread badge. On an UPDATE the preview is re-derived from the
            // newest still-visible message (an edit can be a deletion, which must not leave
            // removed text in the preview); on an INSERT the new message is the preview.
            const latestVisible = isUpdate
                ? [...(useGroupStore.getState().messages[groupId] || [])]
                    .reverse()
                    .find((message) =>
                        !message.isRemoved && !message.removedAt && !message.isArchived
                    )
                : mapped;
            const isIncoming =
                !isUpdate && !!raw.sender_id && raw.sender_id !== currentUser.id;
            const viewingThisGroup =
                useUIStore.getState().selectedChat?.chatType === 'group' &&
                useUIStore.getState().selectedChat?.id === groupId;
            useGroupStore.getState().updateGroups((prev) =>
                prev.map((g) =>
                    g.id === groupId
                        ? {
                            ...g,
                            lastMessage:
                                latestVisible?.text ||
                                latestVisible?.questionStem ||
                                undefined,
                            lastMessageTime:
                                latestVisible?.timestamp instanceof Date
                                    ? latestVisible.timestamp.toISOString()
                                    : latestVisible
                                      ? g.lastMessageTime
                                      : undefined,
                            // Realtime previously only refreshed the preview — badges stayed stale until reload.
                            unreadCount:
                                isIncoming && !viewingThisGroup
                                    ? (g.unreadCount || 0) + 1
                                    : g.unreadCount,
                            isArchived: isIncoming ? false : g.isArchived,
                          }
                        : g
                )
            );
        };

        const channel = supabase
            .channel(`group-messages-all:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => applyIncoming(payload.new as Record<string, unknown>, false)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages' },
                (payload) => applyIncoming(payload.new as Record<string, unknown>, true)
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateMessages, bumpRealtimeEpoch]);

    // --- Recover missed chat/note events after tab sleep or reconnect ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode; fires on tab becoming visible
    // and on the browser 'online' event, because a socket that slept has a gap no event will
    // ever fill. Bumps the realtime epoch (fresh channels + JWT), refreshes DM threads and
    // notes, then re-fetches only the chat currently on screen.
    useEffect(() => {
        if (!currentUser || !authTokenReady) return;

        const recoverOpenSurfaces = async () => {
            bumpRealtimeEpoch();
            void refreshDmThreadsForUser(currentUser.id);
            void useNotesStore.getState().loadNotes().catch(() => {});

            const chat = useUIStore.getState().selectedChat;
            if (!chat || lowDataMode) return;

            try {
                if (chat.chatType === 'group') {
                    const limit = lowDataMode ? 20 : 50;
                    const fetched = await fetchMessages(chat.id, undefined, limit);
                    const list = (Array.isArray(fetched) ? fetched : [])
                        .map((item) => {
                            try {
                                return mapMessageFromApi(item);
                            } catch {
                                return null;
                            }
                        })
                        .filter((message): message is NonNullable<typeof message> => message != null)
                        .map((message) => ({
                            ...message,
                            clientMessageId:
                                (message as { clientMessageId?: string }).clientMessageId,
                        }));
                    // mergeChatMessagesById is INCOMING-WINS, so the server list MUST be the
                    // second argument: that makes the refresh server-wins per id while
                    // keeping local-only (pending/failed) rows. Swapping the arguments lets
                    // the cached copy clobber fresh server rows — reactions and edits would
                    // silently disappear after a cold start.
                    updateMessages((prev) => ({
                        ...prev,
                        [chat.id]: mergeChatMessagesById(prev[chat.id] || [], list as any),
                    }));
                } else if (chat.chatType === 'dm') {
                    const otherUserId = Array.isArray((chat as { participantIds?: string[] }).participantIds)
                        ? (chat as { participantIds: string[] }).participantIds.find((id) => id !== currentUser.id)
                        : undefined;
                    if (!otherUserId) return;
                    const fetched = await fetchDirectMessages(currentUser.id, otherUserId);
                    // DM normaliser: the REST payload can come back in either camelCase or
                    // snake_case depending on the endpoint, so every field is read both ways.
                    // Same server-wins merge order as the group branch above.
                    const mapped: DirectMessage[] = (Array.isArray(fetched) ? fetched : []).map((raw: any) => ({
                        id: raw.id,
                        threadId: raw.threadId || raw.thread_id || chat.id,
                        senderId: raw.senderId || raw.sender_id,
                        text: raw.isRemoved || raw.removed_at ? '' : raw.text || '',
                        timestamp: new Date(raw.timestamp),
                        editedAt: raw.editedAt || raw.edited_at,
                        removedAt: raw.removedAt || raw.removed_at,
                        isRemoved: raw.isRemoved || !!raw.removed_at,
                        replyToMessageId: raw.replyToMessageId || raw.reply_to_message_id,
                        threadRootId: raw.threadRootId || raw.thread_root_id,
                        replyCount: typeof raw.replyCount === 'number' ? raw.replyCount : raw.reply_count,
                        clientMessageId: raw.clientMessageId || raw.client_message_id,
                    }));
                    updateDirectMessages((prev) => ({
                        ...prev,
                        [chat.id]: mergeChatMessagesById(prev[chat.id] || [], mapped as any) as DirectMessage[],
                    }));
                }
            } catch (err) {
                console.warn('[Realtime] Foreground chat recovery failed:', err);
            }

            const selectedNote = useNotesStore.getState().selectedNote;
            if (selectedNote?.id) {
                void useNotesStore.getState().loadComments(selectedNote.id).catch(() => {});
                void useNotesStore.getState().loadNote(selectedNote.id).catch(() => {});
            }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                void recoverOpenSurfaces();
            }
        };
        const onOnline = () => {
            void recoverOpenSurfaces();
        };

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', onOnline);
        };
    }, [
        currentUser?.id,
        authTokenReady,
        lowDataMode,
        bumpRealtimeEpoch,
        refreshDmThreadsForUser,
        updateMessages,
        updateDirectMessages,
    ]);

    // Notes list / collaborator content — pick up shares and remote edits without full reload.
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. The channel
    // is wide (every notes / note_collaborators change reaches it, RLS decides what is
    // visible), so handlers do not inspect payloads at all — they schedule one debounced
    // (400 ms) reload of the list plus the open note, collapsing bursts of edits.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        let notesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleNotesRefresh = () => {
            if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
            notesRefreshTimer = setTimeout(() => {
                void useNotesStore.getState().loadNotes().catch(() => {});
                const selected = useNotesStore.getState().selectedNote;
                if (selected?.id) {
                    void useNotesStore.getState().loadNote(selected.id).catch(() => {});
                }
            }, 400);
        };

        const channel = supabase
            .channel(`notes-access:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notes' },
                () => {
                    scheduleNotesRefresh();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'note_collaborators' },
                () => {
                    scheduleNotesRefresh();
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]);

    // --- Real-time profile updates subscription ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Filtered to
    // this user's own row, so it carries changes made on another device or by the server
    // (points, badges, avatar). The handler re-reads the store and id-checks before writing.
    // FIXED (F9): this path used to write `stats` and `settings` STRAIGHT from
    // the raw DB row, bypassing the `mapUserStatsFromApi` / `normalizeUserSettings`
    // pair every other entry point uses (see the bootstrap at :392). A profile
    // UPDATE therefore replaced the normalised settings with raw snake_case JSON
    // and the mapped stats with unmapped columns — stats read as zero and
    // settings-derived UI fell back to defaults until the next full profile
    // fetch. Both now go through the same mappers the bootstrap does.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const profileSubscription = supabase
            .channel(`profile:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${currentUser.id}`
                },
                (payload) => {
                    if (import.meta.env.DEV) {
                      console.log('Real-time profile update received');
                    }
                    const updatedProfile = payload.new;
                    const prev = useAuthStore.getState().currentUser;
                    if (!prev || prev.id !== updatedProfile.id) return;
                    setCurrentUser({
                        ...prev,
                        name: updatedProfile.name,
                        avatarUrl: updatedProfile.avatar_url,
                        phoneNumber: updatedProfile.phone,
                        points: updatedProfile.points || 0,
                        badges: updatedProfile.badges || [],
                        stats: updatedProfile.stats
                            ? mapUserStatsFromApi(updatedProfile.stats)
                            : initialUserStats,
                        settings: normalizeUserSettings(updatedProfile.settings),
                    });
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(profileSubscription);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]);

    // --- Real-time group membership subscription ---
    // Keeps the groups list in sync when the user is added to / removed from groups
    // without requiring a full page refresh or manual re-fetch.
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Any change to
    // this user's group_members rows triggers a full groups refetch — the payload alone does
    // not carry enough to patch the list. The row mapping MUST stay field-for-field in step
    // with the bootstrap mapping above, and falls back to the existing row for anything the
    // list endpoint omits.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const groupMembershipSubscription = supabase
            .channel(`group_members:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'group_members',
                    filter: `user_id=eq.${currentUser.id}`,
                },
                async () => {
                    // Membership changed — re-fetch the full groups list so the sidebar
                    // reflects the join / leave immediately.
                    try {
                        const [freshGroups, unreadCounts] = await Promise.all([
                            fetchGroups(currentUser.id),
                            fetchGroupUnreadCounts(currentUser.id).catch(
                                () => ({} as Record<string, number>)
                            ),
                        ]);
                        // Same merge as the bootstrap load above — carrying the
                        // community fields over is what stops a refresh from
                        // emptying the community column right after joining a
                        // channel, and `mergeFetchedGroups` now also carries
                        // `communitySurface`, which both inline copies dropped.
                        updateGroups((prev) => mergeFetchedGroups(freshGroups, prev, unreadCounts));
                    } catch (err) {
                        console.error('[Group membership] Real-time refresh failed:', err);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(groupMembershipSubscription);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateGroups, bumpRealtimeEpoch]);

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
