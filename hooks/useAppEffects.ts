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
    supabase,
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
        openModal
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
                    setTimeout(() => resolve({ timeout: true }), 5000);
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
                    localStorage.setItem('lantern_access_token', session.access_token);
                    if (session.refresh_token) {
                        localStorage.setItem('lantern_refresh_token', session.refresh_token);
                    }
                    console.log('[App] Restored and stored access token');
                }
                
                // Fetch profile with fallback to local cached user state if offline
                try {
                    const { data: profile, error: profileError } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', session.user.id)
                        .single();
                    
                    if (!isMounted) return;
                    
                    if (profileError || !profile) {
                        if (profileError?.code === 'PGRST116') { // PGRST116 is single() not found
                            console.log('Creating profile for session user...');
                            const userName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User';
                            
                            const { data: newProfile, error: createError } = await supabase
                                .from('profiles')
                                .insert({
                                    id: session.user.id,
                                    name: userName,
                                    phone: null,
                                    points: 0,
                                    stats: {},
                                    settings: {},
                                    badges: []
                                })
                                .select()
                                .single();
                            
                            if (createError || !newProfile) {
                                console.error('Failed to create profile:', createError);
                                throw new Error('Profile creation failed');
                            }
                            
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
                        } else {
                            console.warn('[Auth] Profile fetch failed, retaining cached profile:', profileError);
                            const existingUser = useAuthStore.getState().currentUser;
                            if (existingUser && existingUser.id === session.user.id) {
                                setAuthLoading(false);
                                return;
                            } else {
                                throw new Error('Profile not found and no cache');
                            }
                        }
                    } else {
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
                } catch (profileErr: any) {
                    console.error('[Auth] Profile validation failed:', profileErr.message);
                    const existingUser = useAuthStore.getState().currentUser;
                    if (existingUser && existingUser.id === session.user.id) {
                        console.log('[Auth] Retaining cached user session due to profile fetch failure');
                        setAuthLoading(false);
                        return;
                    }
                    throw profileErr;
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
                setCurrentUser(null);
                setDataLoaded(false);
            } else if (event === 'SIGNED_IN' && session?.user) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();
                
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
            console.log('[Data Loading] Starting data fetch for user:', currentUser.id);
            fetchGroups(currentUser.id).then(async (fetchedGroups) => {
                console.log('[Data Loading] Groups fetched:', fetchedGroups?.length || 0);
                const unreadCounts = await fetchGroupUnreadCounts(currentUser.id);
                
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
                
                // Fetch DM threads from server
                const fetchedDmThreads = await fetchDmThreads(currentUser.id);
                const dmUnreadCounts = await fetchDMUnreadCounts(currentUser.id);
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
                
                setDataLoaded(true);
            }).catch(error => {
                console.error('[Data Loading] Error fetching groups:', error);
                setDataLoaded(true);
            });

            Promise.all([
                fetchDecks(currentUser.id),
                fetchFlashcards(undefined, currentUser.id)
            ]).then(([fetchedDecks, fetchedFlashcards]) => {
                const mappedDecks = fetchedDecks.map((d: any) => ({
                    id: d.id,
                    name: d.name,
                    description: d.description,
                    createdAt: d.created_at
                }));
                setDecks(mappedDecks);
                setFlashcards(fetchedFlashcards.map((fc: any) => ({
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
            }).catch(error => {
                console.error('Error fetching flashcards data:', error);
            });

            fetchTestResults(currentUser.id).then(fetchedResults => {
                setTestResults(fetchedResults);
            }).catch(error => {
                console.error('Error fetching test results:', error);
            });

            fetchUserQuestionStats(currentUser.id).then(fetchedStats => {
                if (fetchedStats && Object.keys(fetchedStats).length > 0) {
                    setUserQuestionStats(fetchedStats);
                }
            }).catch((error) => {
                console.debug('Failed to fetch user question stats:', error);
            });

            fetchNotifications(currentUser.id).then(fetchedNotifications => {
                // Only overwrite if we actually got notifications back;
                // don't wipe local state on empty/failed fetches
                if (fetchedNotifications && fetchedNotifications.length > 0) {
                    setNotifications(fetchedNotifications);
                }
            }).catch(() => {
                // Handled gracefully in the service layer
            });

            fetchOfflineBundles(currentUser.id).then(cloudBundles => {
                console.log('[Offline Sync] Cloud bundles fetched:', cloudBundles.length);
                updateOfflineBundles(prev => {
                    const localBundleIds = new Set(prev.map(b => b.bundleId));
                    const cloudBundleIds = new Set(cloudBundles.map((b: OfflineSessionBundle) => b.bundleId));
                    
                    const localOnlyBundles = prev.filter(b => !cloudBundleIds.has(b.bundleId));
                    
                    if (currentUser) {
                        localOnlyBundles.forEach(bundle => {
                            console.log('[Offline Sync] Syncing local bundle to cloud:', bundle.bundleId);
                            saveOfflineBundle(currentUser.id, bundle).catch(err => 
                                console.error('[Offline Sync] Failed to sync bundle to cloud:', err)
                            );
                        });
                    }
                    
                    const cloudOnlyBundles = cloudBundles.filter((b: OfflineSessionBundle) => !localBundleIds.has(b.bundleId));
                    console.log('[Offline Sync] Adding cloud-only bundles:', cloudOnlyBundles.length);
                    
                    return [...prev, ...cloudOnlyBundles];
                });
            }).catch(error => {
                console.error('[Offline Sync] Error fetching cloud bundles:', error);
            });

            fetchUserPreferences(currentUser.id).then(cloudPrefs => {
                if (cloudPrefs) {
                    console.log('[Preferences Sync] Cloud preferences fetched:', cloudPrefs.theme);
                    setTheme(cloudPrefs.theme);
                    localStorage.setItem('theme', cloudPrefs.theme);
                } else {
                    const localTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'light';
                    saveUserPreferences(currentUser.id, { theme: localTheme }).then(() => {
                        console.log('[Preferences Sync] Local theme synced to cloud:', localTheme);
                    });
                }
            }).catch(error => {
                console.error('[Preferences Sync] Error:', error);
            });

            const currentMonthYear = new Date().toISOString().slice(0, 7);
            fetchUserBudget(currentUser.id, currentMonthYear).then(cloudBudget => {
                if (cloudBudget) {
                    console.log('[Budget Sync] Cloud budget fetched:', cloudBudget.monthlyLimit);
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
                        saveUserBudget(currentUser.id, {
                            monthlyLimit: localBudget.monthlyLimit || 0,
                            monthYear: currentMonthYear
                        }).then(() => {
                            console.log('[Budget Sync] Local budget synced to cloud');
                        });
                    }
                }
            }).catch(error => {
                console.error('[Budget Sync] Error:', error);
            });

            syncBudgetTransactionsToCloud(currentUser.id, transactions).then(mergedTransactions => {
                console.log('[Transactions Sync] Merged transactions:', mergedTransactions.length);
                const transactionsWithUserId: Transaction[] = mergedTransactions.map(t => ({
                    ...t,
                    userId: currentUser.id,
                    type: t.type as TransactionType,
                    category: t.category || '',
                    description: t.description || ''
                }));
                setTransactions(transactionsWithUserId);
            }).catch(error => {
                console.error('[Transactions Sync] Error:', error);
            });

            if (pendingSyncResults.length > 0) {
                const pendingSyncData = pendingSyncResults.map(result => ({
                    id: result.id,
                    resultData: result,
                    createdAt: new Date().toISOString(),
                    synced: false,
                }));
                fetchPendingSyncResults(currentUser.id).then(() => {
                    console.log('[Pending Results Sync] Synced');
                }).catch(error => {
                    console.error('[Pending Results Sync] Error:', error);
                });
            }
        }
    }, [currentUser, dataLoaded]);

    // --- Real-time notifications subscription ---
    useEffect(() => {
        if (!currentUser) return;

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
    }, [currentUser]);

    // --- Real-time profile updates subscription ---
    useEffect(() => {
        if (!currentUser) return;

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
    }, [currentUser]);

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

            const interval = setInterval(checkForDueCardsAndNotify, 60 * 60 * 1000);
            return () => clearInterval(interval);
        }
    }, [currentUser, flashcards, checkForDueCardsAndNotify]);
}
