// @vitest-environment jsdom
/**
 * Contract test for `hooks/useFocusSidebarCollapse`.
 *
 * MOUNTED INSIDE `<React.StrictMode>`, WHICH IS NOT DECORATION. index.tsx wraps
 * the whole app in StrictMode, so in the real app every mount effect runs
 * twice with its cleanup in between and NO re-render between the passes. The
 * first version of this hook read the sidebar's state out of a ref synced on
 * render; under that double invoke the ref was stale on the second pass, so the
 * hook collapsed the sidebar, skipped its own restore, and then toggled the
 * sidebar back open — it left the app exactly as it found it, on a page where
 * the unit tests were green. A suite that mounts bare invokes each effect once
 * and can never see that. This one would fail for it.
 *
 * Four cases, because the hook's whole value is in the two it must NOT act on:
 * a panel the student had already closed is not ours to re-open, and a panel
 * the student opens mid-studio is not ours to close again.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface UiState {
  isSidebarExpanded: boolean;
  isChatsSectionExpanded: boolean;
  toggleSidebar: () => void;
  setChatsSectionExpanded: (open: boolean) => void;
}

let writes = 0;
const uiState: UiState = {
  isSidebarExpanded: true,
  isChatsSectionExpanded: true,
  toggleSidebar: () => {
    uiState.isSidebarExpanded = !uiState.isSidebarExpanded;
    writes += 1;
  },
  setChatsSectionExpanded: (open: boolean) => {
    uiState.isChatsSectionExpanded = open;
    writes += 1;
  },
};

// The real store is a zustand store: callable with a selector AND carrying
// `getState`. The hook uses both, deliberately — see its StrictMode note.
// Built inside the factory because `vi.mock` is hoisted above every const here.
vi.mock('../stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: UiState) => unknown) => selector(uiState), {
    getState: () => uiState,
  }),
}));

import { useFocusSidebarCollapse } from './useFocusSidebarCollapse';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe({ focus }: { focus: boolean }) {
  useFocusSidebarCollapse(focus);
  return null;
}

/**
 * Render inside StrictMode, twice, so the store's new value is read back on a
 * real re-render rather than only inside the effect that wrote it.
 */
const show = async (focus: boolean) => {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <Probe focus={focus} />
        </React.StrictMode>
      );
    });
  }
};

/** The student reaching for a panel themselves, mid-studio. */
const studentTogglesSidebar = async (focus: boolean) => {
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
  uiState.isChatsSectionExpanded = true;
  writes = 0;
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
  it('stands both panels down on entering focus, and gives them back on leaving', async () => {
    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);

    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
  });

  it('survives StrictMode’s double mount rather than undoing itself', async () => {
    // The regression this file exists for: effect → cleanup → effect, with no
    // re-render between the passes. A hook reading a render snapshot ends the
    // sequence back where it started.
    await act(async () => {
      root.render(
        <React.StrictMode>
          <Probe focus />
        </React.StrictMode>
      );
    });
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
  });

  it('leaves already-closed panels alone, and does not force them open on the way out', async () => {
    uiState.isSidebarExpanded = false;
    uiState.isChatsSectionExpanded = false;
    writes = 0;

    await show(true);
    expect(writes).toBe(0);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
    expect(writes).toBe(0);
  });

  it('forgets the collapse was ours once the student re-opens the sidebar', async () => {
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await studentTogglesSidebar(true);
    expect(uiState.isSidebarExpanded).toBe(true);

    // The student now closes it again, deliberately. Leaving must not undo that.
    await studentTogglesSidebar(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
    // The flyout was ours throughout, so it still comes back.
    expect(uiState.isChatsSectionExpanded).toBe(true);
  });

  it('tracks the two panels separately: reopening the flyout does not free the sidebar', async () => {
    await show(true);
    await act(async () => {
      uiState.setChatsSectionExpanded(true);
    });
    await show(true);

    await show(false);
    expect(uiState.isChatsSectionExpanded).toBe(true); // the student's, untouched
    expect(uiState.isSidebarExpanded).toBe(true); // still ours to restore
  });

  it('restores on unmount, not only on a focus flip', async () => {
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);

    // afterEach unmounts again; a second unmount of the same root is a no-op.
    root = createRoot(container);
  });

  it('does nothing below lg, where both panels are overlays the shell hides', async () => {
    desktop(false);
    await show(true);
    expect(writes).toBe(0);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);

    await show(false);
    expect(writes).toBe(0);
  });
});
