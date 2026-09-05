import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { TabKey } from './tabRouting';

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
  /** Published by CustomTabBar, the one place that knows the focused route. */
  setTabState: (state: { activeTab: TabKey; immersive: boolean }) => void;
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
  setTabState: () => {},
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
  const [tabState, setTabState] = useState<{ activeTab: TabKey; immersive: boolean }>({
    activeTab: 'Home',
    immersive: false,
  });
  const [profile, setProfile] = useState<{
    name: string;
    avatarUri: string | null;
    email: string | null;
  }>({ name: 'Your profile', avatarUri: null, email: null });

  const noop = useCallback(() => {}, []);

  const value = useMemo(
    () => ({
      chromeProgress,
      onScroll: noop,
      showChrome: noop,
      activeTab: tabState.activeTab,
      immersive: tabState.immersive,
      setTabState,
      withinChrome: true,
      setTopBarSuppressed: noop,
      profileName: profile.name,
      profileAvatarUri: profile.avatarUri,
      profileEmail: profile.email,
      setProfile,
    }),
    [chromeProgress, noop, tabState, profile]
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export default ChromeProvider;
