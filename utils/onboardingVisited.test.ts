/**
 * The Home checklist's progress belongs to the ACCOUNT, not the device (#68).
 *
 * PR #81 made the checklist real but device-local: the flags lived only in
 * `uiStore`'s localStorage record, so the same student on a second browser was
 * told to go and open a Library they had already opened. They are now written
 * through to `profile.settings.onboardingVisited` as well.
 *
 * What these pin:
 *  - the merge rule is OR and nothing un-ticks: not a stale device, not a
 *    profile that is missing a flag, in either arrival order;
 *  - the write-through happens on the FIRST visit only — re-entering a surface
 *    costs nothing;
 *  - the patch that goes up carries only `true`s, so no layer between here and
 *    the row can regress a flag;
 *  - signing out leaves the account's copy alone, and a second account on the
 *    same browser does not inherit the first one's ticks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveUserSettingsDetailed = vi.fn(
    async (_userId: string, _patch: Record<string, unknown>) => ({ ok: true } as { ok: boolean }),
);

// Partial mock: `uiStore` pulls `services/notes` -> `services/ai` -> the real
// Supabase module in, so everything except the one call under test has to stay
// as it is.
vi.mock('../services/supabase', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveUserSettingsDetailed: (...args: unknown[]) =>
        (saveUserSettingsDetailed as unknown as (...a: unknown[]) => unknown)(...args),
}));

// The real auth store drags the whole Supabase client, the cookie session and
// Sentry in with it; all this module needs from it is the signed-in user and
// the setter that writes the merged settings back.
vi.mock('../stores/authStore', async () => {
    const { create } = await import('zustand');
    const useAuthStore = create<{
        currentUser: { id: string; settings?: unknown } | null;
        setCurrentUser: (user: { id: string; settings?: unknown } | null) => void;
    }>((set) => ({
        currentUser: null,
        setCurrentUser: (user) => set({ currentUser: user }),
    }));
    return { useAuthStore };
});

import { AppMode } from '../types';
import { useAuthStore } from '../stores/authStore';
import { hasVisitedSurface, useUIStore } from '../stores/uiStore';
import {
    onboardingVisitedPatch,
    recordSurfaceVisit,
    syncOnboardingVisitedFromSettings,
} from './onboardingVisited';

const signIn = (id: string, onboardingVisited?: Record<string, unknown>) =>
    useAuthStore.setState({
        currentUser: {
            id,
            settings: onboardingVisited ? { onboardingVisited } : {},
        },
    } as never);

const signOut = () => useAuthStore.setState({ currentUser: null } as never);

const visitedOf = (userId: string) => useUIStore.getState().visitedSurfaces[userId] ?? {};

/** The `onboardingVisited` object of the single patch that was sent. */
const sentPatch = (call = 0) =>
    (saveUserSettingsDetailed.mock.calls[call]?.[1] as { onboardingVisited?: unknown })
        ?.onboardingVisited;

beforeEach(() => {
    saveUserSettingsDetailed.mockClear();
    saveUserSettingsDetailed.mockResolvedValue({ ok: true });
    useUIStore.setState({ visitedSurfaces: {} });
    signOut();
});

describe('recordSurfaceVisit — write-through on the first visit only', () => {
    it('records locally and sends the account copy the first time', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.FLASHCARDS);

        expect(hasVisitedSurface(useUIStore.getState().visitedSurfaces, 'user-1', 'library')).toBe(
            true,
        );
        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
        expect(saveUserSettingsDetailed.mock.calls[0]?.[0]).toBe('user-1');
        expect(sentPatch()).toEqual({ library: true });
    });

    it('sends nothing when the surface is already ticked', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.FLASHCARDS);
        saveUserSettingsDetailed.mockClear();

        recordSurfaceVisit('user-1', AppMode.FLASHCARDS);
        recordSurfaceVisit('user-1', AppMode.NOTES); // same surface, other mode
        recordSurfaceVisit('user-1', AppMode.LIBRARY);

        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });

    it('sends nothing for a mode that is not a checklist surface, or with no user', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.DASHBOARD);
        recordSurfaceVisit(null, AppMode.MARKETPLACE);

        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
        expect(visitedOf('user-1')).toEqual({});
    });

    it('carries every flag this device knows, and only true ones', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.LIBRARY);
        recordSurfaceVisit('user-1', AppMode.OFFLINE_MODE);

        expect(sentPatch(1)).toEqual({ library: true, offline: true });
        // No `false` anywhere: that is what makes every layer below monotonic.
        expect(Object.values(sentPatch(1) as Record<string, boolean>)).not.toContain(false);
    });

    it('does not surface a failed write, and keeps the local flag', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveUserSettingsDetailed.mockResolvedValue({ ok: false });
        signIn('user-1');

        recordSurfaceVisit('user-1', AppMode.MARKETPLACE);
        await Promise.resolve();
        await Promise.resolve();

        expect(visitedOf('user-1')).toEqual({ marketplace: true });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('updates the profile in memory so the checklist agrees with what was sent', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.MARKETPLACE);

        const settings = useAuthStore.getState().currentUser?.settings as {
            onboardingVisited?: Record<string, boolean>;
        };
        expect(settings.onboardingVisited).toEqual({
            library: false,
            marketplace: true,
            offline: false,
        });
    });
});

describe('syncOnboardingVisitedFromSettings — the merge is an OR', () => {
    it('adds the account flags this device has never seen', () => {
        signIn('user-1', { library: true, offline: true });
        syncOnboardingVisitedFromSettings('user-1', { onboardingVisited: { library: true, offline: true } });

        expect(visitedOf('user-1')).toEqual({ library: true, offline: true });
    });

    it('cannot un-tick a surface this device already recorded', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.LIBRARY);
        saveUserSettingsDetailed.mockClear();

        // A profile that is behind — the write had not landed yet.
        syncOnboardingVisitedFromSettings('user-1', {
            onboardingVisited: { library: false, marketplace: true, offline: false },
        });

        expect(visitedOf('user-1')).toEqual({ library: true, marketplace: true });
    });

    it('pushes back a flag the profile is missing, so a storage wipe cannot lose it', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.LIBRARY);
        saveUserSettingsDetailed.mockClear();

        syncOnboardingVisitedFromSettings('user-1', { onboardingVisited: { marketplace: true } });

        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
        expect(sentPatch()).toEqual({ library: true, marketplace: true });
    });

    it('sends nothing when the profile already knows everything this device does', () => {
        signIn('user-1', { library: true });
        useUIStore.setState({ visitedSurfaces: { 'user-1': { library: true } } });
        saveUserSettingsDetailed.mockClear();

        syncOnboardingVisitedFromSettings('user-1', { onboardingVisited: { library: true } });

        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });

    it('treats a missing or junk settings blob as nothing ticked', () => {
        signIn('user-1');
        syncOnboardingVisitedFromSettings('user-1', null);
        syncOnboardingVisitedFromSettings('user-1', { onboardingVisited: 'yes' });

        expect(visitedOf('user-1')).toEqual({});
        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });
});

describe('two accounts, one browser', () => {
    it('does not let a second account inherit the first one’s ticks', () => {
        signIn('user-1');
        recordSurfaceVisit('user-1', AppMode.LIBRARY);
        recordSurfaceVisit('user-1', AppMode.OFFLINE_MODE);

        // Sign out: the cache is deliberately NOT cleared (it is per-user), and
        // the account's copy on the server is not touched by signing out.
        signOut();
        saveUserSettingsDetailed.mockClear();
        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();

        signIn('user-2');
        syncOnboardingVisitedFromSettings('user-2', {});

        expect(visitedOf('user-2')).toEqual({});
        expect(hasVisitedSurface(useUIStore.getState().visitedSurfaces, 'user-2', 'library')).toBe(
            false,
        );
        // …and the first account's record survived for when they come back.
        expect(visitedOf('user-1')).toEqual({ library: true, offline: true });
        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });
});

describe('onboardingVisitedPatch', () => {
    it('keeps the true flags, drops false and unknown ones', () => {
        expect(
            onboardingVisitedPatch({
                library: true,
                marketplace: false,
                nonsense: true,
            } as never),
        ).toEqual({ library: true });
    });

    it('is empty when nothing is ticked', () => {
        expect(onboardingVisitedPatch({})).toEqual({});
    });
});
