// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useGamificationRefresh`.
 *
 * What the hook promises: it returns the five keys App.tsx reads
 * (`refreshDashboardGamification`, `dailyQuests`, `serverStreak`,
 * `streakFreezes`, `questsLoaded`); the refresher calls all four gamification
 * services; ONE of them failing does not blank the other three; and
 * `questsLoaded` always ends true, so the dashboard stops waiting either way.
 *
 * Two guards get their own cases: nothing runs before `ensureAuthTokenReady`
 * says the token is usable, and a user switch mid-flight must not stamp one
 * account's points onto another.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const authState = { currentUser: { id: 'user-1', points: 1 } as Record<string, unknown> | null };
    const testState = { setStudyActivityDays: vi.fn() };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    return {
        authState,
        testState,
        store,
        ensureAuthTokenReady: vi.fn(() => Promise.resolve(true)),
        fetchUserProfile: vi.fn((..._args: unknown[]) => Promise.resolve({} as unknown)),
        fetchDailyQuests: vi.fn(() => Promise.resolve([{ id: 'quest-1' }] as unknown)),
        recordLoginStreak: vi.fn(() => Promise.resolve({ current_streak: 3, streak_freezes: 2 } as unknown)),
        fetchStudyActivity: vi.fn(() => Promise.resolve([] as unknown)),
        syncGamificationProgress: vi.fn(() => Promise.resolve({ points: 99, badges: [], stats: {} } as unknown)),
    };
});

vi.mock('../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../stores/testStore', () => ({ useTestStore: fx.store(fx.testState) }));
vi.mock('../../services/supabase', () => ({
    ensureAuthTokenReady: fx.ensureAuthTokenReady,
    fetchUserProfile: fx.fetchUserProfile,
}));
vi.mock('../../services/gamificationStreak', () => ({
    fetchDailyQuests: fx.fetchDailyQuests,
    recordLoginStreak: fx.recordLoginStreak,
    fetchStudyActivity: fx.fetchStudyActivity,
    syncGamificationProgress: fx.syncGamificationProgress,
}));

import { useGamificationRefresh } from './useGamificationRefresh';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setCurrentUser = vi.fn();

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useGamificationRefresh>;

function Probe() {
    api = useGamificationRefresh({ setCurrentUser });
    return null;
}

const mount = async () => {
    await act(async () => {
        root.render(<Probe />);
    });
};

const refresh = async () => {
    await act(async () => {
        await api.refreshDashboardGamification();
    });
};

beforeEach(() => {
    fx.authState.currentUser = { id: 'user-1', points: 1 };
    fx.testState.setStudyActivityDays.mockClear();
    fx.ensureAuthTokenReady.mockClear().mockResolvedValue(true);
    fx.fetchDailyQuests.mockClear().mockResolvedValue([{ id: 'quest-1' }]);
    fx.recordLoginStreak.mockClear().mockResolvedValue({ current_streak: 3, streak_freezes: 2 });
    fx.fetchStudyActivity.mockClear().mockResolvedValue([]);
    fx.syncGamificationProgress
        .mockClear()
        .mockResolvedValue({ points: 99, badges: [], stats: {} });
    fx.fetchUserProfile.mockClear().mockResolvedValue({});
    setCurrentUser.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe('useGamificationRefresh', () => {
    it('returns exactly the keys App.tsx reads', async () => {
        await mount();
        expect(Object.keys(api).sort()).toEqual([
            'dailyQuests',
            'questsLoaded',
            'refreshDashboardGamification',
            'serverStreak',
            'streakFreezes',
        ]);
    });

    it('starts unloaded, with nothing to show', async () => {
        await mount();
        expect(api.questsLoaded).toBe(false);
        expect(api.dailyQuests).toEqual([]);
        expect(api.serverStreak).toBe(0);
    });

    it('fills all four slots from their own services', async () => {
        await mount();
        await refresh();
        expect(fx.fetchDailyQuests).toHaveBeenCalled();
        expect(fx.recordLoginStreak).toHaveBeenCalled();
        expect(fx.fetchStudyActivity).toHaveBeenCalled();
        expect(fx.syncGamificationProgress).toHaveBeenCalled();
        expect(api.dailyQuests).toEqual([{ id: 'quest-1' }]);
        expect(api.serverStreak).toBe(3);
        expect(api.streakFreezes).toBe(2);
        expect(api.questsLoaded).toBe(true);
        expect(setCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ points: 99 }));
    });

    it('keeps the other three slots when one fails, and still finishes loading', async () => {
        fx.fetchDailyQuests.mockRejectedValue(new Error('quests down'));
        await mount();
        await refresh();
        expect(api.dailyQuests).toEqual([]);
        expect(api.serverStreak).toBe(3);
        expect(api.streakFreezes).toBe(2);
        expect(api.questsLoaded).toBe(true);
    });

    it('falls back to a direct profile fetch when the progress sync fails', async () => {
        fx.syncGamificationProgress.mockRejectedValue(new Error('sync down'));
        fx.fetchUserProfile.mockResolvedValue({ points: 42, badges: [], stats: {} });
        await mount();
        await refresh();
        expect(fx.fetchUserProfile).toHaveBeenCalledWith('user-1');
        expect(setCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ points: 42 }));
    });

    it('defers entirely until the auth token is ready', async () => {
        fx.ensureAuthTokenReady.mockResolvedValue(false);
        await mount();
        await refresh();
        expect(fx.fetchDailyQuests).not.toHaveBeenCalled();
        expect(api.questsLoaded).toBe(false);
    });

    it('does nothing at all for a signed-out visitor', async () => {
        fx.authState.currentUser = null;
        await mount();
        await refresh();
        expect(fx.ensureAuthTokenReady).not.toHaveBeenCalled();
    });

    it('will not write one account\'s points onto another after a switch mid-flight', async () => {
        fx.syncGamificationProgress.mockImplementation(async () => {
            // The student signed out and back in while the request was open.
            fx.authState.currentUser = { id: 'user-2', points: 0 };
            return { points: 99, badges: [], stats: {} };
        });
        await mount();
        await refresh();
        expect(setCurrentUser).not.toHaveBeenCalled();
    });

    it('accepts a pushed streak from the lantern:streak-updated event', async () => {
        await mount();
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent('lantern:streak-updated', { detail: { streak: 7 } }),
            );
        });
        expect(api.serverStreak).toBe(7);
    });
});
