import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import {
  COMPANION_RAIL_DEFAULTS,
  COMPANION_RAIL_DOCK_MIN_ROW,
  COMPANION_RAIL_WIDTH_CLASS,
  companionRailFit,
  companionRailMode,
  sameCompanionRailFit,
  type CompanionRailFit,
  type CompanionRailMode,
  type CompanionRailSurface,
} from '../components/study/companionRail';

/**
 * Measure the set room and decide what the AI companion is allowed to be.
 *
 * WHAT IT REPLACES (issue #105). `CourseWorkspace` asked
 * `window.matchMedia('(min-width: 1024px)')` whether to dock a 384–512px panel.
 * The window is not the room: the shell puts up to 608px of persistent chrome
 * (the 224px sidebar plus the 384px chats flyout, open by default) to the left
 * of the studio, so at a 1030px viewport the query docked a rail into a room
 * that had ~100px left over, and at a 1006px viewport with the nav stood down it
 * refused to dock into a room with ~940px. This hook observes the room's own row
 * container instead, and `components/study/companionRail` does the arithmetic.
 *
 * ONE OBSERVER, FEW RENDERS. State holds the FIT — three booleans-worth of
 * answer — not the pixel width, and a resize that does not change the answer
 * does not update state at all. Dragging a window edge therefore re-renders the
 * room at most twice (once crossing 608px, once crossing 944px) instead of once
 * per frame.
 *
 * THE FALLBACK IS THE OLD BEHAVIOUR, EXACTLY. Server rendering, and any browser
 * without `ResizeObserver`, never gets a measurement; until one arrives the hook
 * answers from `(min-width: 1024px)` — docked above it, no rail below — so the
 * worst case is the layout this app already shipped.
 *
 * WHAT IS NOT PERSISTED. `request` is a session-only expand: a programmatic open
 * ("Ask Lantern", the focus bar's Chat button, a note attached to a question)
 * shows the companion for that visit without becoming the student's default.
 * It is keyed by SURFACE, so an expand inside a studio does not leak into the
 * set home when the student presses Back — and it is derived rather than reset
 * in an effect, because a reset that lands one render late is a flicker.
 *
 * NO MOTION. Nothing here animates, so there is nothing for
 * `prefers-reduced-motion` to reduce; add a transition and it has to be gated.
 */

export interface CompanionRailController {
  /** Attach to the room's row container — the element whose width is the room. */
  rowRef: (node: HTMLDivElement | null) => void;
  mode: CompanionRailMode;
  /** True when expanding would dock rather than open the overlay. */
  canDock: boolean;
  /** Tailwind width for the docked panel, sized from the row. */
  dockWidthClass: string;
  /**
   * Show the companion. `remember` marks it as the student's own choice for
   * THIS surface; without it the expand lasts only as long as the visit.
   */
  expand: (options?: { remember?: boolean }) => void;
  /** Put the companion back in its rail, and remember that for this surface. */
  collapse: () => void;
}

/** The pre-measurement fallback: the media query the room used to gate on. */
const LEGACY_DOCK_QUERY = '(min-width: 1024px)';

function legacyDockMatches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(LEGACY_DOCK_QUERY).matches;
}

/**
 * The fallback expressed as a row width, so the decision has exactly one shape.
 * At `lg` and above it is the narrowest row that docks; below it, a row too
 * narrow for any rail at all — which is what the app did before.
 */
function fallbackFit(matches: boolean): CompanionRailFit {
  return companionRailFit(matches ? COMPANION_RAIL_DOCK_MIN_ROW : 0);
}

export function useCompanionRail(surface: CompanionRailSurface): CompanionRailController {
  const stored = useUIStore((s) => s.companionRail);
  // `?? default` rather than a bare read: an `ui-storage` blob written before
  // this field existed restores `companionRail: undefined`, and zustand's merge
  // is shallow.
  const preference = stored?.[surface] ?? COMPANION_RAIL_DEFAULTS[surface];

  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<CompanionRailFit | null>(null);
  const [legacyDock, setLegacyDock] = useState(legacyDockMatches);
  const [request, setRequest] = useState<CompanionRailSurface | null>(null);

  // Only ever consulted while `fit` is null — see the fallback note above.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(LEGACY_DOCK_QUERY);
    const sync = () => setLegacyDock(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = (width: number) => {
      const next = companionRailFit(width);
      setFit((prev) => (prev && sameCompanionRailFit(prev, next) ? prev : next));
    };
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') measure(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const effective = fit ?? fallbackFit(legacyDock);
  const mode = companionRailMode(
    effective,
    preference,
    request === surface ? 'expand' : null
  );

  const expand = useCallback(
    (options?: { remember?: boolean }) => {
      // `getState()` at the moment of use, never a value captured at render:
      // the same rule the focus stand-down learned under StrictMode.
      if (options?.remember) {
        useUIStore.getState().setCompanionRailPreference(surface, 'open');
      }
      setRequest(surface);
    },
    [surface]
  );

  const collapse = useCallback(() => {
    useUIStore.getState().setCompanionRailPreference(surface, 'collapsed');
    setRequest(null);
  }, [surface]);

  return {
    rowRef: setNode,
    mode,
    canDock: effective.canDock,
    dockWidthClass: COMPANION_RAIL_WIDTH_CLASS[effective.dockWidth],
    expand,
    collapse,
  };
}

export default useCompanionRail;
