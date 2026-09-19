/**
 * "Skip for now" belongs to the ACCOUNT, not to the browser (#142 follow-up).
 *
 * PR #142 shipped the card with a device-local flag on both clients: web kept
 * it in `uiStore`'s localStorage record and the phone in AsyncStorage, and
 * neither knew about the other. A student who said "I have no syllabus for
 * this set" on the laptop was asked again on the phone. It is now written
 * through to `profile.settings.syncClassSkipped`, the same key the phone
 * reads.
 *
 * What these pin:
 *  - the merge is a union and nothing un-skips a card, in either arrival
 *    order;
 *  - the write-through happens on the FIRST tap only;
 *  - the patch carries timestamps for skipped sets and nothing else, so no
 *    layer below can regress a decision;
 *  - a second account on the same browser does not inherit the first one's
 *    skips.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveUserSettingsDetailed = vi.fn(
    async (_userId: string, _patch: Record<string, unknown>) => ({ ok: true } as { ok: boolean }),
);

// Partial mock, as in `onboardingVisited.test.ts`: `uiStore` pulls the real
// Supabase module in through services/notes, so only the one call under test
// is replaced.
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
import { useUIStore } from '../stores/uiStore';
import {
    recordSyncClassSkip,
    syncClassSkippedFromSettings,
    syncClassSkippedPatch,
} from './syncClassSkipped';

const signIn = (id: string, syncClassSkipped?: Record<string, unknown>) =>
    useAuthStore.setState({
        currentUser: { id, settings: syncClassSkipped ? { syncClassSkipped } : {} },
    } as never);

const skipsOf = (userId: string) => useUIStore.getState().syncClassSkipped[userId] ?? {};

/** The `syncClassSkipped` map of the single patch that was sent. */
const sentPatch = (call = 0): Record<string, number> =>
    (saveUserSettingsDetailed.mock.calls[call]?.[1] as { syncClassSkipped: Record<string, number> })
        .syncClassSkipped;

beforeEach(() => {
    saveUserSettingsDetailed.mockClear();
    useUIStore.setState({ syncClassSkipped: {} });
    signIn('user-1');
});

describe('syncClassSkippedPatch', () => {
    it('carries only the sets that ARE skipped, stamped with a time', () => {
        expect(syncClassSkippedPatch({ 'set-a': true, 'set-b': false }, 1_700)).toEqual({
            'set-a': 1_700,
        });
    });
});

describe('recordSyncClassSkip', () => {
    it('hides the card locally and tells the account', () => {
        recordSyncClassSkip('user-1', 'set-a');

        expect(skipsOf('user-1')['set-a']).toBe(true);
        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
        expect(Object.keys(sentPatch())).toEqual(['set-a']);
    });

    it('writes the merged map back onto the profile in memory', () => {
        recordSyncClassSkip('user-1', 'set-a');

        const settings = useAuthStore.getState().currentUser?.settings as {
            syncClassSkipped: Record<string, number>;
        };
        expect(settings.syncClassSkipped['set-a']).toEqual(expect.any(Number));
    });

    it('sends nothing on the second tap for the same set', () => {
        recordSyncClassSkip('user-1', 'set-a');
        recordSyncClassSkip('user-1', 'set-a');

        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
    });

    it('ignores a missing user or set rather than writing a junk key', () => {
        recordSyncClassSkip(null, 'set-a');
        recordSyncClassSkip('user-1', null);

        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
        expect(skipsOf('user-1')).toEqual({});
    });
});

describe('syncClassSkippedFromSettings — the merge is a union', () => {
    it('hides a card another device skipped', () => {
        signIn('user-1', { 'set-remote': 1_700 });

        syncClassSkippedFromSettings('user-1', { syncClassSkipped: { 'set-remote': 1_700 } });

        expect(skipsOf('user-1')['set-remote']).toBe(true);
    });

    it('never un-skips a set this browser knows and the profile does not', () => {
        recordSyncClassSkip('user-1', 'set-local');
        saveUserSettingsDetailed.mockClear();

        syncClassSkippedFromSettings('user-1', { syncClassSkipped: { 'set-remote': 1_700 } });

        expect(skipsOf('user-1')['set-local']).toBe(true);
        expect(skipsOf('user-1')['set-remote']).toBe(true);
    });

    it('pushes back a skip the profile is missing, so a failed write self-heals', () => {
        useUIStore.setState({ syncClassSkipped: { 'user-1': { 'set-local': true } } });

        syncClassSkippedFromSettings('user-1', { syncClassSkipped: {} });

        expect(saveUserSettingsDetailed).toHaveBeenCalledTimes(1);
        expect(Object.keys(sentPatch())).toEqual(['set-local']);
    });

    it('sends nothing when the profile already has every skip', () => {
        useUIStore.setState({ syncClassSkipped: { 'user-1': { 'set-a': true } } });

        syncClassSkippedFromSettings('user-1', { syncClassSkipped: { 'set-a': 1_700 } });

        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });

    it('survives settings of any shape rather than throwing', () => {
        expect(() => syncClassSkippedFromSettings('user-1', null)).not.toThrow();
        expect(() =>
            syncClassSkippedFromSettings('user-1', { syncClassSkipped: 'set-a' })
        ).not.toThrow();
        expect(skipsOf('user-1')).toEqual({});
    });

    it('does not hand a second account on the same browser the first one’s skips', () => {
        recordSyncClassSkip('user-1', 'set-a');
        saveUserSettingsDetailed.mockClear();
        signIn('user-2');

        syncClassSkippedFromSettings('user-2', { syncClassSkipped: {} });

        expect(skipsOf('user-2')).toEqual({});
        expect(saveUserSettingsDetailed).not.toHaveBeenCalled();
    });
});
