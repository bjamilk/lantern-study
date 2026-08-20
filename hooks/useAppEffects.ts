import { useEffect, useCallback, useState, useRef, type Dispatch, type SetStateAction } from 'react';
import { AppMode, OfflineSessionBundle, TransactionType, Transaction, User } from '../types';
import { useAuthStore } from '../stores/authStore';
import { reportUnexpectedSignOut } from '../services/sentry';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUIStore } from '../stores/uiStore';
import { useNotesStore } from '../stores/notesStore';
import { initialUserStats } from '../utils/helpers';
import { resolvePlatformAdmin } from '../utils/platformAdmin';
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
    fetchPendingSyncResults, savePendingSyncResult,
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
import { normalizeUserSettings, getNotificationSettings } from '@lantern/shared/settings';
import { mapMessageFromApi, computeStudyStreak, getCardsDue, mergeChatMessagesById } from '@lantern/shared/utils';
import { mapUserStatsFromApi, normalizeTestPresets } from '@lantern/shared/utils/apiMappers';
import { applyUserSettingsToDom } from '../utils/applyUserSettingsToDom';
import { fetchStudyActivity, fetchDailyQuests, recordLoginStreak, syncGamificationProgress } from '../services/gamificationStreak';
import { saveBudgetExtras } from '../services/budgetExtrasSync';
import { normalizeMonthlyPlans, readPlanForMonth } from '@lantern/shared/utils';
import { fetchBudgetWalletData } from '../services/budgetApi';
import { useDailyStudyReminder } from './useDailyStudyReminder';
import { DirectMessage } from '../types';
import {
  beginSrsWebReminderSend,
  getWebNotificationPermission,
  markSrsWebReminderSent,
  onWebNotificationClick,
  requestWebNotificationPermission,
  shouldSendSrsWebReminder,
  showWebNotification,
} from '../utils/webNotifications';
import { syncPendingFlashcardReviews } from '../services/offlineFlashcardSync';
import { syncPendingTestResults } from '../services/offlineTestSync';
import { useToastStore } from '../stores/toastStore';
import {
  INITIAL_BOOTSTRAP_LOAD_STATE,
  type BootstrapLoadState,
} from './useAuthHandlers';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../utils/dmThreads';
import { isAccessTokenFreshEnough, shouldRestorePersistedAuthUser } from '../utils/authBootstrap';
import { resetSessionExpiredGuard } from '../services/sessionHandler';
import {
    sendPresenceHeartbeat,
    shouldRunPresenceHeartbeat,
} from '../services/presenceHeartbeat';

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
        offlineBundles, setOfflineBundles,
        pendingSyncResults, setPendingSyncResults,
        setTestResults, setUserQuestionStats,
        setStudyActivityDays,
    } = useTestStore();
    const {
        decks, setDecks,
        flashcards, setFlashcards,
        dueCardsCount, setDueCardsCount
    } = useFlashcardStore();
    const { transactions, setTransactions, budget, setBudget, savingsGoals, expenseSplits, walletBalance, setSavingsGoals, setExpenseSplits, setWalletBalance } = useBudgetStore();
    const {
        theme, setTheme, setAppMode,
        openModal, lowDataMode, setLowDataMode,
        selectedChat,
        isOnline,
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
    // Gate on authTokenReady (same as lifecycle / paused sessions / gamification)
    // so guest + stale-session landings never POST /presence/heartbeat.
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

    // --- Restore session on app load ---
    useEffect(() => {
        let isMounted = true;

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
        });

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

        const syncSessionInBackground = async (hadFastBoot: boolean) => {
            try {
                const resolved = await resolveClientSession();
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
                        const userName =
                            authUser.user_metadata?.name ||
                            authUser.email?.split('@')[0] ||
                            'User';
                        try {
                            const newProfile = await createUserProfile({
                                id: session.user.id,
                                name: userName,
                                phone: undefined,
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
        if (!hadFastBoot) setAuthTokenReady(false);
        void syncSessionInBackground(hadFastBoot);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT') {
                // Fires for clicked logouts and for sessions that died under the
                // user (refresh-token 400s) alike; the reporter separates them.
                reportUnexpectedSignOut({
                    hadUser: Boolean(useAuthStore.getState().currentUser),
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
    useEffect(() => {
        if (!currentUser || isAuthLoading || authTokenReady) return;
        void ensureAuthTokenReady().then((ready) => {
            if (ready) setAuthTokenReady(true);
        });
    }, [currentUser?.id, isAuthLoading, authTokenReady]);

    // --- Theme / appearance DOM sync (not privacy/study — avoids re-render storms while Settings is open) ---
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

    // --- Username check ---
    useEffect(() => {
        if (currentUser && !currentUser.username) {
            openModal('usernameRequired');
        }
    }, [currentUser?.id, currentUser?.username]);

    // --- Data loading ---
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
                if (groupsResult.status === 'fulfilled') {
                    const fetchedGroups = groupsResult.value;
                    const unreadCounts = unreadResult.status === 'fulfilled' ? unreadResult.value : {};
                    updateGroups((prev) => {
                        const prevById = new Map(prev.map((g) => [g.id, g]));
                        return fetchedGroups.map((g: any) => {
                            const existing = prevById.get(g.id);
                            return {
                                id: g.id,
                                name: g.name,
                                avatarUrl: g.avatar_url || g.avatarUrl,
                                description: g.description,
                                lastMessage: g.last_message || g.lastMessage,
                                lastMessageTime: g.last_message_time || g.lastMessageTime,
                                adminIds: g.admin_ids || g.adminIds || [],
                                permissions: g.permissions || {},
                                parentId: g.parent_id || g.parentId,
                                isArchived: g.is_archived ?? g.isArchived ?? false,
                                inviteId: g.invite_id || g.inviteId,
                                unreadCount: unreadCounts[g.id] || 0,
                                pendingMembers: existing?.pendingMembers || [],
                                invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
                                members: existing?.members?.length ? existing.members : [],
                            };
                        });
                    });
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
                void useNotesStore.getState().loadFolders();
                void useNotesStore.getState().loadNotes();

                if (flashcardsResult.status === 'fulfilled') {
                    // Already normalized via fetchAllFlashcards → mapFlashcardsFromApi
                    setFlashcards(flashcardsResult.value);
                }

                // --- [6] Test results ---
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

            // Sync pending results (non-critical, fire-and-forget)
            if (!cancelled && pendingSyncResults.length > 0) {
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
    useEffect(() => {
        if (!currentUser?.id) return;
        const onRefresh = () => {
            void refreshDmThreadsForUser(currentUser.id);
        };
        window.addEventListener('lantern:refresh-dm-threads', onRefresh);
        return () => window.removeEventListener('lantern:refresh-dm-threads', onRefresh);
    }, [currentUser?.id, refreshDmThreadsForUser]);

    // New / updated DM threads (contact-seller, first message, message requests).
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
    const dmThreadIdsKey = dmThreads.map((t) => t.id).sort().join(',');
    const dmThreadIdsRef = useRef(new Set<string>());
    useEffect(() => {
        dmThreadIdsRef.current = new Set(dmThreadIdsKey ? dmThreadIdsKey.split(',') : []);
    }, [dmThreadIdsKey]);

    // --- Real-time DM messages: one channel for all threads (RLS + client filter) ---
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

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
                if (raw.client_message_id && existing.some(m => m.id === raw.client_message_id)) {
                    return {
                        ...prev,
                        [threadId]: existing.map(m =>
                            m.id === raw.client_message_id
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

    const groupIdsKey = groups.map((g) => g.id).sort().join(',');
    const groupIdsRef = useRef(new Set<string>());
    useEffect(() => {
        groupIdsRef.current = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
    }, [groupIdsKey]);

    // --- Real-time group messages for all joined groups (so chat updates before/with notifications) ---
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
                    if (clientMessageId && existing.some((m) => m.id === clientMessageId)) {
                        return {
                            ...prev,
                            [groupId]: existing.map((m) =>
                                m.id === clientMessageId
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
                        stats: updatedProfile.stats || initialUserStats,
                        settings: updatedProfile.settings || {},
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
                        updateGroups((prev) => {
                            const prevById = new Map(prev.map((g) => [g.id, g]));
                            return freshGroups.map((g: any) => {
                                const existing = prevById.get(g.id);
                                return {
                                    id: g.id,
                                    name: g.name,
                                    avatarUrl: g.avatar_url || g.avatarUrl,
                                    description: g.description,
                                    lastMessage: g.last_message || g.lastMessage,
                                    lastMessageTime: g.last_message_time || g.lastMessageTime,
                                    adminIds: g.admin_ids || g.adminIds || [],
                                    permissions: g.permissions || {},
                                    parentId: g.parent_id || g.parentId,
                                    isArchived: g.is_archived ?? g.isArchived ?? false,
                                    inviteId: g.invite_id || g.inviteId,
                                    unreadCount: unreadCounts[g.id] || 0,
                                    pendingMembers: existing?.pendingMembers || [],
                                    invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
                                    // Keep loaded member rosters so @mentions keep working.
                                    members: existing?.members?.length ? existing.members : [],
                                };
                            });
                        });
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

    // --- Persist offline data ---
    useEffect(() => {
        localStorage.setItem('offlineBundles', JSON.stringify(offlineBundles));
    }, [offlineBundles]);

    useEffect(() => {
        localStorage.setItem('pendingSyncResults', JSON.stringify(pendingSyncResults));
        if (currentUser && pendingSyncResults.length > 0) {
            pendingSyncResults.forEach(result => {
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

    // --- Theme sync to DOM (signed-out visitors always see light — landing & auth) ---
    useEffect(() => {
        const effectiveTheme = currentUser ? theme : 'light';
        if (effectiveTheme === 'dark') {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            if (currentUser) {
                localStorage.setItem('theme', 'light');
            }
        }
    }, [theme, currentUser]);

    // --- SRS Notifications ---
    // Use shared isCardDue once — do not add "new" + "date-due" (double-counts Again/new cards).
    // OS toasts only when the tab is in the background and throttled — studying notes/flashcards
    // must not keep popping "cards due" notifications.
    const srsRemindersEnabled = Boolean(
        currentUser &&
            getNotificationSettings(normalizeUserSettings(currentUser.settings)).srsReminders
    );
    const srsUserId = currentUser?.id ?? null;

    const checkForDueCardsAndNotify = useCallback(() => {
        if (!srsUserId || !srsRemindersEnabled) return;
        const cards = useFlashcardStore.getState().flashcards;
        if (!cards.length) return;

        const totalDue = getCardsDue(cards).length;
        if (getWebNotificationPermission() !== 'granted') return;
        if (!shouldSendSrsWebReminder(totalDue, Date.now(), srsUserId)) return;
        // Claim + persist before the async show path so remount / visibility churn cannot spam.
        if (!beginSrsWebReminderSend(srsUserId)) return;
        markSrsWebReminderSent(totalDue, Date.now(), srsUserId);

        void showWebNotification({
            title: 'Flashcard Review Due',
            body: `You have ${totalDue} flashcards ready for review.`,
            icon: '/favicon.ico',
            tag: 'srs-reminder',
            data: { navigate: 'flashcards' },
            onClick: () => {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
            },
        });
    }, [srsUserId, srsRemindersEnabled, setAppMode]);

    useEffect(() => {
        return onWebNotificationClick((data) => {
            if (data.navigate === 'flashcards') {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
            }
        });
    }, [setAppMode]);

    // Keep due-count badge in sync without notifying on every card review.
    useEffect(() => {
        if (!currentUser || !flashcards.length) return;
        setDueCardsCount(getCardsDue(flashcards).length);
    }, [currentUser?.id, flashcards, setDueCardsCount]);

    useEffect(() => {
        if (!srsUserId) return;

        // Ask once when permission is still undecided.
        if (getWebNotificationPermission() === 'default') {
            void requestWebNotificationPermission();
        }

        const maybeNotify = () => {
            checkForDueCardsAndNotify();
        };

        // Initial check (no-ops while tab visible).
        maybeNotify();

        const onVisibility = () => {
            // When the user leaves the tab, consider a background reminder.
            if (document.visibilityState === 'hidden') {
                maybeNotify();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        if (lowDataMode) {
            return () => document.removeEventListener('visibilitychange', onVisibility);
        }

        const interval = setInterval(maybeNotify, 60 * 60 * 1000);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [srsUserId, checkForDueCardsAndNotify, lowDataMode]);
    // Auto-sync queued flashcard reviews when back online
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

    return {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
        authTokenReady,
    };
}
