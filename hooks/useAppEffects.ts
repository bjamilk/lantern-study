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

// A spurious SIGNED_OUT (refresh-token 400) can be recovered when a valid session
// still lives in storage. Bound the recovery so a session that is genuinely dying
// can't ping-pong recover→fail→recover: only attempt it once per this window.
const SPURIOUS_SIGNOUT_RECOVERY_COOLDOWN_MS = 15_000;
let lastSpuriousSignoutRecoveryAt = 0;

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
