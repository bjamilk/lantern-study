// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useAuthRestore`.
 *
 * This hook carries the most expensive behaviour in the file, and all of it was
 * paid for in production incidents. The cases below are those incidents, not a
 * walk through the code:
 *
 *  - a transient network failure during restore is INCONCLUSIVE: the student
 *    stays signed in, because wiping the session also strands the unsynced work
 *    behind it. A revoked or missing session is a real sign-out,
 *  - SIGNED_OUT is not proof of a sign-out. A refresh-token 400 fires one
 *    spuriously, so the handler asks the authority — the BFF in cookie mode
 *    (where Sentry showed 27 of 39 unexpected sign-outs came from), the stored
 *    session in legacy mode — before clearing anything,
 *  - a logout the student actually asked for is never "recovered",
 *  - fast boot only promotes token-readiness while the stored access token is
 *    still fresh, so a near-expiry token does not fire 401s across the fan-out,
 *  - a hanging /session cannot wedge boot: the restore is raced against 6s.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const authState = {
        currentUser: null as Record<string, unknown> | null,
        isPasswordRecovery: false,
    };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    let authChangeHandler: ((event: string, session: unknown) => Promise<void>) | null = null;
    const unsubscribe = vi.fn();
    const supabase = {
        auth: {
            onAuthStateChange: vi.fn((handler: (event: string, session: unknown) => Promise<void>) => {
                authChangeHandler = handler;
                return { data: { subscription: { unsubscribe } } };
            }),
            getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
            setSession: vi.fn(() => Promise.resolve({ error: null })),
            refreshSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
            signOut: vi.fn(() => Promise.resolve()),
        },
    };
    return {
        authState,
        store,
        unsubscribe,
        supabase,
        fireAuthChange: (event: string, session: unknown) => authChangeHandler!(event, session),
        setCachedAuthToken: vi.fn(),
        fetchUserProfile: vi.fn((..._args: unknown[]) => Promise.resolve(null as unknown)),
        createUserProfile: vi.fn((..._args: unknown[]) => Promise.resolve({} as unknown)),
        ensureAuthTokenReady: vi.fn(() => Promise.resolve(true)),
        bootstrapAuthFromStorage: vi.fn(() => null as unknown),
        readPersistedAuthUser: vi.fn(() => null as unknown),
        shouldRefreshStoredSession: vi.fn(() => false),
        resolveClientSession: vi.fn(() =>
            Promise.resolve({ ok: false, reason: 'missing' } as Record<string, unknown>),
        ),
        clearClientAuthSession: vi.fn(() => Promise.resolve()),
        clearAllClientAuthStorage: vi.fn(),
        getStoredSessionExpiresAt: vi.fn(() => null as unknown),
        isCookieAuthEnabled: vi.fn(() => false),
        exchangeCookieSession: vi.fn(() => Promise.resolve()),
        refreshCookieSession: vi.fn(() => Promise.resolve(null as unknown)),
        reportUnexpectedSignOut: vi.fn(),
        wasRecentIntentionalSignOut: vi.fn(() => false),
        resetSessionExpiredGuard: vi.fn(),
        isAccessTokenFreshEnough: vi.fn(() => true),
        shouldRestorePersistedAuthUser: vi.fn(() => false),
    };
});

vi.mock('../../stores/authStore', () => ({ useAuthStore: fx.store(fx.authState) }));
vi.mock('../../services/supabase', () => ({
    supabase: fx.supabase,
    setCachedAuthToken: fx.setCachedAuthToken,
    fetchUserProfile: fx.fetchUserProfile,
    createUserProfile: fx.createUserProfile,
    ensureAuthTokenReady: fx.ensureAuthTokenReady,
    bootstrapAuthFromStorage: fx.bootstrapAuthFromStorage,
    readPersistedAuthUser: fx.readPersistedAuthUser,
    shouldRefreshStoredSession: fx.shouldRefreshStoredSession,
    resolveClientSession: fx.resolveClientSession,
    clearClientAuthSession: fx.clearClientAuthSession,
    clearAllClientAuthStorage: fx.clearAllClientAuthStorage,
    getStoredSessionExpiresAt: fx.getStoredSessionExpiresAt,
}));
vi.mock('../../services/authCookieSession', () => ({
    isCookieAuthEnabled: fx.isCookieAuthEnabled,
    exchangeCookieSession: fx.exchangeCookieSession,
    refreshCookieSession: fx.refreshCookieSession,
}));
vi.mock('../../services/sentry', () => ({
    reportUnexpectedSignOut: fx.reportUnexpectedSignOut,
    wasRecentIntentionalSignOut: fx.wasRecentIntentionalSignOut,
}));
vi.mock('../../services/sessionHandler', () => ({
    resetSessionExpiredGuard: fx.resetSessionExpiredGuard,
}));
vi.mock('../../utils/authBootstrap', () => ({
    isAccessTokenFreshEnough: fx.isAccessTokenFreshEnough,
    shouldRestorePersistedAuthUser: fx.shouldRestorePersistedAuthUser,
}));

import { useAuthRestore } from './useAuthRestore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setAuthTokenReady = vi.fn();
const setCurrentUser = vi.fn();
const setAuthLoading = vi.fn();
const setPasswordRecovery = vi.fn();
const setDataLoaded = vi.fn();
const setBootstrapLoad = vi.fn();

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({
    currentUser = null,
    isAuthLoading = false,
    authTokenReady = false,
}: {
    currentUser?: unknown;
    isAuthLoading?: boolean;
    authTokenReady?: boolean;
}) {
    returned = useAuthRestore({
        currentUser: currentUser as never,
        isAuthLoading,
        authTokenReady,
        setAuthTokenReady,
        setCurrentUser,
        setAuthLoading,
        setPasswordRecovery,
        setDataLoaded,
        setBootstrapLoad,
    });
    return null;
}

const mount = async (props: Parameters<typeof Probe>[0] = {}) => {
    await act(async () => {
        root.render(<Probe {...props} />);
    });
    await act(async () => {
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
};

const flush = async () => {
    await act(async () => {
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    fx.authState.currentUser = null;
    fx.authState.isPasswordRecovery = false;
    fx.ensureAuthTokenReady.mockResolvedValue(true);
    fx.bootstrapAuthFromStorage.mockReturnValue(null);
    fx.readPersistedAuthUser.mockReturnValue(null);
    fx.resolveClientSession.mockResolvedValue({ ok: false, reason: 'missing' });
    fx.isAccessTokenFreshEnough.mockReturnValue(true);
    fx.isCookieAuthEnabled.mockReturnValue(false);
    fx.wasRecentIntentionalSignOut.mockReturnValue(false);
    fx.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
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

describe('useAuthRestore', () => {
    it('returns nothing, and owns exactly one onAuthStateChange subscription', async () => {
        await mount();
        expect(returned).toBeUndefined();
        expect(fx.supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes on unmount', async () => {
        await mount();
        await act(async () => {
            root.unmount();
        });
        expect(fx.unsubscribe).toHaveBeenCalledTimes(1);
        root = createRoot(container);
    });

    it('paints a signed-in shell from storage and stops the boot spinner', async () => {
        fx.bootstrapAuthFromStorage.mockReturnValue({ token: 'tok', userId: 'user-1' });
        fx.authState.currentUser = { id: 'user-1' };
        await mount();
        expect(setAuthTokenReady).toHaveBeenCalledWith(true);
        expect(setAuthLoading).toHaveBeenCalledWith(false);
    });

    it('withholds token-readiness while the stored token is near expiry (F1 budget)', async () => {
        fx.bootstrapAuthFromStorage.mockReturnValue({ token: 'tok', userId: 'user-1' });
        fx.authState.currentUser = { id: 'user-1' };
        fx.isAccessTokenFreshEnough.mockReturnValue(false);
        fx.resolveClientSession.mockImplementation(() => new Promise(() => {}));
        await mount();
        expect(setAuthTokenReady).not.toHaveBeenCalledWith(true);
    });

    it('keeps a cached student signed in when the restore fails on the network', async () => {
        fx.bootstrapAuthFromStorage.mockReturnValue({ token: 'tok', userId: 'user-1' });
        fx.authState.currentUser = { id: 'user-1' };
        fx.resolveClientSession.mockResolvedValue({ ok: false, reason: 'network' });
        await mount();
        expect(setCurrentUser).not.toHaveBeenCalledWith(null);
        expect(fx.clearAllClientAuthStorage).not.toHaveBeenCalled();
        expect(setAuthTokenReady).toHaveBeenCalledWith(true);
    });

    it('clears a cached student whose session was actually revoked', async () => {
        fx.authState.currentUser = { id: 'user-1' };
        fx.resolveClientSession.mockResolvedValue({ ok: false, reason: 'revoked' });
        await mount();
        expect(fx.clearClientAuthSession).toHaveBeenCalled();
        expect(fx.clearAllClientAuthStorage).toHaveBeenCalled();
        expect(setCurrentUser).toHaveBeenCalledWith(null);
        expect(setDataLoaded).toHaveBeenCalledWith(false);
        expect(setBootstrapLoad).toHaveBeenCalled();
    });

    it('does not wedge boot on a hanging /session', async () => {
        vi.useFakeTimers();
        fx.resolveClientSession.mockImplementation(() => new Promise(() => {}));
        await act(async () => {
            root.render(<Probe />);
        });
        setAuthLoading.mockClear();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        // The 6s race rejected, and the finally clause released the spinner.
        expect(setAuthLoading).toHaveBeenCalledWith(false);
        vi.useRealTimers();
    });

    it('recovers a spurious SIGNED_OUT from the stored session (legacy mode)', async () => {
        fx.authState.currentUser = { id: 'user-1' };
        await mount();
        fx.supabase.auth.getSession.mockResolvedValue({
            data: {
                session: {
                    user: { id: 'user-1' },
                    access_token: 'still-good',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                },
            },
        });
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_OUT', null);
        });
        expect(fx.setCachedAuthToken).toHaveBeenCalledWith('still-good', 'user-1');
        expect(setAuthTokenReady).toHaveBeenCalledWith(true);
        expect(setCurrentUser).not.toHaveBeenCalledWith(null);
        expect(fx.reportUnexpectedSignOut).not.toHaveBeenCalled();
    });

    it('refuses to recover twice inside the cooldown window', async () => {
        // The recovery above already claimed the 15s window; a session that is
        // genuinely dying must sign out rather than ping-pong recover→fail.
        fx.authState.currentUser = { id: 'user-1' };
        await mount();
        fx.supabase.auth.getSession.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_OUT', null);
        });
        expect(fx.supabase.auth.getSession).not.toHaveBeenCalled();
        expect(setCurrentUser).toHaveBeenCalledWith(null);
    });

    it('recovers a spurious SIGNED_OUT from the BFF in cookie mode', async () => {
        // Past the cooldown the previous cases claimed (it is module state, as
        // the real page's is).
        const realNow = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
        fx.isCookieAuthEnabled.mockReturnValue(true);
        fx.authState.currentUser = { id: 'user-1' };
        await mount();
        fx.refreshCookieSession.mockResolvedValue({
            access_token: 'fresh',
            user: { id: 'user-1' },
        });
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_OUT', null);
        });
        expect(fx.refreshCookieSession).toHaveBeenCalled();
        expect(fx.setCachedAuthToken).toHaveBeenCalledWith('fresh', 'user-1');
        expect(setCurrentUser).not.toHaveBeenCalledWith(null);
        clock.mockRestore();
    });

    it('signs the student out for real when the authority agrees the session is gone', async () => {
        fx.authState.currentUser = { id: 'user-1' };
        await mount();
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_OUT', null);
        });
        expect(fx.reportUnexpectedSignOut).toHaveBeenCalledWith(
            expect.objectContaining({ hadUser: true }),
        );
        expect(setCurrentUser).toHaveBeenCalledWith(null);
        expect(setAuthTokenReady).toHaveBeenCalledWith(false);
        expect(setDataLoaded).toHaveBeenCalledWith(false);
    });

    it('never "recovers" a logout the student asked for', async () => {
        fx.authState.currentUser = { id: 'user-1' };
        fx.wasRecentIntentionalSignOut.mockReturnValue(true);
        await mount();
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_OUT', null);
        });
        expect(fx.supabase.auth.getSession).not.toHaveBeenCalled();
        expect(setCurrentUser).toHaveBeenCalledWith(null);
    });

    it('treats PASSWORD_RECOVERY as a token, not a sign-in', async () => {
        await mount();
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('PASSWORD_RECOVERY', {
                access_token: 'reset-token',
                user: { id: 'user-1' },
            });
        });
        expect(setPasswordRecovery).toHaveBeenCalledWith(true);
        expect(fx.fetchUserProfile).not.toHaveBeenCalled();
        expect(setCurrentUser).not.toHaveBeenCalled();
    });

    it('loads the profile on SIGNED_IN', async () => {
        fx.fetchUserProfile.mockResolvedValue({ id: 'user-1', name: 'Ada', settings: {} });
        await mount();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_IN', {
                access_token: 'tok',
                user: { id: 'user-1', email: 'ada@example.com' },
            });
        });
        await flush();
        expect(fx.resetSessionExpiredGuard).toHaveBeenCalled();
        expect(setCurrentUser).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-1', name: 'Ada' }),
        );
    });

    it('signs out a banned account instead of signing it in', async () => {
        fx.fetchUserProfile.mockResolvedValue({
            id: 'user-1',
            name: 'Ada',
            settings: { is_banned: true },
        });
        await mount();
        setCurrentUser.mockClear();
        await act(async () => {
            await fx.fireAuthChange('SIGNED_IN', {
                access_token: 'tok',
                user: { id: 'user-1', email: 'ada@example.com' },
            });
        });
        await flush();
        expect(fx.supabase.auth.signOut).toHaveBeenCalled();
        expect(setCurrentUser).toHaveBeenCalledWith(null);
    });

    it('promotes token-readiness after a login that cached the token early', async () => {
        await mount({ currentUser: { id: 'user-1' }, authTokenReady: false });
        expect(fx.ensureAuthTokenReady).toHaveBeenCalled();
        expect(setAuthTokenReady).toHaveBeenCalledWith(true);
    });

    it('does not re-promote once the token is already ready', async () => {
        await mount({ currentUser: { id: 'user-1' }, authTokenReady: true });
        expect(fx.ensureAuthTokenReady).not.toHaveBeenCalled();
    });
});
