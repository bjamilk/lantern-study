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
import type { TabKey } from './tabRouting';
import { specForRoute, type ContextualBarSpec } from '../../navigation/contextualBars';

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
  /** Published by CustomTabBar, the one place that knows the focused route. */
  setTabState: (state: {
    activeTab: TabKey;
    immersive: boolean;
    focusedRoute?: string;
  }) => void;
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
  setTabState: () => {},
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
   * The row is DERIVED, never stored. Storing it would allow a second writer,
   * and a second writer is how a bar starts responding to things that are not
   * the route.
   */
  const contextual = useMemo(
    () => specForRoute(tabState.focusedRoute),
    [tabState.focusedRoute]
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
      setTabState,
      requestScrollToTop,
      subscribeScrollToTop,
      withinChrome: true,
      setTopBarSuppressed: noop,
      profileName: profile.name,
      profileAvatarUri: profile.avatarUri,
      profileEmail: profile.email,
      setProfile,
    }),
    [chromeProgress, noop, tabState, contextual, requestScrollToTop, subscribeScrollToTop, profile]
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

export default ChromeProvider;
