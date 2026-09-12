import React, { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../chat/composerKeyboardBehavior';
import { useChrome } from './ChromeContext';
import {
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarClearance,
} from './contextualBarLayout';
import {
  resolveBottomClearance,
  resolveEdgePadding,
  fallbackInsets,
  TAB_BAR_CONTENT_HEIGHT,
  type BottomClearance,
  type ScreenEdge,
  type ScreenEdgeInsets,
} from './screenInsets';

/**
 * THE STATUS-BAR DECISION (founder report 2: "content slides under the clock")
 * ===========================================================================
 * There were two ways to stop the app painting under the status bar:
 *
 *   (a) the screen container reserves `insets.top`, or
 *   (b) App.tsx paints a status-bar-height opaque surface above the navigator.
 *
 * This app takes (a), and (b) is actively wrong here for three reasons:
 *
 *   1. It would double-count. `MainTabsShell` already renders an OPAQUE
 *      `TopBar` in flow whose animated height is `insets.top + 64`, and then
 *      pulls the navigator up by `marginTop: -insets.top`. A second painted
 *      strip above it pushes the entire app down by another `insets.top` on
 *      every tabbed screen — and the 99 screens that already pad themselves
 *      would then be padded twice over.
 *   2. It cannot be undone per screen. Immersive routes (flashcard review, a
 *      chat with a wallpaper, a listing's photo carousel) are SUPPOSED to
 *      paint under the status bar; a global strip takes that away with no way
 *      to opt out.
 *   3. It does not fix the real bug. The overlap that actually reaches users
 *      is on `presentation: 'fullScreenModal'` routes, which are their own
 *      native window — a strip drawn in the root window is not in that window
 *      at all.
 *
 * So the inset stays a screen-container responsibility, and this component is
 * how a screen discharges it. Three things make (a) safe where hand-written
 * `edges` was not:
 *
 *   - `edges` is explicit and defaults to `['top']`, matching the navigator's
 *     otherwise-undocumented `marginTop: -insets.top` contract. A screen that
 *     sits under a header which already paid the inset passes `edges={[]}` and
 *     is not padded twice.
 *   - {@link fallbackInsets} repairs the detached-window case, so a
 *     fullScreenModal route stops reporting 0 on every edge.
 *   - App.tsx now seeds `SafeAreaProvider` with `initialWindowMetrics`, so the
 *     first frame is already correct instead of painting at 0 and jumping.
 */

/**
 * Insets that survive a detached window.
 *
 * Use this instead of `useSafeAreaInsets()` anywhere in a screen. On a route
 * registered with `presentation: 'fullScreenModal'` the app-root
 * SafeAreaProvider never measures the modal's own window, so the raw hook
 * returns 0 on every edge and the screen draws under the clock while looking
 * perfectly correct in source.
 */
export function useScreenInsets(): ScreenEdgeInsets {
  const measured = useSafeAreaInsets();
  const { top, right, bottom, left } = measured;
  return useMemo(
    () => fallbackInsets({ top, right, bottom, left }, initialWindowMetrics?.insets),
    [top, right, bottom, left]
  );
}

/**
 * Whether the absolutely-positioned bottom tab bar is drawn over this route.
 *
 * True only inside MainTabs on a non-immersive route. The auth stack and every
 * root-stack modal are outside `ChromeProvider` and read false, which is why
 * `withinChrome` exists — `immersive` is false in both of those cases too.
 */
export function useTabBarPresent(): boolean {
  const { withinChrome, immersive } = useChrome();
  return withinChrome && !immersive;
}

/**
 * The one correct `behavior` for this app, on both platforms.
 *
 * iOS: `'padding'`. The window never resizes, so the view must pay the
 * keyboard's height itself.
 *
 * Android: `'padding'` from API 35 up, and `undefined` below.
 * Android 15 (API 35) stopped honouring `android:windowSoftInputMode=
 * "adjustResize"` for apps targeting SDK 35+, and this app targets 36 — so a
 * KeyboardAvoidingView with no behavior does literally nothing there, and a
 * screen without one gets no help from the OS at all. Below API 35 the window
 * still resizes itself, and adding padding on top of that lifts the content
 * TWICE — that is the double-count. `'height'` is wrong on both: it disables
 * flex and makes the layout oscillate on Android.
 *
 * This is the same constant the chat composer already uses; it is re-exported
 * rather than re-derived so the two can never disagree.
 */
export const SCREEN_KEYBOARD_BEHAVIOR = COMPOSER_KEYBOARD_BEHAVIOR;

export interface ScreenBottomOptions {
  bottom?: BottomClearance;
  bottomExtra?: number;
  /** Height of the undismissed app-root cookie notice, if the caller pays it. */
  cookieNoticeInset?: number;
}

/**
 * The bottom padding a screen owes, in px. Exposed for screens that put their
 * own footer or list padding together by hand (a FlatList's
 * `contentContainerStyle`, a pinned action bar) but still want the one number.
 */
export function useScreenBottomPadding({
  bottom = 'auto',
  bottomExtra,
  cookieNoticeInset = 0,
}: ScreenBottomOptions = {}): number {
  const insets = useScreenInsets();
  const tabBarPresent = useTabBarPresent();
  const { contextual } = useChrome();
  const base = resolveBottomClearance({
    mode: bottom,
    bottomInset: insets.bottom,
    tabBarPresent,
    extra: bottomExtra,
    cookieNoticeInset,
  });
  // The contextual row (spec v3 §7.2) is 44 dp of chrome above the tab bar.
  // It only exists where the tab bar does, so it is added on exactly the modes
  // that already pay for the bar — a `safe` or `none` screen has neither.
  return contextualBarClearance({
    base,
    contentHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT,
    present: contextual !== null && (bottom === 'tabBar' || (bottom === 'auto' && tabBarPresent)),
  });
}

/**
 * The `keyboardVerticalOffset` a KeyboardAvoidingView needs at this position.
 *
 * RN's KeyboardAvoidingView compares the keyboard's SCREEN y against its own
 * frame from `onLayout`, which is PARENT-relative. The two agree only when the
 * view starts at the top of the window. On a tabbed screen the in-flow TopBar
 * pushes it down ~64px, so the view lifts 64px too little — and the amount
 * differs per route, so it cannot be a shared constant either.
 *
 * Measuring the container's real window position closes the gap and, at the
 * same time, reproduces exactly what the auth screens do today: on the auth
 * stack there is no chrome, the measurement is 0, and the offset disappears.
 *
 * This used to carry a known limit: the measurement did not track the TopBar
 * collapsing on scroll, so with the chrome scrolled away the offset was ~64px
 * too large and the keyboard left a dead band above itself. The bars no longer
 * move (see ChromeContext), so the measured position is now the real one for
 * the whole life of the screen and the caveat is gone.
 */
function useMeasuredKeyboardOffset(): {
  offset: number;
  ref: React.RefObject<View | null>;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const ref = useRef<View | null>(null);
  const [offset, setOffset] = useState(0);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y) => {
      if (!Number.isFinite(y)) return;
      const next = Math.max(0, Math.round(y));
      // Only commit real movement; a sub-pixel remeasure must not re-render.
      setOffset(prev => (Math.abs(prev - next) >= 1 ? next : prev));
    });
  }, []);
  return { offset, ref, onLayout };
}

/** Hoisted so the default does not allocate a new array on every render. */
const DEFAULT_EDGES: readonly ScreenEdge[] = ['top'];

export interface ScreenProps {
  children: React.ReactNode;
  /**
   * Which safe-area insets this container owns. Defaults to `['top']`, the
   * contract every screen inside MainTabs must honour. Pass `[]` when a header
   * above it already pays the top inset (`ScreenHeader safeTop`), so it is not
   * paid twice.
   *
   * `'bottom'` is deliberately not an option — see `bottom` below.
   */
  edges?: readonly ScreenEdge[];
  /**
   * Bottom clearance. `'auto'` (default) pays tab-bar clearance when the
   * bottom tab bar is over this route and the plain system inset otherwise.
   * `'none'` for a screen that pins its own footer.
   *
   * This is separate from `edges` because the bottom is not a plain inset in
   * this app: the tab bar is an `absolute bottom-0` overlay ~86-114px tall, so
   * paying `insets.bottom` alone still buries the last row.
   */
  bottom?: BottomClearance;
  /** Gap added on top of whichever clearance applies. Default 16. */
  bottomExtra?: number;
  /** Room for the undismissed cookie notice (auth flow), in px. Default 0. */
  cookieNoticeInset?: number;
  /** Wrap the body in a KeyboardAvoidingView. Prefer `ScreenScroll` for forms. */
  keyboard?: boolean;
  /** Override the measured keyboard offset; almost never needed. */
  keyboardVerticalOffset?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The screen container: safe-area insets done once, correctly, under
 * edge-to-edge.
 *
 * Fixed screens use it directly. Scrolling screens should use `ScreenScroll`
 * (KeyboardAwareScrollView.tsx), which puts the bottom clearance on the scroll
 * CONTENT container rather than on a wrapper — bottom padding on a
 * ScrollView's own style clips the scrollable extent on Android.
 */
export function Screen({
  children,
  edges = DEFAULT_EDGES,
  bottom = 'auto',
  bottomExtra,
  cookieNoticeInset = 0,
  keyboard = false,
  keyboardVerticalOffset,
  className = 'flex-1 bg-lantern-background',
  style,
  testID,
}: ScreenProps) {
  const insets = useScreenInsets();
  const bottomPadding = useScreenBottomPadding({ bottom, bottomExtra, cookieNoticeInset });
  const measured = useMeasuredKeyboardOffset();

  const padding = useMemo(() => resolveEdgePadding(insets, edges), [insets, edges]);
  const bodyStyle = useMemo<ViewStyle>(
    () => ({ flex: 1, ...padding, paddingBottom: bottomPadding }),
    [padding, bottomPadding]
  );

  const body = <View style={bodyStyle}>{children}</View>;

  if (!keyboard) {
    return (
      <View className={className} style={style} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <View
      className={className}
      style={style}
      testID={testID}
      ref={measured.ref}
      onLayout={measured.onLayout}
    >
      {/* The padding lives on an inner View, never on the KAV's own style:
          `behavior="padding"` composes `{paddingBottom: keyboardHeight}` over
          whatever style it is given, so a paddingBottom passed here would be
          replaced by 0 whenever the keyboard is down. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        keyboardVerticalOffset={keyboardVerticalOffset ?? measured.offset}
        style={{ flex: 1 }}
      >
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}


export default Screen;
