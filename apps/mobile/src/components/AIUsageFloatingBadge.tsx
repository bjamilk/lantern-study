/**
 * Floating AI usage indicator — draggable, and it stays where you put it.
 *
 * It used to be pinned at `top: 50%, right: 16`, anchored to nothing, so
 * whether it covered a control depended on whatever happened to sit at that
 * screen's vertical midpoint at that scroll position. That is what made it feel
 * unpredictable, and the defence — a hand-maintained list of routes to hide it
 * on — could only ever be incomplete (the community LIST screen was not in it,
 * and the badge sat squarely on a row's "Hide" button).
 *
 * Now: press and hold to pick it up, drag, release. It snaps to the nearer edge
 * and is remembered per account on that device. Whenever it is ever in the way,
 * the reader moves it once and it is solved — including on screens nobody has
 * thought of yet. It also fades while the chrome is scrolled away, so it stops
 * competing with the content being read.
 *
 * The position maths lives in utils/floatingBadgePosition (pure, unit-tested);
 * this file is only the gesture, the persistence and the animation, none of
 * which jest can render here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated as RNAnimated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AIUsageBadge from './AIUsageBadge';
import { useChrome } from './layout/ChromeContext';
import { useTabBarClearance, type TabKey } from './layout/BottomTabBar';
import { useAuthStore } from '../stores/authStore';
import {
  anchorFromDrop,
  anchorLeft,
  anchorTop,
  parseBadgeAnchor,
  BADGE_SIZE,
  BADGE_WIDTH,
  DEFAULT_BADGE_ANCHOR,
  type BadgeAnchor,
  type BadgeBounds,
} from '../utils/floatingBadgePosition';

interface Props {
  activeTab: TabKey;
  /** Hide while More sheet, companion, or chat screens are open */
  hidden?: boolean;
  /** Current focused screen inside a tab stack (e.g. GroupChat) */
  focusedRoute?: string;
}

/**
 * Tabs and screens where the badge does not appear at all. This is no longer
 * the collision defence — dragging is — but these are reading surfaces where a
 * floating credit counter does not belong regardless of where it sits.
 */
const HIDDEN_TABS: TabKey[] = ['Chat'];
const HIDDEN_ROUTES = new Set([
  'GroupChat',
  'DirectMessage',
  'TestTaking',
  'CommunityDetail',
  'CommunityChannel',
  'CommunityPost',
  'CommunityMembers',
]);

const storageKey = (userId: string | null) => `lantern:aiBadgeAnchor:${userId ?? 'anon'}`;

/** How long a press must be held before the badge lifts, so a tap still opens it. */
const DRAG_HOLD_MS = 180;

/** One spring for the lift and the settle, so they read as the same object. */
const SPRING = { damping: 18, stiffness: 220 } as const;

export function AIUsageFloatingBadge({ activeTab, hidden = false, focusedRoute }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const bottomClearance = useTabBarClearance();
  const { chromeProgress } = useChrome();
  const userId = useAuthStore(state => state.user?.id ?? null);

  const [anchor, setAnchor] = useState<BadgeAnchor>(DEFAULT_BADGE_ANCHOR);
  const [size, setSize] = useState({ width: BADGE_WIDTH, height: BADGE_SIZE });
  const [dragging, setDragging] = useState(false);

  const bounds: BadgeBounds = useMemo(
    () => ({
      width,
      height,
      topInset: insets.top,
      bottomClearance,
      badgeWidth: size.width,
      badgeSize: size.height,
    }),
    [width, height, insets.top, bottomClearance, size.width, size.height]
  );

  // Resting position for the current anchor, recomputed when the window or the
  // insets change — a rotation or a split-screen must not strand it off-screen.
  const restLeft = anchorLeft(anchor, bounds);
  const restTop = anchorTop(anchor, bounds);

  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  /** 0 at rest, 1 while held — drives the pick-up scale on the UI thread. */
  const lifted = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    const key = storageKey(userId);
    void AsyncStorage.getItem(key)
      .then(raw => {
        if (cancelled || !raw) return;
        try {
          setAnchor(parseBadgeAnchor(JSON.parse(raw)));
        } catch {
          // A corrupt value is not worth surfacing; the default is correct.
        }
      })
      .catch(() => {
        // No stored position is the normal first-run case, not an error.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const commitAnchor = useCallback(
    (dropLeft: number, dropTop: number) => {
      const next = anchorFromDrop({ left: dropLeft, top: dropTop }, bounds);
      const nextLeft = anchorLeft(next, bounds);
      const nextTop = anchorTop(next, bounds);
      setAnchor(next);
      // `anchor` moves the container to its snapped rest position immediately.
      // Rebase the offset onto that new origin FIRST so the badge is still
      // drawn under the finger, then let it spring to zero — otherwise the
      // horizontal snap teleports instead of settling.
      offsetX.value = dropLeft - nextLeft;
      offsetY.value = dropTop - nextTop;
      offsetX.value = withSpring(0, SPRING);
      offsetY.value = withSpring(0, SPRING);
      lifted.value = withSpring(0, SPRING);
      setDragging(false);
      void AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => {
        // Losing the position is a far smaller harm than a crash on a write.
      });
    },
    [bounds, lifted, offsetX, offsetY, userId]
  );

  const beginDrag = useCallback(() => setDragging(true), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Hold before the badge lifts, so a plain tap still reaches the badge's
        // own press handler and opens the usage sheet.
        .activateAfterLongPress(DRAG_HOLD_MS)
        .onStart(() => {
          lifted.value = withSpring(1, SPRING);
          runOnJS(beginDrag)();
        })
        .onChange(event => {
          offsetX.value += event.changeX;
          offsetY.value += event.changeY;
        })
        .onEnd(() => {
          runOnJS(commitAnchor)(restLeft + offsetX.value, restTop + offsetY.value);
        }),
    [beginDrag, commitAnchor, lifted, offsetX, offsetY, restLeft, restTop]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: 1 + lifted.value * 0.08 },
    ],
  }));

  if (hidden || HIDDEN_TABS.includes(activeTab) || (focusedRoute && HIDDEN_ROUTES.has(focusedRoute))) {
    return null;
  }

  return (
    <RNAnimated.View
      style={[
        styles.container,
        { left: restLeft, top: restTop },
        // Fade with the chrome while the reader is scrolling, but never all the
        // way out while it is being dragged.
        { opacity: dragging ? 1 : chromeProgress },
      ]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          style={animatedStyle}
          onLayout={event => {
            const { width: w, height: h } = event.nativeEvent.layout;
            if (w > 0 && h > 0 && (Math.abs(w - size.width) >= 1 || Math.abs(h - size.height) >= 1)) {
              setSize({ width: w, height: h });
            }
          }}
          accessible={false}
          accessibilityHint="Press and hold to move this badge"
        >
          <View pointerEvents="auto">
            <AIUsageBadge interactive />
          </View>
        </Animated.View>
      </GestureDetector>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 40,
  },
});
