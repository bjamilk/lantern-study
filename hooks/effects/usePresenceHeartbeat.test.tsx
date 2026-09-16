// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/usePresenceHeartbeat`.
 *
 * What the hook promises: it returns nothing; it asks
 * `shouldRunPresenceHeartbeat` first and beats only if that says yes; it beats
 * once immediately and then every two minutes; it stops beating when a beat
 * reports an unrecovered auth failure; and it clears the interval on unmount.
 *
 * `services/presenceHeartbeat` already has its own unit tests
 * (apps/web/src/presenceHeartbeat.test.ts) for the decision and the request —
 * this file covers only the wiring that used to live inside the 2,400-line hook,
 * where none of it could be reached.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    sendPresenceHeartbeat: vi.fn(() => Promise.resolve(true)),
    shouldRunPresenceHeartbeat: vi.fn((..._args: unknown[]) => true),
}));

vi.mock('../../services/presenceHeartbeat', () => ({
    sendPresenceHeartbeat: fx.sendPresenceHeartbeat,
    shouldRunPresenceHeartbeat: fx.shouldRunPresenceHeartbeat,
}));

import { usePresenceHeartbeat } from './usePresenceHeartbeat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = {
    id: 'user-1',
    settings: { privacy: { showOnlineStatus: true } },
} as never;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser, authTokenReady }: { currentUser: unknown; authTokenReady: boolean }) {
    returned = usePresenceHeartbeat({
        currentUser: currentUser as never,
        authTokenReady,
    });
    return null;
}

const mount = async (currentUser: unknown = USER, authTokenReady = true) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} authTokenReady={authTokenReady} />);
    });
};

beforeEach(() => {
    vi.useFakeTimers();
    fx.sendPresenceHeartbeat.mockClear().mockResolvedValue(true);
    fx.shouldRunPresenceHeartbeat.mockClear().mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe('usePresenceHeartbeat', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('asks the service whether to run, passing the resolved privacy preference', async () => {
        await mount();
        expect(fx.shouldRunPresenceHeartbeat).toHaveBeenCalledWith({
            userId: 'user-1',
            authTokenReady: true,
            showOnlineStatus: true,
        });
    });

    it('reports showOnlineStatus false for a signed-out visitor', async () => {
        await mount(null, false);
        expect(fx.shouldRunPresenceHeartbeat).toHaveBeenCalledWith({
            userId: undefined,
            authTokenReady: false,
            showOnlineStatus: false,
        });
    });

    it('does not beat when the service says no', async () => {
        fx.shouldRunPresenceHeartbeat.mockReturnValue(false);
        await mount();
        expect(fx.sendPresenceHeartbeat).not.toHaveBeenCalled();
    });

    it('beats immediately and then every two minutes', async () => {
        await mount();
        expect(fx.sendPresenceHeartbeat).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
        });
        expect(fx.sendPresenceHeartbeat).toHaveBeenCalledTimes(2);
    });

    it('stops beating after an unrecovered auth failure', async () => {
        fx.sendPresenceHeartbeat.mockResolvedValue(false);
        await mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        });
        // The first beat cancelled the interval; nothing after it.
        expect(fx.sendPresenceHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('stops beating on unmount', async () => {
        await mount();
        await act(async () => {
            root.unmount();
        });
        fx.sendPresenceHeartbeat.mockClear();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        });
        expect(fx.sendPresenceHeartbeat).not.toHaveBeenCalled();
        root = createRoot(container);
    });
});
