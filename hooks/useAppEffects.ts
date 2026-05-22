import { useEffect, useCallback, useState } from 'react';
import { AppMode, OfflineSessionBundle, TransactionType, Transaction } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useTestStore } from '../stores/testStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUIStore } from '../stores/uiStore';
import { initialUserStats } from '../utils/helpers';
import {
    supabase, setCachedAuthToken,
    fetchGroups, fetchGroupMembers,
    fetchDecks, fetchFlashcards,
    fetchTestResults, fetchUserQuestionStats,
    fetchNotifications,
    fetchGroupUnreadCounts, fetchDMUnreadCounts, fetchDmThreads,
    fetchOfflineBundles, saveOfflineBundle, deleteOfflineBundle,
    fetchUserPreferences, saveUserPreferences,
    fetchUserBudget, saveUserBudget,
    syncBudgetTransactionsToCloud,
    fetchPendingSyncResults, savePendingSyncResult,
    markAllNotificationsAsRead, deleteAllNotifications,
    fetchUserProfile, createUserProfile,
} from '../services/supabase';

interface UseAppEffectsParams {
    dataLoaded: boolean;
    setDataLoaded: (v: boolean) => void;
}

export function useAppEffects({ dataLoaded, setDataLoaded }: UseAppEffectsParams) {
    const { currentUser, setCurrentUser, setAuthLoading } = useAuthStore();
    const {
        groups, setGroups, updateGroups,
        setAllMessages, setDmThreads, updateDmThreads,
        setAllDirectMessages,
        setNotifications, updateNotifications, notifications
    } = useGroupStore();
    const {
        offlineBundles, updateOfflineBundles,
        pendingSyncResults, setPendingSyncResults,
        setTestResults, setUserQuestionStats,
    } = useTestStore();
    const {
        decks, setDecks,
        flashcards, setFlashcards,
        dueCardsCount, setDueCardsCount
    } = useFlashcardStore();
    const { transactions, setTransactions, budget, setBudget } = useBudgetStore();
    const {
        theme, setTheme, setAppMode,
        openModal, lowDataMode
    } = useUIStore();

    // --- One-time session cleanup ---
    useEffect(() => {
        const lastCleanup = localStorage.getItem('session-cleanup-v2');
        if (!lastCleanup) {
            console.log('Performing one-time session cleanup...');
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('sb-') || key.includes('supabase')) {
                    console.log('Clearing:', key);
                    localStorage.removeItem(key);
                }
            });
            localStorage.setItem('session-cleanup-v2', Date.now().toString());
        }
    }, []);

    // --- Restore session on app load ---
    useEffect(() => {
        let isMounted = true;
        
        const restoreSession = async () => {
            try {
                // Wrap getSession with a timeout, but do NOT wipe the session if it times out
                // or fails due to a transient connection error.
                const getSessionPromise = supabase.auth.getSession();
                const timeoutPromise = new Promise<{ timeout: boolean }>((resolve) => {
                    setTimeout(() => resolve({ timeout: true }), 15000);
                });
                
                const result = await Promise.race([
                    getSessionPromise.then(res => ({ ...res, timeout: false })),
                    timeoutPromise
                ]);
                
                if (!isMounted) return;
                
                if ('timeout' in result && result.timeout) {
                    console.warn('[Auth] Session retrieval timed out. Retaining cached session.');
                    setAuthLoading(false);
                    return;
                }
                
                const { data: { session }, error: sessionError } = result as any;
                
                if (sessionError) {
                    console.error('[Auth] getSession error:', sessionError);
                }
                
                if (!session?.user) {
                    console.log('[Auth] No active session found.');
                    if (isMounted) {
                        setCurrentUser(null);
                        setAuthLoading(false);
                    }
                    return;
                }
                
                if (session?.access_token) {
                    // Populate the in-memory token cache so all subsequent API calls are instant
                    setCachedAuthToken(session.access_token, session.user?.id);
                    console.log('[App] Restored and cached access token');
                }
                
                // Fetch profile with fallback to local cached user state if offline
                try {
                    const profile = await fetchUserProfile(session.user.id);
                    
                    if (!isMounted) return;
                    
                    if (!profile) {
                        throw new Error('Profile not found');
                    }
                    
                    setCurrentUser({
                        id: profile.id,
                        name: profile.name,
                        avatarUrl: profile.avatar_url || '',
                        email: session.user.email!,
                        password: '',
                        phoneNumber: profile.phone || '',
                        points: profile.points || 0,
                        badges: (profile.badges as any[]) || [],
                        stats: profile.stats || {},
                        settings: profile.settings,
                        username: profile.username || undefined,
                        firstName: profile.first_name || undefined,
                        lastName: profile.last_name || undefined,
                    });
                } catch (profileErr: any) {
                    if (!isMounted) return;
                    
                    // If 404 (not found), try to create it via the API
                    if (profileErr.message?.includes('404') || profileErr.message?.includes('status: 404')) {
                        console.log('Creating profile for session user...');
                        const userName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User';
                        
                        try {
                            const newProfile = await createUserProfile({
                                id: session.user.id,
                                name: userName,
                                phone: undefined,
                                points: 0,
                                stats: {},
                                settings: {},
                                badges: []
                            });
                            
                            setCurrentUser({
                                id: newProfile.id,
                                name: newProfile.name,
                                avatarUrl: newProfile.avatar_url || '',
                                email: session.user.email!,
                                password: '',
                                phoneNumber: newProfile.phone || '',
                                points: newProfile.points || 0,
                                badges: (newProfile.badges as any[]) || [],
                                stats: newProfile.stats || {},
                                settings: newProfile.settings,
                                username: newProfile.username || undefined,
                                firstName: newProfile.first_name || undefined,
                                lastName: newProfile.last_name || undefined,
                            });
                        } catch (createError) {
                            console.error('Failed to create profile via API:', createError);
                            throw new Error('Profile creation failed');
                        }
                    } else {
                        console.warn('[Auth] Profile fetch failed, retaining cached profile:', profileErr.message);
                        const existingUser = useAuthStore.getState().currentUser;
                        if (existingUser && existingUser.id === session.user.id) {
                            setAuthLoading(false);
                            return;
                        } else {
                            throw profileErr;
                        }
                    }
                }
                
                setAuthLoading(false);
                
            } catch (error: any) {
                console.log('Session validation failed completely:', error.message);
                
                // Only wipe if it is an explicit auth failure (not connection/timeout issues)
                const isConnectionError = error.message.includes('timeout') || error.message.includes('Fetch') || error.message.includes('Network');
                if (!isConnectionError) {
                    console.log('Clearing stale session data from localStorage...');
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('sb-') || key.includes('supabase') || key === 'auth-storage') {
                            console.log('Removing:', key);
                            localStorage.removeItem(key);
                        }
                    });
                    
                    try {
                        await supabase.auth.signOut();
                    } catch (e) {
                        // Ignore
                    }
                    
                    if (isMounted) {
                        setCurrentUser(null);
                        setAuthLoading(false);
                    }
                } else {
                    console.warn('[Auth] Connection error during restore. Retaining cached session.');
                    setAuthLoading(false);
                }
            }
        };
        
        restoreSession();
        
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT') {
                const store = useAuthStore.getState();
                if (!store.isAuthLoading) {
                    setCurrentUser(null);
                    setDataLoaded(false);
                }
            } else if (event === 'SIGNED_IN' && session?.user) {
                if (session?.access_token) {
                    setCachedAuthToken(session.access_token, session.user?.id);
                }
                try {
                    const profile = await fetchUserProfile(session.user.id);
                    if (profile) {
                        setCurrentUser({
                            id: profile.id,
                            name: profile.name,
                            avatarUrl: profile.avatar_url || '',
                            email: session.user.email!,
                            password: '',
                            phoneNumber: profile.phone || '',
                            points: profile.points || 0,
                            badges: (profile.badges as any[]) || [],
                            stats: profile.stats || {},
                            settings: profile.settings,
                            username: profile.username || undefined,
                            firstName: profile.first_name || undefined,
                            lastName: profile.last_name || undefined,
                        });
                    }
                } catch (err) {
                    console.error('Failed to fetch profile on SIGNED_IN event:', err);
                }
            }
        });
        
        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []);

    // --- Theme initialization ---
    useEffect(() => {
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
    }, []);

    // --- Username check ---
    useEffect(() => {
        if (currentUser && !currentUser.username) {
            openModal('usernameRequired');
        }
    }, [currentUser?.id, currentUser?.username]);

    // --- Data loading ---
    useEffect(() => {
        if (currentUser && !dataLoaded) {
            console.log('[Data Loading] Starting PARALLEL data fetch for user:', currentUser.id);
            const userId = currentUser.id;
            const currentMonthYear = new Date().toISOString().slice(0, 7);

            // Fire ALL data-loading calls in parallel using Promise.allSettled.
            // Previously these were sequential (waterfall), each independently calling
            // getSession() with a 10s timeout. Now they all fire at once.
            Promise.allSettled([
                // [0] Groups
                fetchGroups(userId),
                // [1] Group unread counts
                fetchGroupUnreadCounts(userId),
                // [2] DM threads
                fetchDmThreads(userId),
                // [3] DM unread counts
                fetchDMUnreadCounts(userId),
                // [4] Decks
                fetchDecks(userId),
                // [5] Flashcards
                fetchFlashcards(undefined, userId),
                // [6] Test results
                fetchTestResults(userId),
                // [7] User question stats
                fetchUserQuestionStats(userId),
                // [8] Notifications
                fetchNotifications(userId),
                // [9] Offline bundles
                fetchOfflineBundles(userId),
                // [10] User preferences
                fetchUserPreferences(userId),
                // [11] User budget
                fetchUserBudget(userId, currentMonthYear),
                // [12] Transactions sync
                syncBudgetTransactionsToCloud(userId, transactions),
            ]).then((results) => {
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
                    const mappedDmThreads = fetchedDmThreads.map((t: any) => ({
                        id: t.id,
                        participantIds: t.participantIds || t.participant_ids || [],
                        participants: t.participants || {},
                        lastMessage: t.lastMessage || t.last_message,
                        lastMessageTimestamp: t.lastMessageTimestamp || t.last_message_time,
                        unreadCount: dmUnreadCounts[t.id] || 0,
                        isArchived: t.isArchived || false,
                    }));
                    setDmThreads(mappedDmThreads);
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
                    setTestResults(results[6].value);
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
                    if (fetchedNotifications && fetchedNotifications.length > 0) {
                        setNotifications(fetchedNotifications);
                    }
                }

                // --- [9] Offline bundles ---
                if (results[9].status === 'fulfilled') {
                    const cloudBundles = results[9].value;
                    updateOfflineBundles(prev => {
                        const localBundleIds = new Set(prev.map(b => b.bundleId));
                        const cloudBundleIds = new Set(cloudBundles.map((b: OfflineSessionBundle) => b.bundleId));
                        const localOnlyBundles = prev.filter(b => !cloudBundleIds.has(b.bundleId));
                        if (currentUser) {
                            localOnlyBundles.forEach(bundle => {
                                saveOfflineBundle(currentUser.id, bundle).catch(err =>
                                    console.error('[Offline Sync] Failed to sync bundle to cloud:', err)
                                );
                            });
                        }
                        const cloudOnlyBundles = cloudBundles.filter((b: OfflineSessionBundle) => !localBundleIds.has(b.bundleId));
                        return [...prev, ...cloudOnlyBundles];
                    });
                }

                // --- [10] User preferences ---
                if (results[10].status === 'fulfilled') {
                    const cloudPrefs = results[10].value;
                    if (cloudPrefs) {
                        setTheme(cloudPrefs.theme);
                        localStorage.setItem('theme', cloudPrefs.theme);
                    } else {
                        const localTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
                        saveUserPreferences(userId, { theme: localTheme }).catch(console.error);
                    }
                }

                // --- [11] User budget ---
                if (results[11].status === 'fulfilled') {
                    const cloudBudget = results[11].value;
                    if (cloudBudget) {
                        const updatedBudget = budget ? {
                            ...budget,
                            monthlyLimit: cloudBudget.monthlyLimit
                        } : {
                            monthlyLimit: cloudBudget.monthlyLimit,
                            monthYear: currentMonthYear
                        };
                        setBudget(updatedBudget);
                    } else {
                        const localBudgetStr = localStorage.getItem('monthlyBudget');
                        if (localBudgetStr) {
                            const localBudget = JSON.parse(localBudgetStr);
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

                // Mark data as loaded regardless of individual failures
                setDataLoaded(true);
            });

            // Sync pending results (non-critical, fire-and-forget)
            if (pendingSyncResults.length > 0) {
                fetchPendingSyncResults(currentUser.id).then(() => {
                    console.log('[Pending Results Sync] Synced');
                }).catch(error => {
                    console.error('[Pending Results Sync] Error:', error);
                });
            }
        }
    }, [currentUser?.id, dataLoaded]);

    // --- Real-time notifications subscription ---
    useEffect(() => {
        if (!currentUser || lowDataMode) return;

        const notificationsSubscription = supabase
            .channel('notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    console.log('Real-time notification received:', payload);
                    const newNotification = {
                        id: payload.new.id,
                        message: payload.new.message,
                        date: payload.new.date,
                        read: payload.new.read,
                        link: payload.new.link
                    };
                    updateNotifications(prev => [newNotification, ...prev]);
                }
            )
            .subscribe();

        return () => {
            notificationsSubscription.unsubscribe();
        };
    }, [currentUser?.id, lowDataMode]);

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
                    console.log('Real-time profile update received:', payload);
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

    // --- Theme sync to DOM ---
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [theme]);

    // --- SRS Notifications ---
    const checkForDueCardsAndNotify = useCallback(() => {
        if (!currentUser || !flashcards.length || !currentUser.settings?.srsReminders) return;

        const today = new Date().toISOString().split('T')[0];
        const dueCards = flashcards.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today);
        const newCards = flashcards.filter(fc => !fc.srsData?.repetitions);

        const totalDue = dueCards.length + newCards.length;
        setDueCardsCount(totalDue);

        if (totalDue > 0 && Notification.permission === 'granted') {
            const notification = new Notification('Flashcard Review Due', {
                body: `You have ${totalDue} flashcards ready for review.`,
                icon: '/favicon.ico',
                tag: 'srs-reminder'
            });

            notification.onclick = () => {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
                notification.close();
            };
        }
    }, [currentUser, flashcards]);

    useEffect(() => {
        if (currentUser && flashcards.length > 0) {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }

            checkForDueCardsAndNotify();

            if (lowDataMode) return; // Skip hourly polling in low-data mode
            const interval = setInterval(checkForDueCardsAndNotify, 60 * 60 * 1000);
            return () => clearInterval(interval);
        }
    }, [currentUser, flashcards, checkForDueCardsAndNotify, lowDataMode]);
}
