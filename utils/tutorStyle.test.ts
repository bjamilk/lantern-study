/**
 * Picking a tutor style writes it to the ACCOUNT, and to memory first.
 *
 * The write-through is the whole point: the header chip, the greeting line and
 * the next send all read the profile in memory, so if the pick only went to the
 * network the student would choose Coach and watch nothing change until a
 * reload. What these pin:
 *  - the profile in memory is updated synchronously, before the save;
 *  - the patch that goes up is `tutorStyle` ONLY, so a concurrent theme or
 *    checklist save is not clobbered;
 *  - junk never reaches the profile or the wire — it becomes `default`;
 *  - a failed save is not a lost pick: the style is already in effect locally;
 *  - signed out, picking is a no-op rather than a crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveUserSettingsDetailed = vi.fn(
    async (_userId: string, _patch: Record<string, unknown>) => ({ ok: true } as { ok: boolean }),
);

// Partial mock for the same reason `onboardingVisited.test.ts` gives: this
// module's one network call is all that may be stubbed; the rest of the
// Supabase module is dragged in by everything around it.
vi.mock('../services/supabase', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveUserSettingsDetailed: (...args: unknown[]) =>
        (saveUserSettingsDetailed as unknown as (...a: unknown[]) => unknown)(...args),
}));

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

import { useAuthStore } from '../stores/authStore';
import { currentTutorStyleId, setTutorStyle } from './tutorStyle';

const signIn = (settings?: unknown) =>
    useAuthStore.setState({ currentUser: { id: 'u1', settings: settings ?? {} } } as never);

const storedStyle = () =>
    (useAuthStore.getState().currentUser?.settings as { tutorStyle?: unknown } | undefined)
        ?.tutorStyle;

/** The patch body of the nth save. */
const sentPatch = (call = 0) =>
    saveUserSettingsDetailed.mock.calls[call]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
    saveUserSettingsDetailed.mockClear();
    saveUserSettingsDetailed.mockResolvedValue({ ok: true });
    useAuthStore.setState({ currentUser: null } as never);
});

describe('reading the account style', () => {
    it('reads the four ids back', () => {
        for (const id of ['default', 'coach', 'professor', 'peer']) {
            expect(currentTutorStyleId({ tutorStyle: id })).toBe(id);
        }
    });

    it('is default for an account that has never picked one, or stored junk', () => {
        for (const settings of [null, undefined, {}, 'nonsense', { tutorStyle: 'drill-sergeant' }]) {
            expect(currentTutorStyleId(settings)).toBe('default');
        }
    });
});

describe('picking one', () => {
    it('updates the profile in memory before the save, so the chip moves at once', () => {
        signIn({ tutorStyle: 'default' });
        setTutorStyle('coach');

        // Synchronous: no await between the pick and this read.
        expect(storedStyle()).toBe('coach');
        expect(currentTutorStyleId(useAuthStore.getState().currentUser?.settings)).toBe('coach');
    });

    it('sends a tutorStyle-only patch', () => {
        signIn({ tutorStyle: 'default' });
        setTutorStyle('professor');

        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
        expect(saveUserSettingsDetailed.mock.calls[0]?.[0]).toBe('u1');
        expect(sentPatch()).toEqual({ tutorStyle: 'professor' });
    });

    it('carries the rest of the settings blob forward untouched', () => {
        signIn({ tutorStyle: 'default', appearance: { theme: 'dark' } });
        setTutorStyle('peer');

        expect(
            (useAuthStore.getState().currentUser?.settings as { appearance?: unknown }).appearance
        ).toEqual({ theme: 'dark' });
    });

    it('normalises junk to default rather than storing or sending it', () => {
        signIn({ tutorStyle: 'coach' });
        expect(setTutorStyle('drill-sergeant')).toBe('default');

        expect(storedStyle()).toBe('default');
        expect(sentPatch()).toEqual({ tutorStyle: 'default' });
    });

    it('keeps the pick when the save fails — there is nothing to undo', async () => {
        saveUserSettingsDetailed.mockResolvedValue({ ok: false });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signIn({ tutorStyle: 'default' });

        setTutorStyle('coach');
        await Promise.resolve();
        await Promise.resolve();

        expect(storedStyle()).toBe('coach');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('does nothing when nobody is signed in', () => {
        expect(setTutorStyle('coach')).toBe('coach');
        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
        expect(useAuthStore.getState().currentUser).toBeNull();
    });
});
