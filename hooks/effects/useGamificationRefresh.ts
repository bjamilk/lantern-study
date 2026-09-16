/**
 * The dashboard's gamification slice: daily quests, login streak, streak
 * freezes, the study-activity heatmap, and the profile's points/badges/stats.
 *
 * Exports: useGamificationRefresh({ setCurrentUser }) → { refreshDashboardGamification,
 *  dailyQuests, serverStreak, streakFreezes, questsLoaded }. App.tsx reads all five
 *  through useAppEffects, and the bootstrap fan-out calls the refresher.
 * Touches: services/gamificationStreak (quests, login streak, study activity,
 *  progress sync), fetchUserProfile as the fallback, `ensureAuthTokenReady`,
 *  `setStudyActivityDays` on stores/testStore, and the window event
 *  'lantern:streak-updated'.
 * Gotchas:
 *  - The four fetches are independent `Promise.allSettled` slots: one failing
 *    must not blank the other three, and the call always ends with
 *    questsLoaded = true so the dashboard stops waiting.
 *  - Both write paths re-read the auth store and compare ids, so a user switch
 *    mid-flight cannot stamp one account's points onto another.
 *  - The window event exists so code that ALREADY knows the new streak (a review
 *    submit response, say) can push it here instead of forcing a refetch.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effect registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useTestStore } from '../../stores/testStore';
import { ensureAuthTokenReady, fetchUserProfile } from '../../services/supabase';
import {
    fetchStudyActivity,
    fetchDailyQuests,
    recordLoginStreak,
    syncGamificationProgress,
} from '../../services/gamificationStreak';
import { computeStudyStreak } from '@lantern/shared/utils';

interface UseGamificationRefreshParams {
    setCurrentUser: (user: User) => void;
}

export function useGamificationRefresh({ setCurrentUser }: UseGamificationRefreshParams) {
    const { setStudyActivityDays } = useTestStore();

    const [dailyQuests, setDailyQuests] = useState<any[]>([]);
    const [serverStreak, setServerStreak] = useState(0);
    const [streakFreezes, setStreakFreezes] = useState(0);
    const [questsLoaded, setQuestsLoaded] = useState(false);

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

    return {
        refreshDashboardGamification,
        dailyQuests,
        serverStreak,
        streakFreezes,
        questsLoaded,
    };
}
