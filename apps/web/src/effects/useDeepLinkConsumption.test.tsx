// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useDeepLinkConsumption`.
 *
 * What the hook promises: it returns nothing; it subscribes to the web
 * notification click channel exactly once; a click carrying `navigate:
 * 'flashcards'` focuses the window and lands the student on the flashcards
 * screen; any other intent is ignored rather than guessed at; and unmounting
 * unsubscribes, so a click is never delivered twice.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const uiState = { setAppMode: vi.fn() };
    const unsubscribe = vi.fn();
    const handlers: Array<(data: { navigate?: string }) => void> = [];
    return {
        uiState,
        unsubscribe,
        handlers,
        onWebNotificationClick: vi.fn((handler: (data: { navigate?: string }) => void) => {
            handlers.push(handler);
            return unsubscribe;
        }),
    };
});

vi.mock('../../../../stores/uiStore', () => ({ useUIStore: () => fx.uiState }));
vi.mock('../../../../utils/webNotifications', () => ({
    onWebNotificationClick: fx.onWebNotificationClick,
}));

import { useDeepLinkConsumption } from '../../../../hooks/effects/useDeepLinkConsumption';
import { AppMode } from '../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe() {
    returned = useDeepLinkConsumption();
    return null;
}

const mount = async () => {
    await act(async () => {
        root.render(<Probe />);
    });
};

beforeEach(() => {
    fx.uiState.setAppMode.mockClear();
    fx.unsubscribe.mockClear();
    fx.onWebNotificationClick.mockClear();
    fx.handlers.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    container.remove();
});

describe('useDeepLinkConsumption', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('subscribes to the notification click channel once', async () => {
        await mount();
        expect(fx.onWebNotificationClick).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });

    it('routes a flashcards click into the flashcards screen', async () => {
        await mount();
        const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
        fx.handlers[0]({ navigate: 'flashcards' });
        expect(focus).toHaveBeenCalled();
        expect(fx.uiState.setAppMode).toHaveBeenCalledWith(AppMode.FLASHCARDS);
        focus.mockRestore();
        await act(async () => root.unmount());
    });

    it('ignores an intent it does not understand rather than guessing', async () => {
        await mount();
        fx.handlers[0]({ navigate: 'somewhere-else' });
        fx.handlers[0]({});
        expect(fx.uiState.setAppMode).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('unsubscribes on unmount so a click cannot be delivered twice', async () => {
        await mount();
        await act(async () => root.unmount());
        expect(fx.unsubscribe).toHaveBeenCalledTimes(1);
    });
});
