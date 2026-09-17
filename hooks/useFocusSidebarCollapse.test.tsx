// @vitest-environment jsdom
/**
 * Contract test for `hooks/useFocusSidebarCollapse`.
 *
 * Four cases, because the hook's whole value is in the two it must NOT act on:
 * a sidebar the student had already collapsed is not ours to re-open, and a
 * sidebar the student opens mid-studio is not ours to close again. The naive
 * collapse-on-enter / expand-on-leave pair passes the first two and fails both
 * of those, which is why the memory bit exists.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uiState = {
  isSidebarExpanded: true,
  toggleSidebar: () => {
    uiState.isSidebarExpanded = !uiState.isSidebarExpanded;
    toggles += 1;
  },
};
let toggles = 0;

vi.mock('../stores/uiStore', () => ({
  useUIStore: (selector: (s: typeof uiState) => unknown) => selector(uiState),
}));

import { useFocusSidebarCollapse } from './useFocusSidebarCollapse';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe({ focus }: { focus: boolean }) {
  useFocusSidebarCollapse(focus);
  return null;
}

/** Render the probe, and re-render it so the store's new value is read back. */
const show = async (focus: boolean) => {
  await act(async () => {
    root.render(<Probe focus={focus} />);
  });
  await act(async () => {
    root.render(<Probe focus={focus} />);
  });
};

/** The student reaching for the sidebar themselves, mid-studio. */
const studentToggles = async (focus: boolean) => {
  await act(async () => {
    uiState.toggleSidebar();
  });
  await show(focus);
};

function desktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  uiState.isSidebarExpanded = true;
  toggles = 0;
  desktop(true);
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

describe('useFocusSidebarCollapse', () => {
  it('collapses an expanded sidebar on entering focus, and gives it back on leaving', async () => {
    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);

    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
  });

  it('leaves an already-collapsed sidebar alone, and does not force it open on the way out', async () => {
    uiState.isSidebarExpanded = false;
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(toggles).toBe(0);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(toggles).toBe(0);
  });

  it('forgets the collapse was ours once the student re-opens it', async () => {
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await studentToggles(true);
    expect(uiState.isSidebarExpanded).toBe(true);

    // The student now closes it again, deliberately. Leaving must not undo that.
    await studentToggles(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
  });

  it('restores on unmount, not only on a focus flip', async () => {
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(uiState.isSidebarExpanded).toBe(true);

    // afterEach unmounts again; a second unmount of the same root is a no-op.
    root = createRoot(container);
  });

  it('does nothing below lg, where the sidebar is an overlay the shell hides', async () => {
    desktop(false);
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(toggles).toBe(0);

    await show(false);
    expect(toggles).toBe(0);
  });
});
