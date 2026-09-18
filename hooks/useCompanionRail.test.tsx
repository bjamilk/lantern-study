// @vitest-environment jsdom
/**
 * `useCompanionRail`, driven the way a real room drives it: a row element whose
 * width changes, inside `<React.StrictMode>`.
 *
 * STRICTMODE IS NOT DECORATION. index.tsx wraps the whole app in it, so every
 * mount effect runs twice with its cleanup in between and no re-render between
 * the passes. The nav stand-down shipped a bug that only existed there (a
 * render-synced ref read stale on the second pass), so anything in this area
 * that decides from state mounts here the same way.
 *
 * The store is the REAL `useUIStore`. The preference is one field and one
 * action; a mock of it would only be able to prove that the mock was called.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCompanionRail, type CompanionRailController } from './useCompanionRail';
import { useUIStore } from '../stores/uiStore';
import { COMPANION_RAIL_DEFAULTS } from '../components/study/companionRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A ResizeObserver that reports whatever `rowWidth` says, because jsdom lays
 * nothing out: every element measures 0 there, so the width has to be supplied.
 */
let rowWidth = 1200;
let observers: { owner: TestResizeObserver; fire: () => void }[] = [];

class TestResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    observers.push({
      owner: this,
      fire: () =>
        this.callback(
          [{ contentRect: { width: rowWidth } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        ),
    });
  }
  unobserve() {}
  /** StrictMode disconnects the first pass's observer; it must go quiet. */
  disconnect() {
    observers = observers.filter((entry) => entry.owner !== this);
  }
}

/** Widen or narrow the room, and let every live observer hear about it. */
const resize = async (width: number) => {
  rowWidth = width;
  await act(async () => {
    for (const entry of [...observers]) entry.fire();
  });
};

let container: HTMLDivElement;
let root: Root;
let rail: CompanionRailController;
let renders = 0;

function Room({ surface }: { surface: 'home' | 'focus' }) {
  rail = useCompanionRail(surface);
  renders += 1;
  return <div ref={rail.rowRef} data-mode={rail.mode} />;
}

const show = async (surface: 'home' | 'focus' = 'home') => {
  await act(async () => {
    root.render(
      <React.StrictMode>
        <Room surface={surface} />
      </React.StrictMode>
    );
  });
};

beforeEach(() => {
  observers = [];
  rowWidth = 1200;
  renders = 0;
  useUIStore.setState({ companionRail: { ...COMPANION_RAIL_DEFAULTS } });
  // `getBoundingClientRect` is the first measurement, before any resize.
  Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: rowWidth, height: 600, top: 0, left: 0, right: 0, bottom: 0 }),
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

describe('deciding from the room, not the window', () => {
  it('docks a roomy set home and collapses a cramped one', async () => {
    await show();
    expect(rail.mode).toBe('docked');

    // The 1280px window with both nav columns open: a 672px room. The old
    // media query docked a 384px rail here and left the studio 288px.
    await resize(672);
    expect(rail.mode).toBe('collapsed');
    expect(rail.canDock).toBe(false);

    await resize(400);
    expect(rail.mode).toBe('none');
  });

  it('starts a studio collapsed even when the room could dock', async () => {
    await show('focus');
    expect(rail.mode).toBe('collapsed');
    expect(rail.canDock).toBe(true);
  });

  it('grows the docked panel on the row, not on the viewport', async () => {
    await show();
    // A 1200px row docks at the reference 400 since wave 4 — it used to take
    // 512, every spare pixel it could reach. See `companionRail.ts`.
    expect(rail.dockWidthClass).toBe('w-[25rem]');
    await resize(950);
    expect(rail.dockWidthClass).toBe('w-96');
  });

  it('re-renders on the answer changing, not on every observed pixel', async () => {
    await show();
    const before = renders;
    await resize(1210);
    await resize(1250);
    await resize(1400);
    // Three resizes that change no answer cost at most ONE render pass (two
    // under StrictMode): `setFit` returns the previous object, and React's
    // bail-out is allowed one render before it takes effect. The failure this
    // guards is a render per observed frame, which is what storing the raw
    // width in state would have cost.
    expect(renders - before).toBeLessThanOrEqual(2);
    // …and still notices a real crossing.
    await resize(700);
    expect(renders).toBeGreaterThan(before);
    expect(rail.mode).toBe('collapsed');
  });
});

describe('the student’s choice, and the app’s', () => {
  it('writes the preference when the student expands, for that surface only', async () => {
    await show('focus');
    await act(async () => rail.expand({ remember: true }));
    expect(rail.mode).toBe('docked');
    expect(useUIStore.getState().companionRail).toEqual({ home: 'open', focus: 'open' });
  });

  it('writes nothing when the app expands the rail for the student', async () => {
    await show('focus');
    await act(async () => rail.expand());
    expect(rail.mode).toBe('docked');
    expect(useUIStore.getState().companionRail).toEqual(COMPANION_RAIL_DEFAULTS);
  });

  it('collapses on request and remembers that', async () => {
    await show();
    await act(async () => rail.collapse());
    expect(rail.mode).toBe('collapsed');
    expect(useUIStore.getState().companionRail).toEqual({ home: 'collapsed', focus: 'collapsed' });
  });

  it('leaves the expand behind when the surface changes', async () => {
    await show('focus');
    await act(async () => rail.expand());
    expect(rail.mode).toBe('docked');

    // Back to the set home, which has its own preference…
    await show('home');
    expect(rail.mode).toBe('docked');
    await act(async () => rail.collapse());
    expect(rail.mode).toBe('collapsed');

    // …and back into the studio, where the session-only expand is spent.
    await show('focus');
    expect(rail.mode).toBe('collapsed');
  });

  it('cannot dock a room that has no space, however it is asked', async () => {
    await resize(700);
    await show();
    expect(rail.mode).toBe('collapsed');
    await act(async () => rail.expand({ remember: true }));
    // The preference is written — it is the student's — but the room still
    // cannot hold a panel, so the rail stays and its button opens the overlay.
    expect(useUIStore.getState().companionRail.home).toBe('open');
    expect(rail.mode).toBe('collapsed');
    expect(rail.canDock).toBe(false);
  });
});

describe('surviving a reload', () => {
  it('comes back collapsed on the surface it was collapsed on', async () => {
    await show();
    await act(async () => rail.collapse());

    // A reload: the tree goes away without React unmounting it, and the
    // persisted half of the store comes back exactly as it was.
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await show();
    expect(rail.mode).toBe('collapsed');
  });
});

describe('without a ResizeObserver', () => {
  const withoutObserver = (matches: boolean) => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
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
  };

  it('docks at lg and above, as the room always did', async () => {
    withoutObserver(true);
    await show();
    expect(rail.mode).toBe('docked');
  });

  it('draws no rail below lg, as the room always did', async () => {
    withoutObserver(false);
    await show();
    expect(rail.mode).toBe('none');
  });
});
