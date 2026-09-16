// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useThemeDomSync`.
 *
 * What the hook promises: it returns nothing, it reads `theme` from the UI
 * store, and the only things it touches are the `dark` class on <html> and the
 * localStorage 'theme' key — and it writes that key ONLY while a user is signed
 * in, so the forced-light landing page cannot overwrite a student's preference.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uiState = { theme: 'light' as 'light' | 'dark' };
vi.mock('../../stores/uiStore', () => ({
    useUIStore: () => uiState,
}));

import { useThemeDomSync } from './useThemeDomSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 'user-1' } as never;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser }: { currentUser: unknown }) {
    returned = useThemeDomSync({ currentUser: currentUser as never });
    return null;
}

const mount = async (currentUser: unknown) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} />);
    });
};

beforeEach(() => {
    uiState.theme = 'light';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe('useThemeDomSync', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount(USER);
        expect(returned).toBeUndefined();
    });

    it('adds the dark class and stores the choice for a signed-in student', async () => {
        uiState.theme = 'dark';
        await mount(USER);
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(localStorage.getItem('theme')).toBe('dark');
    });

    it('stores light for a signed-in student who chose light', async () => {
        await mount(USER);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(localStorage.getItem('theme')).toBe('light');
    });

    it('forces a signed-out visitor to light WITHOUT overwriting the stored preference', async () => {
        localStorage.setItem('theme', 'dark');
        uiState.theme = 'dark';
        await mount(null);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(localStorage.getItem('theme')).toBe('dark');
    });
});
