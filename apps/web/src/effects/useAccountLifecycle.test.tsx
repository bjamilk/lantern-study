// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useAccountLifecycle`.
 *
 * What the hook promises, in the order its four effects must keep:
 *  1. a foreign offline queue is purged through the LIVE stores, and only when
 *     `ensureOfflineQueueOwner` says this browser's queue belongs elsewhere,
 *  2. a signed-in student's appearance settings reach the DOM through
 *     `applyUserSettingsToDom`; a signed-out visitor falls back to the stored
 *     'theme' value and nothing else,
 *  3. canonical settings are fetched once per signed-in session and merged
 *     last-write-wins by `updatedAt`, ties going to the server,
 *  4. the profile-setup prompt opens only after onboarding is complete.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const authState = { currentUser: null as unknown };
    const testState = { setPendingSyncResults: vi.fn() };
    const flashcardState = { clearPendingReviews: vi.fn() };
    const uiState = { setTheme: vi.fn(), setLowDataMode: vi.fn(), openModal: vi.fn() };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    return {
        authState,
        testState,
        flashcardState,
        uiState,
        store,
        ensureOfflineQueueOwner: vi.fn((..._args: unknown[]) => false),
        fetchUserSettings: vi.fn((..._args: unknown[]) => Promise.resolve(null as unknown)),
        applyUserSettingsToDom: vi.fn(),
        shouldOpenAcademicSetup: vi.fn((..._args: unknown[]) => false),
        readAcademicSetupDismissed: vi.fn((..._args: unknown[]) => null as unknown),
    };
});

vi.mock('../../../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../../../stores/testStore', () => ({ useTestStore: fx.store(fx.testState) }));
vi.mock('../../../../stores/flashcardStore', () => ({
    useFlashcardStore: fx.store(fx.flashcardState),
}));
vi.mock('../../../../stores/uiStore', () => ({ useUIStore: fx.store(fx.uiState) }));
vi.mock('../../../../services/supabase', () => ({ fetchUserSettings: fx.fetchUserSettings }));
vi.mock('../../../../services/offlineQueueOwner', () => ({
    ensureOfflineQueueOwner: fx.ensureOfflineQueueOwner,
}));
vi.mock('../../../../utils/applyUserSettingsToDom', () => ({
    applyUserSettingsToDom: fx.applyUserSettingsToDom,
}));
vi.mock('../../../../utils/academicSetup', () => ({
    shouldOpenAcademicSetup: fx.shouldOpenAcademicSetup,
    readAcademicSetupDismissed: fx.readAcademicSetupDismissed,
}));

import { useAccountLifecycle } from '../../../../hooks/effects/useAccountLifecycle';
import { ONBOARDING_COMPLETE_STORAGE_KEY } from '@lantern/shared/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = {
    id: 'user-1',
    username: 'ada',
    settings: { appearance: { theme: 'dark' }, updatedAt: '2026-01-01T00:00:00.000Z' },
} as never;

const setCurrentUser = vi.fn();

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser, authTokenReady }: { currentUser: unknown; authTokenReady: boolean }) {
    returned = useAccountLifecycle({
        currentUser: currentUser as never,
        authTokenReady,
        setCurrentUser,
    });
    return null;
}

const mount = async (currentUser: unknown = USER, authTokenReady = true) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} authTokenReady={authTokenReady} />);
    });
};

beforeEach(() => {
    localStorage.clear();
    // Onboarding finished, so the profile-setup effect is allowed to run.
    localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, 'true');
    fx.authState.currentUser = USER;
    fx.testState.setPendingSyncResults.mockClear();
    fx.flashcardState.clearPendingReviews.mockClear();
    fx.uiState.setTheme.mockClear();
    fx.uiState.setLowDataMode.mockClear();
    fx.uiState.openModal.mockClear();
    fx.ensureOfflineQueueOwner.mockClear().mockReturnValue(false);
    fx.fetchUserSettings.mockClear().mockResolvedValue(null);
    fx.applyUserSettingsToDom.mockClear();
    fx.shouldOpenAcademicSetup.mockClear().mockReturnValue(false);
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

describe('useAccountLifecycle', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('purges both offline queues when this browser owned another account\'s', async () => {
        fx.ensureOfflineQueueOwner.mockReturnValue(true);
        await mount();
        expect(fx.ensureOfflineQueueOwner).toHaveBeenCalledWith('user-1');
        expect(fx.testState.setPendingSyncResults).toHaveBeenCalledWith([]);
        expect(fx.flashcardState.clearPendingReviews).toHaveBeenCalled();
    });

    it('leaves the queues alone when they already belong to this account', async () => {
        await mount();
        expect(fx.testState.setPendingSyncResults).not.toHaveBeenCalled();
        expect(fx.flashcardState.clearPendingReviews).not.toHaveBeenCalled();
    });

    it('applies a signed-in student\'s settings to the DOM', async () => {
        await mount();
        expect(fx.applyUserSettingsToDom).toHaveBeenCalled();
        expect(fx.applyUserSettingsToDom.mock.calls[0][1]).toMatchObject({
            setTheme: fx.uiState.setTheme,
            setLowDataMode: fx.uiState.setLowDataMode,
        });
    });

    it('falls back to the stored theme for a signed-out visitor', async () => {
        localStorage.setItem('theme', 'dark');
        fx.authState.currentUser = null;
        await mount(null, false);
        expect(fx.applyUserSettingsToDom).not.toHaveBeenCalled();
        expect(fx.uiState.setTheme).toHaveBeenCalledWith('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('fetches canonical settings once the auth token is ready, and keeps the newer copy', async () => {
        // Newer than anything normalizeUserSettings can stamp on the local copy,
        // so this is unambiguously the last write.
        fx.fetchUserSettings.mockResolvedValue({
            updatedAt: '2099-01-01T00:00:00.000Z',
            appearance: { theme: 'light' },
        });
        await mount();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(fx.fetchUserSettings).toHaveBeenCalledWith('user-1');
        expect(setCurrentUser).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: expect.objectContaining({ updatedAt: '2099-01-01T00:00:00.000Z' }),
            }),
        );
    });

    it('keeps the local copy when the server\'s is older, and still syncs the DOM', async () => {
        fx.fetchUserSettings.mockResolvedValue({
            updatedAt: '2000-01-01T00:00:00.000Z',
            appearance: { theme: 'light' },
        });
        await mount();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(setCurrentUser).not.toHaveBeenCalled();
        expect(fx.applyUserSettingsToDom).toHaveBeenCalledTimes(2);
    });

    it('does not fetch settings before the auth token is ready', async () => {
        await mount(USER, false);
        expect(fx.fetchUserSettings).not.toHaveBeenCalled();
    });

    it('opens the profile-setup prompt when academic identity is missing', async () => {
        fx.shouldOpenAcademicSetup.mockReturnValue(true);
        await mount();
        expect(fx.uiState.openModal).toHaveBeenCalledWith('usernameRequired');
    });

    it('stays quiet while onboarding is still pending — onboarding asks first', async () => {
        localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY);
        fx.shouldOpenAcademicSetup.mockReturnValue(true);
        await mount();
        expect(fx.uiState.openModal).not.toHaveBeenCalled();
    });
});
