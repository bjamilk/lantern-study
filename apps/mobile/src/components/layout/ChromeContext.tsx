import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { TabKey } from './tabRouting';
import {
  specForRoute,
  type ContextualBarSpec,
  type ContextualScreenAction,
} from '../../navigation/contextualBars';
import {
  planScreenActionDispatch,
  screenActionEntries,
  type ScreenActionHandler,
} from './screenActionDispatch';

/**
 * Shared state for the app chrome: the top bar and the bottom tab bar.
 *
 * THE BARS DO NOT MOVE (2026-09-04)
 * ---------------------------------
 * This context used to slide both bars off screen while you scrolled down and
 * bring them back when you scrolled up. That is gone. A destination the reader
 * can lose by scrolling is not a destination, and the effect fought every
 * other interaction in the app: a keyboard opening scrolled a list, which hid
 * the tab bar; a search field focusing did the same; and a screen that
 * borrowed the top-bar row left the chrome suppressed if its interaction was
 * abandoned.
 *
 * `onScroll`, `showChrome`, `chromeProgress` and `setTopBarSuppressed` are
 * kept as INERT no-ops rather than deleted: eleven screens across the app pass
 * `onScroll={chromeOnScroll}` to their main list and one calls
 * `setTopBarSuppressed`. Removing the fields would be a rename across files
 * this wave does not own, and the honest behaviour — nothing happens — is
 * expressed exactly once, here.
 *
 * `chromeProgress` is a frozen `Animated.Value(1)`, so anything still
 * interpolating on it (a bar's translate, a fade) resolves to "fully shown"
 * for ever.
 *
 * The default value is inert in a second sense: `withinChrome` is false
 * outside MainTabs, which is how a layout primitive tells it is on the auth
 * stack or in a root-stack modal — hosts with NO bottom tab bar at all.
 */
interface ChromeContextValue {
  /**
   * Always 1. Retained so existing interpolations keep type-checking and
   * resolve to "shown"; nothing animates it any more.
   */
  chromeProgress: Animated.Value;
  /** No-op. Kept because eleven screens still pass it to their main list. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** No-op: the chrome is never hidden, so there is nothing to restore. */
  showChrome: () => void;
  activeTab: TabKey;
  /**
   * True on a route that owns the whole window — a fullScreenModal study
   * session, a chat with its own header. Those screens draw their own back
   * arrow and title, so the shared chrome stands down. This is a property of
   * the ROUTE, decided once in navigation/types.ts, never of scrolling.
   */
  immersive: boolean;
  /**
   * The contextual row for the focused route, or null when it has none
   * (spec v3 §7.2). Derived here, from the same `setTabState` publication that
   * already carries `immersive`, so the row is a property of the ROUTE and can
   * never be moved by scrolling, the keyboard or a selection.
   */
  contextual: ContextualBarSpec | null;
  /**
   * The focused route name itself. The row needs it to know which of its own
   * items IS the current screen, which the spec alone cannot say (every Study
   * route maps to the same spec object on purpose).
   */
  contextualRoute: string | undefined;
  /**
   * The focused route's OWN params.
   *
   * The rows the spec asks for below Study are all about one thing the screen
   * is already looking at — Deck detail's four modes are modes of THAT deck,
   * the note editor's Test is a test from THAT note — and a registry entry is
   * a static description of a row, so it cannot carry an id. The params travel
   * with the route publication instead, and the registry says which of them an
   * item inherits. Undefined for a route with no params, which is most of them.
   */
  contextualParams: Record<string, unknown> | undefined;
  /** Published by CustomTabBar, the one place that knows the focused route. */
  setTabState: (state: {
    activeTab: TabKey;
    immersive: boolean;
    focusedRoute?: string;
    focusedParams?: Record<string, unknown>;
  }) => void;
  /**
   * Offer this screen's own contextual actions while it is focused.
   *
   * The row's third kind of item (spec v3 §7.2): not a route and not one of
   * the two app-wide doors, but something the focused SCREEN does in place —
   * the note editor's Learn and Cards. The screen owns the work and the state
   * it needs, so it lends the row a handler for as long as it is on top, and
   * takes it back when it is not. Returns an unregister; prefer the
   * {@link useScreenActions} hook, which ties both ends to focus for you.
   */
  registerScreenActions: (
    route: string,
    /**
     * Keyed by the registry's own `ContextualScreenAction` ids, so a screen
     * cannot register a handler for an action no row will ever ask for.
     */
    actions: Readonly<Partial<Record<ContextualScreenAction, ScreenActionHandler | undefined>>>
  ) => () => void;
  /**
   * Run one, if the named route registered it. Returns whether anything ran.
   *
   * Addressed to a ROUTE and not just an action id: a screen underneath the
   * focused one is still mounted and may have registered the same name, and a
   * row press belongs to the screen the student is looking at.
   */
  runScreenAction: (route: string | undefined, action: ContextualScreenAction) => boolean;
  /**
   * Ask the focused screen's main list to go back to the top.
   *
   * The contextual row's one non-navigating press: an item that resolves to
   * the screen you are already on scrolls to top rather than re-navigating,
   * which React Navigation would treat as a no-op or a silent param merge.
   *
   * This is a channel and not a call: `useScrollToTopRequest` below is how a
   * screen subscribes. React Navigation's own `useScrollToTop` cannot serve
   * here because it listens for `tabPress`, and `tabPress` ALSO pops the stack
   * to its root — emphatically not what "I pressed Tests while on Tests"
   * should do (round-4 invariant 2).
   */
  requestScrollToTop: () => void;
  /** Subscribe to {@link requestScrollToTop}; returns an unsubscribe. */
  subscribeScrollToTop: (handler: () => void) => () => void;
  /**
   * True only inside the real provider, i.e. inside MainTabs. The inert
   * default leaves it false, which is what tells a layout primitive that it is
   * on the auth stack or in a root-stack modal — hosts with NO bottom tab bar.
   * `immersive` alone cannot answer that: it is false in both the tabbed and
   * the untabbed case.
   */
  withinChrome: boolean;
  /**
   * No-op. The top bar is never suppressed: a screen that borrows the row for
   * a selection mode draws its own bar over its own content instead.
   */
  setTopBarSuppressed: (suppressed: boolean) => void;
  /**
   * The signed-in student, published once by the shell so the top bar's avatar
   * and the Me tab show the same face without fetching the profile twice.
   */
  profileName: string;
  profileAvatarUri: string | null;
  profileEmail: string | null;
  setProfile: (profile: {
    name: string;
    avatarUri: string | null;
    email: string | null;
  }) => void;
}

const FROZEN_SHOWN = new Animated.Value(1);

const inertValue: ChromeContextValue = {
  chromeProgress: FROZEN_SHOWN,
  onScroll: () => {},
  showChrome: () => {},
  activeTab: 'Home',
  immersive: false,
  contextual: null,
  contextualRoute: undefined,
  contextualParams: undefined,
  setTabState: () => {},
  registerScreenActions: () => () => {},
  runScreenAction: () => false,
  requestScrollToTop: () => {},
  subscribeScrollToTop: () => () => {},
  withinChrome: false,
  setTopBarSuppressed: () => {},
  profileName: 'Your profile',
  profileAvatarUri: null,
  profileEmail: null,
  setProfile: () => {},
};

const ChromeContext = createContext<ChromeContextValue>(inertValue);

export function useChrome(): ChromeContextValue {
  return useContext(ChromeContext);
}

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  // One frozen value for the life of the provider. `useRef` rather than the
  // module constant so a remount (the font-size re-key) cannot share a value
  // with a torn-down tree.
  const chromeProgress = useRef(new Animated.Value(1)).current;
  const [tabState, setTabState] = useState<{
    activeTab: TabKey;
    immersive: boolean;
    focusedRoute?: string;
    focusedParams?: Record<string, unknown>;
  }>({
    activeTab: 'Home',
    immersive: false,
  });
  const [profile, setProfile] = useState<{
    name: string;
    avatarUri: string | null;
    email: string | null;
  }>({ name: 'Your profile', avatarUri: null, email: null });

  const noop = useCallback(() => {}, []);

  /**
   * The scroll-to-top channel. A Set in a ref rather than state: a screen
   * subscribing must not re-render the whole shell, and the publisher only
   * ever iterates.
   */
  const scrollToTopHandlers = useRef(new Set<() => void>()).current;
  const subscribeScrollToTop = useCallback(
    (handler: () => void) => {
      scrollToTopHandlers.add(handler);
      return () => {
        scrollToTopHandlers.delete(handler);
      };
    },
    [scrollToTopHandlers]
  );
  const requestScrollToTop = useCallback(() => {
    // Copied before iterating: a handler that unsubscribes itself while the
    // set is being walked would otherwise skip the next one.
    for (const handler of Array.from(scrollToTopHandlers)) handler();
  }, [scrollToTopHandlers]);

  /**
   * The screen actions on offer right now, keyed route-and-action.
   *
   * A ref rather than state, for the same reason the scroll-to-top handlers
   * are: a screen lending the row a handler must not re-render the whole
   * shell, and the only reader is a press that happens later.
   */
  const screenActions = useRef(new Map<string, ScreenActionHandler>()).current;
  const registerScreenActions = useCallback(
    (
      route: string,
      actions: Readonly<Partial<Record<ContextualScreenAction, ScreenActionHandler | undefined>>>
    ) => {
      const entries = screenActionEntries(route, actions);
      for (const [key, handler] of entries) screenActions.set(key, handler);
      return () => {
        // Only remove the handler THIS registration put there. A screen that
        // remounts (the font-size re-key remounts the whole app) runs the new
        // effect before the old cleanup, and a blind delete would then leave
        // the row pressing nothing on a screen that is plainly on top.
        for (const [key, handler] of entries) {
          if (screenActions.get(key) === handler) screenActions.delete(key);
        }
      };
    },
    [screenActions]
  );
  const runScreenAction = useCallback(
    (route: string | undefined, action: ContextualScreenAction) => {
      const plan = planScreenActionDispatch({ handlers: screenActions, route, action });
      if (plan.kind !== 'run') return false;
      plan.handler();
      return true;
    },
    [screenActions]
  );

  /**
   * The row is DERIVED, never stored. Storing it would allow a second writer,
   * and a second writer is how a bar starts responding to things that are not
   * the route.
   */
  const contextual = useMemo(
    // The params join the derivation because one destination's row is a
    // property of a SEGMENT of its route rather than of the route name alone:
    // Campus renders Shop inline, so `Campus` + `segment: 'shop'` is the Shop
    // surface and `Campus` + anything else has no row. Still a pure function
    // of the published route — never of scrolling or a selection.
    () => specForRoute(tabState.focusedRoute, tabState.focusedParams),
    [tabState.focusedRoute, tabState.focusedParams]
  );

  const value = useMemo(
    () => ({
      chromeProgress,
      onScroll: noop,
      showChrome: noop,
      activeTab: tabState.activeTab,
      immersive: tabState.immersive,
      contextual,
      contextualRoute: tabState.focusedRoute,
      contextualParams: tabState.focusedParams,
      setTabState,
      registerScreenActions,
      runScreenAction,
      requestScrollToTop,
      subscribeScrollToTop,
      withinChrome: true,
      setTopBarSuppressed: noop,
      profileName: profile.name,
      profileAvatarUri: profile.avatarUri,
      profileEmail: profile.email,
      setProfile,
    }),
    [
      chromeProgress,
      noop,
      tabState,
      contextual,
      requestScrollToTop,
      subscribeScrollToTop,
      registerScreenActions,
      runScreenAction,
      profile,
    ]
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

/**
 * Send this screen's main list back to the top when the contextual row asks.
 *
 * One line per screen:
 *
 *   const listRef = useRef<FlatList<Row>>(null);
 *   useScrollToTopRequest(() => listRef.current?.scrollToOffset({ offset: 0 }));
 *
 * A screen that does not subscribe simply does nothing on that press, which is
 * why this is safe to ship ahead of the screens adopting it.
 */
export function useScrollToTopRequest(handler: () => void): void {
  const { subscribeScrollToTop } = useChrome();
  // The handler is read through a ref so a screen may pass an inline arrow
  // without resubscribing on every render.
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribeScrollToTop(() => latest.current()), [subscribeScrollToTop]);
}

/**
 * Lend the contextual row this screen's own actions while it is focused.
 *
 * One call per screen, naming its route:
 *
 *   useScreenActions('NoteEditor', {
 *     noteLearn: () => scrollToLearnPanel(),
 *     noteFlashcards: canEdit ? handleGenerateFlashcards : undefined,
 *   });
 *
 * Registration follows FOCUS, not mount: the note editor stays mounted under a
 * pushed screen, and its Cards must not be reachable from a row that belongs to
 * something else. An action mapped to `undefined` is not registered at all, so
 * a press falls through to nothing rather than to a handler that would only
 * explain why it cannot run.
 *
 * The handlers are read through a ref, so a screen may pass inline arrows: the
 * registration is redone only when the SET of available actions changes, never
 * on every render.
 */
export function useScreenActions(
  route: string,
  actions: Readonly<Partial<Record<ContextualScreenAction, ScreenActionHandler | undefined>>>
): void {
  const { registerScreenActions } = useChrome();
  const latest = useRef(actions);
  latest.current = actions;
  // The identity of the registration: which actions exist, in a stable order.
  const available = (Object.keys(actions) as ContextualScreenAction[])
    .filter(key => actions[key] !== undefined)
    .sort()
    .join('\u0000');

  useFocusEffect(
    useCallback(() => {
      const stable: Partial<Record<ContextualScreenAction, ScreenActionHandler>> = {};
      for (const action of (available ? available.split('\u0000') : []) as ContextualScreenAction[]) {
        stable[action] = () => latest.current[action]?.();
      }
      return registerScreenActions(route, stable);
    }, [registerScreenActions, route, available])
  );
}

export default ChromeProvider;
