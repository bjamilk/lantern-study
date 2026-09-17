// @vitest-environment jsdom
/**
 * Contract test for `hooks/useFocusSidebarCollapse` and its shell-side twin
 * `useFocusStandDownRestore`.
 *
 * MOUNTED INSIDE `<React.StrictMode>`, WHICH IS NOT DECORATION. index.tsx wraps
 * the whole app in StrictMode, so in the real app every mount effect runs twice
 * with its cleanup in between and NO re-render between the passes. An earlier
 * version of this hook kept its memory in a ref synced on render; under that
 * double invoke the ref was stale on the second pass, so the hook collapsed the
 * sidebar, skipped its own restore, and toggled the sidebar back open — it left
 * the app exactly as it found it, on a page where the unit tests were green. A
 * suite that mounts bare invokes each effect once and can never see that.
 *
 * THE STORE IS A REAL REDUCER HERE, not a set of spies. The whole design of
 * `focusStoodDown` is that the flag and the panel it describes move in ONE
 * update, so a mock that let them be set independently would test nothing. The
 * three actions below are the store's own logic, copied deliberately, and
 * `stores/uiStore.focusStandDown.test.ts` tests the real ones.
 *
 * The viewport helper takes CSS PIXELS rather than a boolean, because the
 * breakpoint itself was once the bug: the founder browses at 125% zoom, where a
 * 1258 device-px window is a 1006 CSS-px viewport — under `lg`, over `md`, and
 * a `matches: true/false` stub cannot express that.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Panel = 'sidebar' | 'chats';

interface UiState {
  isSidebarExpanded: boolean;
  isChatsSectionExpanded: boolean;
  focusStoodDown: { sidebar: boolean; chats: boolean };
  toggleSidebar: () => void;
  setChatsSectionExpanded: (open: boolean) => void;
  standDownForFocus: (panel: Panel) => void;
  restoreFromFocus: (panel: Panel) => void;
  clearFocusStandDown: (panel: Panel) => void;
}

/**
 * Panel <-> field, as an explicit branch rather than an indexed write. A
 * `Record<string, unknown>` cast over the state is a type error in the web
 * root graph (TS2352) and reads as a loophole; the real store branches too.
 */
const isOpen = (panel: Panel) =>
  panel === 'sidebar' ? uiState.isSidebarExpanded : uiState.isChatsSectionExpanded;
const setOpen = (panel: Panel, open: boolean) => {
  if (panel === 'sidebar') uiState.isSidebarExpanded = open;
  else uiState.isChatsSectionExpanded = open;
};

let writes = 0;
const uiState: UiState = {
  isSidebarExpanded: true,
  isChatsSectionExpanded: true,
  focusStoodDown: { sidebar: false, chats: false },
  toggleSidebar: () => {
    uiState.isSidebarExpanded = !uiState.isSidebarExpanded;
    writes += 1;
  },
  setChatsSectionExpanded: (open) => {
    uiState.isChatsSectionExpanded = open;
    writes += 1;
  },
  standDownForFocus: (panel) => {
    if (!isOpen(panel)) return;
    setOpen(panel, false);
    uiState.focusStoodDown = { ...uiState.focusStoodDown, [panel]: true };
    writes += 1;
  },
  restoreFromFocus: (panel) => {
    if (!uiState.focusStoodDown[panel]) return;
    setOpen(panel, true);
    uiState.focusStoodDown = { ...uiState.focusStoodDown, [panel]: false };
    writes += 1;
  },
  clearFocusStandDown: (panel) => {
    if (!uiState.focusStoodDown[panel]) return;
    uiState.focusStoodDown = { ...uiState.focusStoodDown, [panel]: false };
    writes += 1;
  },
};

// The real store is a zustand store: callable with a selector AND carrying
// `getState`. The hooks use both, deliberately — see the StrictMode note.
// Built inside the factory because `vi.mock` is hoisted above every const here.
vi.mock('../stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: UiState) => unknown) => selector(uiState), {
    getState: () => uiState,
  }),
}));

import { useFocusSidebarCollapse, useFocusStandDownRestore } from './useFocusSidebarCollapse';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** The set room: it only mounts on a set route. */
function Room({ focus }: { focus: boolean }) {
  useFocusSidebarCollapse(focus);
  return null;
}

/** The shell: it mounts on every route, room or not. */
function Shell({ focus, room }: { focus: boolean; room: boolean }) {
  useFocusStandDownRestore(focus);
  return room ? <Room focus={focus} /> : null;
}

/**
 * Render inside StrictMode, twice, so the store's new value is read back on a
 * real re-render rather than only inside the effect that wrote it.
 */
const show = async (focus: boolean, { room = true }: { room?: boolean } = {}) => {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <Shell focus={focus} room={room} />
        </React.StrictMode>
      );
    });
  }
};

/**
 * A reload: the tree goes away WITHOUT React unmounting it, so no cleanup runs,
 * and the persisted half of the store comes back exactly as it was.
 */
const reload = async () => {
  const persisted = {
    isSidebarExpanded: uiState.isSidebarExpanded,
    isChatsSectionExpanded: uiState.isChatsSectionExpanded,
    focusStoodDown: uiState.focusStoodDown,
  };
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(uiState, persisted);
  writes = 0;
};

/** The student reaching for a panel themselves, mid-studio. */
const studentTogglesSidebar = async (focus: boolean) => {
  await act(async () => {
    uiState.toggleSidebar();
  });
  await show(focus);
};

/**
 * A viewport that can CHANGE, because the shell's restore listens for that.
 * Lists stay registered across a resize the way a real MediaQueryList does, and
 * `viewport()` notifies them — so widening a narrow window is exercised here
 * rather than assumed.
 */
let mediaLists: { query: string; matches: boolean; on: Set<() => void> }[] = [];
let cssWidth = 1440;

function viewport(cssPixels: number) {
  cssWidth = cssPixels;
  const evaluate = (query: string) =>
    cssWidth >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);

  window.matchMedia = ((query: string) => {
    const existing = mediaLists.find((list) => list.query === query);
    const list = existing ?? { query, matches: evaluate(query), on: new Set<() => void>() };
    if (!existing) mediaLists.push(list);
    list.matches = evaluate(query);
    return {
      get matches() {
        return list.matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => list.on.add(fn),
      removeEventListener: (_: string, fn: () => void) => list.on.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;

  for (const list of mediaLists) {
    const next = evaluate(list.query);
    const changed = next !== list.matches;
    list.matches = next;
    if (changed) for (const fn of [...list.on]) fn();
  }
}

beforeEach(() => {
  uiState.isSidebarExpanded = true;
  uiState.isChatsSectionExpanded = true;
  uiState.focusStoodDown = { sidebar: false, chats: false };
  writes = 0;
  mediaLists = [];
  viewport(1440);
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
    expect(uiState.focusStoodDown).toEqual({ sidebar: true, chats: true });

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });
  });

  it('survives StrictMode’s double mount rather than undoing itself', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <Shell focus room />
        </React.StrictMode>
      );
    });
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
    expect(uiState.focusStoodDown).toEqual({ sidebar: true, chats: true });
  });

  it('leaves already-closed panels alone, and does not force them open on the way out', async () => {
    uiState.isSidebarExpanded = false;
    uiState.isChatsSectionExpanded = false;
    writes = 0;

    await show(true);
    expect(writes).toBe(0);
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
    expect(writes).toBe(0);
  });

  it('forgets the collapse was ours once the student re-opens the sidebar', async () => {
    await show(true);
    await studentTogglesSidebar(true);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.focusStoodDown.sidebar).toBe(false);
    // ONLY its own flag. The flyout is still ours.
    expect(uiState.focusStoodDown.chats).toBe(true);

    // The student now closes it again, deliberately. Leaving must not undo that.
    await studentTogglesSidebar(true);
    await show(false);
    expect(uiState.isSidebarExpanded).toBe(false);
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
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });

    // afterEach unmounts again; a second unmount of the same root is a no-op.
    root = createRoot(container);
  });

  it('stands the nav down at 1006px — over the sidebar’s md, under lg', async () => {
    // The founder's window: 1258 device px at 125% zoom. The sidebar is still a
    // 224px column here, so the nav is still taking width from the studio.
    viewport(1006);
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);

    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
  });

  it('does nothing below the sidebar’s own breakpoint, where it is not drawn', async () => {
    viewport(700);
    await show(true);
    expect(writes).toBe(0);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);

    await show(false);
    expect(writes).toBe(0);
  });
});

/**
 * The reload cases. This is the flaw the persisted flag exists for: a reload
 * inside a studio never runs React's cleanup, so before the memory moved into
 * the store the student came back to a collapsed sidebar with nothing that knew
 * to restore it — and read it as the app collapsing their navigation at random.
 */
describe('surviving a reload inside a studio', () => {
  it('does not toggle again when focus remounts on an already stood-down nav', async () => {
    await show(true);
    expect(uiState.focusStoodDown).toEqual({ sidebar: true, chats: true });

    await reload();
    await show(true);

    // Nothing to CHANGE: both panels are already down and the flags already say
    // so, so `standDownForFocus` is a no-op on each. (StrictMode's extra
    // cleanup+effect pass does restore and re-close in between — it is
    // simulating a leave and a re-enter, and it nets to zero. `writes` is
    // therefore not the assertion; the state is.)
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
    expect(uiState.focusStoodDown).toEqual({ sidebar: true, chats: true });

    // And leaving still restores, on the visit that did not do the collapsing.
    await show(false);
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });
  });

  it('restores from the shell when the next visit lands outside the room', async () => {
    await show(true);
    await reload();

    // Home, or Chat, or anywhere: the room never mounts, so the shell is the
    // only thing that can notice.
    await show(false, { room: false });
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });
  });

  it('keeps the memory through a narrow-width visit instead of spending it', async () => {
    await show(true);
    await reload();

    // A phone-width visit must not clear a desktop-width collapse the student
    // has not seen undone yet — it cannot even see the panels.
    viewport(700);
    await show(false, { room: false });
    expect(writes).toBe(0);
    expect(uiState.focusStoodDown).toEqual({ sidebar: true, chats: true });

    // Back at a width where the sidebar is a column, the restore happens.
    viewport(1006);
    await show(false, { room: false });
    expect(uiState.isSidebarExpanded).toBe(true);
    expect(uiState.isChatsSectionExpanded).toBe(true);
    expect(uiState.focusStoodDown).toEqual({ sidebar: false, chats: false });
  });

  it('does not restore while the student is still inside a studio', async () => {
    await show(true);
    await reload();
    await show(true);
    expect(uiState.isSidebarExpanded).toBe(false);
    expect(uiState.isChatsSectionExpanded).toBe(false);
  });
});
