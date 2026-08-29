import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { TabKey } from './BottomTabBar';

/**
 * Shared state for the app chrome: the top icon bar, the bottom tab bar and
 * the profile drawer. Root screens feed their scroll events in through
 * `onScroll`; scrolling down slides both bars away for reading space and
 * scrolling up brings them back.
 *
 * The default value is inert (bars always shown, drawer never opens) so the
 * same screens keep working when mounted outside MainTabs — OfflineScreen is
 * also registered as a root-stack modal.
 */
interface ChromeContextValue {
  /** 1 = bars visible, 0 = hidden. Drives height/translate animations. */
  chromeProgress: Animated.Value;
  /** Attach to a root screen's main list with `scrollEventThrottle={16}`. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  showChrome: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  activeTab: TabKey;
  immersive: boolean;
  /** Published by CustomTabBar, the one place that knows the focused route. */
  setTabState: (state: { activeTab: TabKey; immersive: boolean }) => void;
  /** A screen borrowing the top-bar row (e.g. chat multi-select) sets this so
      the icons yield their space until the interaction completes. */
  topBarSuppressed: boolean;
  setTopBarSuppressed: (suppressed: boolean) => void;
}

const inertValue: ChromeContextValue = {
  chromeProgress: new Animated.Value(1),
  onScroll: () => {},
  showChrome: () => {},
  drawerOpen: false,
  setDrawerOpen: () => {},
  activeTab: 'Chat',
  immersive: false,
  setTabState: () => {},
  topBarSuppressed: false,
  setTopBarSuppressed: () => {},
};

const ChromeContext = createContext<ChromeContextValue>(inertValue);

export function useChrome(): ChromeContextValue {
  return useContext(ChromeContext);
}

/** Scroll must travel this far in one direction before the bars react. */
const DIRECTION_THRESHOLD = 10;
/** Never hide the bars while this close to the top of the list. */
const TOP_REVEAL_ZONE = 56;

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const chromeProgress = useRef(new Animated.Value(1)).current;
  const shownRef = useRef(true);
  const lastOffsetRef = useRef(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabState, setTabState] = useState<{ activeTab: TabKey; immersive: boolean }>({
    activeTab: 'Chat',
    immersive: false,
  });
  const [topBarSuppressed, setTopBarSuppressed] = useState(false);

  const animateTo = useCallback(
    (shown: boolean) => {
      if (shownRef.current === shown) return;
      shownRef.current = shown;
      Animated.timing(chromeProgress, {
        toValue: shown ? 1 : 0,
        duration: 180,
        // Drives the top bar's height (layout), so the native driver is out.
        useNativeDriver: false,
      }).start();
    },
    [chromeProgress]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      // Ignore iOS rubber-banding above the top.
      if (y < 0) return;
      if (y <= TOP_REVEAL_ZONE) {
        lastOffsetRef.current = y;
        animateTo(true);
        return;
      }
      const delta = y - lastOffsetRef.current;
      if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
      lastOffsetRef.current = y;
      animateTo(delta < 0);
    },
    [animateTo]
  );

  const showChrome = useCallback(() => {
    lastOffsetRef.current = 0;
    animateTo(true);
  }, [animateTo]);

  const value = useMemo(
    () => ({
      chromeProgress,
      onScroll,
      showChrome,
      drawerOpen,
      setDrawerOpen,
      activeTab: tabState.activeTab,
      immersive: tabState.immersive,
      setTabState,
      topBarSuppressed,
      setTopBarSuppressed,
    }),
    [chromeProgress, onScroll, showChrome, drawerOpen, tabState, topBarSuppressed]
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export default ChromeProvider;
