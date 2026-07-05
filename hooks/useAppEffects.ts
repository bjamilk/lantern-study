import { useEffect, useCallback, useState } from 'react';
import { AppMode, OfflineSessionBundle, TransactionType, Transaction, User } from '../types';
import { useAuthStore } from '../stores/authStore';
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
    fetchDecks, fetchFlashcards,
    fetchTestResults, fetchUserQuestionStats,
    fetchNotifications,
    fetchGroupUnreadCounts, fetchDMUnreadCounts, fetchDmThreads,
    fetchOfflineBundles,
    fetchUserPreferences, saveUserPreferences,
    fetchUserBudget, saveUserBudget,
    syncBudgetTransactionsToCloud,
    fetchPendingSyncResults, savePendingSyncResult,
    markAllNotificationsAsRead, deleteAllNotifications,
    fetchUserProfile, createUserProfile,
    fetchUserSettings,
    ensureAuthTokenReady,
    bootstrapAuthFromStorage,
    readPersistedAuthUser,
    shouldRefreshStoredSession,
    sendPresenceHeartbeat,
} from '../services/supabase';
import { normalizeUserSettings, getNotificationSettings } from '@lantern/shared/settings';
import { applyUserSettingsToDom } from '../utils/applyUserSettingsToDom';
import { fetchStudyActivity, fetchDailyQuests, recordLoginStreak, syncGamificationProgress } from '../services/gamificationStreak';
import { saveBudgetExtras } from '../services/budgetExtrasSync';
import { fetchBudgetWalletData } from '../services/budgetApi';
import { useDailyStudyReminder } from './useDailyStudyReminder';
import { DirectMessage } from '../types';
import {
  onWebNotificationClick,
  requestWebNotificationPermission,
  showWebNotification,
} from '../utils/webNotifications';

function mapFetchedDmThreads(fetched: any[], dmUnreadCounts: Record<string, number>) {
    return fetched.map((t: any) => ({
        id: t.id,
        participantIds: t.participantIds || t.participant_ids || [],
        participants: t.participants || {},
        lastMessage: t.lastMessage || t.last_message,
        lastMessageTimestamp: t.lastMessageTimestamp || t.last_message_time,
        unreadCount: dmUnreadCounts[t.id] || 0,
        isArchived: t.isArchived || false,
    }));
}

interface UseAppEffectsParams {
    dataLoaded: boolean;
    setDataLoaded: (v: boolean) => void;
    onChallengeNotification?: (type: string, challengeId: string) => void;
}

export function useAppEffects({ dataLoaded, setDataLoaded, onChallengeNotification }: UseAppEffectsParams) {
    const { currentUser, setCurrentUser, setAuthLoading, isAuthLoading, setPasswordRecovery } = useAuthStore();
    const [authTokenReady, setAuthTokenReady] = useState(() => bootstrapAuthFromStorage() !== null);
    const {
        groups, setGroups, updateGroups,
        dmThreads, setDmThreads, updateDmThreads,
        setAllMessages,
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
        openModal, lowDataMode, setLowDataMode
    } = useUIStore();

    const [dailyQuests, setDailyQuests] = useState<any[]>([]);
    const [serverStreak, setServerStreak] = useState(0);
    const [streakFreezes, setStreakFreezes] = useState(0);
    const [questsLoaded, setQuestsLoaded] = useState(false);

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
            setStudyActivityDays(Array.isArray(results[2].value) ? results[2].value : []);
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

    const refreshDmThreadsForUser = useCallback(async (userId: string) => {
        const [fetchedThreads, dmUnreadCounts] = await Promise.all([
            fetchDmThreads(userId),
            fetchDMUnreadCounts(userId).catch(() => ({} as Record<string, number>)),
        ]);
        if (Array.isArray(fetchedThreads)) {
            setDmThreads(mapFetchedDmThreads(fetchedThreads, dmUnreadCounts));
        }
    }, [setDmThreads]);

    // --- Presence heartbeat for online status ---
    useEffect(() => {
        if (!currentUser?.id || !normalizeUserSettings(currentUser.settings).privacy.showOnlineStatus) {
            return;
        }
        void sendPresenceHeartbeat();
        const interval = setInterval(() => void sendPresenceHeartbeat(), 2 * 60 * 1000);
        return () => clearInterval(interval);
    }, [currentUser?.id, currentUser?.settings]);

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
            avatarUrl: (profile.avatar_url as string) || '',
            email,
            password: '',
            phoneNumber: (profile.phone as string) || '',
            points: (profile.points as number) || 0,
            badges: (profile.badges as User['badges']) || [],
            stats: (profile.stats as User['stats']) || {},
            settings: normalizeUserSettings(profile.settings),
            username: (profile.username as string) || undefined,
            firstName: (profile.first_name as string) || undefined,
            lastName: (profile.last_name as string) || undefined,
            isAdmin: resolvePlatformAdmin(authUser, profile.settings as Record<string, unknown>),
        });

        const applyFastBoot = (): boolean => {
            const boot = bootstrapAuthFromStorage();
            if (!boot) return false;

            let user = useAuthStore.getState().currentUser;
            if (!user) {
                const persisted = readPersistedAuthUser();
                if (persisted?.id === boot.userId) {
                    user = persisted as unknown as User;
                    setCurrentUser(user);
                }
            }
            if (!user || user.id !== boot.userId) return false;

            setAuthTokenReady(true);
            setAuthLoading(false);
            return true;
        };

        const syncSessionInBackground = async (hadFastBoot: boolean) => {
            try {
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (!isMounted) return;

                if (sessionError) {
                    console.error('[Auth] getSession error:', sessionError);
                }

                if (!session?.user) {
                    if (hadFastBoot || useAuthStore.getState().currentUser) {
                        console.warn('[Auth] No active session — clearing stale cached user');
                        await supabase.auth.signOut();
                        setCurrentUser(null);
                        setAuthTokenReady(false);
                    }
                    setAuthLoading(false);
                    return;
                }

                if (session.access_token) {
                    setCachedAuthToken(session.access_token, session.user.id);
                    setAuthTokenReady(true);
                }

                let authUser = session.user;
                if (shouldRefreshStoredSession()) {
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

                if (!hadFastBoot) {
                    if (cached && cached.id === session.user.id) {
                        setCurrentUser({
                            ...cached,
                            email: authUser.email || cached.email,
                            isAdmin: resolvePlatformAdmin(
                                authUser,
                                cached.settings as Record<string, unknown>
                            ),
                        });
                        setAuthLoading(false);
                    }
                } else if (cached && cached.id === session.user.id) {
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
                        if (!hadFastBoot && !useAuthStore.getState().currentUser) {
                            setAuthLoading(false);
                        }
                        return;
                    }

                    const isBanned =
                        profile.settings?.is_banned === true ||
                        profile.settings?.account_status === 'banned';
                    if (isBanned) {
                        await supabase.auth.signOut();
                        if (isMounted) {
                            setCurrentUser(null);
                            setAuthTokenReady(false);
                            setAuthLoading(false);
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
                    } else if (!hadFastBoot) {
                        console.warn('[Auth] Profile fetch failed:', profileErr.message);
                    }
                }

                if (!hadFastBoot) {
                    const hasToken = await ensureAuthTokenReady();
                    if (!hasToken && useAuthStore.getState().currentUser) {
                        await supabase.auth.signOut();
                        if (isMounted) {
                            setCurrentUser(null);
                            setAuthTokenReady(false);
                        }
                    }
                    if (isMounted) setAuthLoading(false);
                }
            } catch (error: any) {
                console.log('Session validation failed:', error.message);
                const isConnectionError =
                    error.message?.includes('timeout') ||
                    error.message?.includes('Fetch') ||
                    error.message?.includes('Network');
                if (!isConnectionError && !hadFastBoot) {
                    Object.keys(localStorage).forEach((key) => {
                        if (
                            key.startsWith('sb-') ||
                            key.includes('supabase') ||
                            key === 'auth-storage' ||
                            key === 'auth-storage-v2'
                        ) {
                            localStorage.removeItem(key);
                        }
                    });
                    try {
                        await supabase.auth.signOut();
                    } catch {
                        // ignore
                    }
                    if (isMounted) {
                        setCurrentUser(null);
                        setAuthTokenReady(false);
                    }
                }
                if (isMounted) setAuthLoading(false);
            }
        };

        const hadFastBoot = applyFastBoot();
        if (!hadFastBoot) setAuthTokenReady(false);
        void syncSessionInBackground(hadFastBoot);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT') {
                setAuthTokenReady(false);
                setPasswordRecovery(false);
                const store = useAuthStore.getState();
                if (!store.isAuthLoading) {
                    setCurrentUser(null);
                    setDataLoaded(false);
                }
            } else if (event === 'PASSWORD_RECOVERY') {
                if (session?.access_token) {
                    setCachedAuthToken(session.access_token, session.user?.id);
                    setAuthTokenReady(true);
                }
                setPasswordRecovery(true);
            } else if (event === 'SIGNED_IN' && session?.user) {
                if (useAuthStore.getState().isPasswordRecovery) {
                    if (session.access_token) {
                        setCachedAuthToken(session.access_token, session.user?.id);
                        setAuthTokenReady(true);
                    }
                    return;
                }
                if (session.access_token) {
                    setCachedAuthToken(session.access_token, session.user?.id);
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

    // --- Theme initialization ---
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
            if (storedTheme === 'dark') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            setTheme('dark');
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        }
    }, [currentUser?.id, currentUser?.settings, setTheme, setLowDataMode]);

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

            // Phase 2: deferred heavy loads (paginated / background)
            const deferredResults = await Promise.allSettled([
                fetchDecks(userId),
                fetchFlashcards(undefined, userId, { page: 1, limit: 50 }),
                fetchTestResults(userId, { limit: 50 }),
                fetchUserQuestionStats(userId),
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

            console.log('[Data Loading] All parallel fetches settled');

                // --- [0] Groups + [1] Unread counts ---
                const groupsResult = results[0];
                const unreadResult = results[1];
                if (groupsResult.status === 'fulfilled') {
                    const fetchedGroups = groupsResult.value;
                    const unreadCounts = unreadResult.status === 'fulfilled' ? unreadResult.value : {};
                    setGroups(fetchedGroups.map((g: any) => ({
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
                        pendingMembers: [],
                        invitedPhoneNumbers: [],
                        members: []
                    })));
                } else {
                    console.error('[Data Loading] Groups fetch failed:', groupsResult.reason);
                }

                // --- [2] DM threads + [3] DM unread counts ---
                const dmResult = results[2];
                const dmUnreadResult = results[3];
                if (dmResult.status === 'fulfilled') {
                    const fetchedDmThreads = dmResult.value;
                    const dmUnreadCounts = dmUnreadResult.status === 'fulfilled' ? dmUnreadResult.value : {};
                    setDmThreads(mapFetchedDmThreads(fetchedDmThreads || [], dmUnreadCounts));
                }

                // --- [4] Decks + [5] Flashcards ---
                const decksResult = results[4];
                const flashcardsResult = results[5];
                if (decksResult.status === 'fulfilled') {
                    setDecks(decksResult.value.map((d: any) => ({
                        id: d.id,
                        name: d.name,
                        description: d.description,
                        createdAt: d.created_at
                    })));
                }
                void useNotesStore.getState().loadFolders();
                void useNotesStore.getState().loadNotes();

                if (flashcardsResult.status === 'fulfilled') {
                    setFlashcards(flashcardsResult.value.map((fc: any) => ({
                        id: fc.id,
                        deckId: fc.deck_id,
                        type: fc.type,
                        front: fc.front,
                        back: fc.back,
                        clozeText: fc.cloze_text,
                        srsData: fc.srs_data,
                        tags: fc.tags,
                        createdAt: fc.created_at
                    })));
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
                    const fetchedStats = results[7].value;
                    if (fetchedStats && Object.keys(fetchedStats).length > 0) {
                        setUserQuestionStats(fetchedStats);
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
                        setTheme(cloudPrefs.theme);
                        localStorage.setItem('theme', cloudPrefs.theme);
                        setLowDataMode(cloudPrefs.lowDataMode === true);
                        const extras = cloudPrefs.preferences?.budgetExtras;
                        if (extras && typeof extras === 'object') {
                            if (Array.isArray(extras.savingsGoals)) setSavingsGoals(extras.savingsGoals);
                            if (Array.isArray(extras.expenseSplits)) setExpenseSplits(extras.expenseSplits);
                            if (extras.categoryBudgets && typeof extras.categoryBudgets === 'object') {
                                const currentBudget = useBudgetStore.getState().budget;
                                setBudget({
                                    monthlyLimit: currentBudget?.monthlyLimit ?? 0,
                                    monthYear: currentBudget?.monthYear ?? currentMonthYear,
                                    userId,
                                    categoryBudgets: extras.categoryBudgets,
                                });
                            }
                        }
                    } else {
                        const localTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
                        saveUserPreferences(userId, {
                            theme: localTheme,
                            lowDataMode,
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

                // Mark data as loaded regardless of individual failures
                if (!cancelled) setDataLoaded(true);

            // Sync pending results (non-critical, fire-and-forget)
            if (!cancelled && pendingSyncResults.length > 0) {
                fetchPendingSyncResults(currentUser.id).then(() => {
                    console.log('[Pending Results Sync] Synced');
                }).catch(error => {
                    console.error('[Pending Results Sync] Error:', error);
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, dataLoaded, isAuthLoading, authTokenReady, refreshDashboardGamification]);

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
    useEffect(() => {
        if (!currentUser) return;

        const notificationsSubscription = supabase
            .channel(`notifications:${currentUser.id}`)
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
                    } else if (notifType === 'dm_message' || (payload.new.link as string | undefined)?.startsWith('dm:')) {
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
            .subscribe();

        return () => {
            notificationsSubscription.unsubscribe();
        };
    }, [currentUser?.id, updateNotifications, openModal, onChallengeNotification, refreshDmThreadsForUser]);

    // --- Real-time DM message subscription ---
    useEffect(() => {
        if (!currentUser || lowDataMode) return;

        const channels = dmThreads.map((thread) => {
            return supabase
                .channel(`dm:${thread.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'dm_messages',
                        filter: `thread_id=eq.${thread.id}`,
                    },
                    (payload) => {
                        const raw = payload.new as {
                            id: string;
                            thread_id: string;
                            sender_id: string;
                            text: string;
                            timestamp: string;
                        };
                        const message: DirectMessage = {
                            id: raw.id,
                            threadId: raw.thread_id,
                            senderId: raw.sender_id,
                            text: raw.text,
                            timestamp: new Date(raw.timestamp),
                        };
                        updateDirectMessages(prev => {
                            const existing = prev[thread.id] || [];
                            if (existing.some(m => m.id === message.id)) return prev;
                            return { ...prev, [thread.id]: [...existing, message] };
                        });
                        updateDmThreads(prev => prev.map(t => {
                            if (t.id !== thread.id) return t;
                            const isIncoming = raw.sender_id !== currentUser.id;
                            return {
                                ...t,
                                lastMessage: raw.text,
                                lastMessageTimestamp: new Date(raw.timestamp),
                                unreadCount: isIncoming ? (t.unreadCount || 0) + 1 : t.unreadCount,
                                isArchived: isIncoming ? false : t.isArchived,
                            };
                        }));
                    }
                )
                .subscribe();
        });

        return () => {
            channels.forEach(ch => ch.unsubscribe());
        };
    }, [currentUser?.id, dmThreads, lowDataMode, updateDirectMessages, updateDmThreads]);

    // --- Real-time profile updates subscription ---
    useEffect(() => {
        if (!currentUser || lowDataMode) return;

        const profileSubscription = supabase
            .channel('profile')
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
                    if (currentUser) {
                        setCurrentUser({
                            ...currentUser,
                            name: updatedProfile.name,
                            avatarUrl: updatedProfile.avatar_url,
                            phoneNumber: updatedProfile.phone,
                            points: updatedProfile.points || 0,
                            badges: updatedProfile.badges || [],
                            stats: updatedProfile.stats || initialUserStats,
                            settings: updatedProfile.settings || {}
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            profileSubscription.unsubscribe();
        };
    }, [currentUser?.id, lowDataMode]);

    // --- Real-time group membership subscription ---
    // Keeps the groups list in sync when the user is added to / removed from groups
    // without requiring a full page refresh or manual re-fetch.
    useEffect(() => {
        if (!currentUser || lowDataMode) return;

        const groupMembershipSubscription = supabase
            .channel(`group_members:${currentUser.id}`)
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
                        const freshGroups = await fetchGroups(currentUser.id);
                        setGroups(freshGroups.map((g: any) => ({
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
                            unreadCount: 0,
                            pendingMembers: [],
                            invitedPhoneNumbers: [],
                            members: [],
                        })));
                    } catch (err) {
                        console.error('[Group membership] Real-time refresh failed:', err);
                    }
                }
            )
            .subscribe();

        return () => {
            groupMembershipSubscription.unsubscribe();
        };
    }, [currentUser?.id, lowDataMode]);

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
    const checkForDueCardsAndNotify = useCallback(() => {
        if (!currentUser || !flashcards.length || !getNotificationSettings(normalizeUserSettings(currentUser.settings)).srsReminders) return;

        const today = new Date().toISOString().split('T')[0];
        const dueCards = flashcards.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today);
        const newCards = flashcards.filter(fc => !fc.srsData?.repetitions);

        const totalDue = dueCards.length + newCards.length;
        setDueCardsCount(totalDue);

        if (totalDue > 0 && Notification.permission === 'granted') {
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
        }
    }, [currentUser, flashcards, setAppMode]);

    useEffect(() => {
        return onWebNotificationClick((data) => {
            if (data.navigate === 'flashcards') {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
            }
        });
    }, [setAppMode]);

    useEffect(() => {
        if (currentUser && flashcards.length > 0) {
            if ('Notification' in window && Notification.permission === 'default') {
                void requestWebNotificationPermission();
            }

            checkForDueCardsAndNotify();

            if (lowDataMode) return; // Skip hourly polling in low-data mode
            const interval = setInterval(checkForDueCardsAndNotify, 60 * 60 * 1000);
            return () => clearInterval(interval);
        }
    }, [currentUser, flashcards, checkForDueCardsAndNotify, lowDataMode]);

    return {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
    };
}
