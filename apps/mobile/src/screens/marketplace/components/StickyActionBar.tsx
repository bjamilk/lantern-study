/**
 * The marketplace's pinned bottom action bar, done once.
 *
 * WHY THIS IS NOT `Screen` / `ScreenScroll`
 * -----------------------------------------
 * The shared layout primitives (components/layout) cover a screen container
 * and a keyboard-aware scroller. They deliberately do not cover an
 * ABSOLUTELY-POSITIONED bar, and the two problems this file solves cannot be
 * solved by a KeyboardAvoidingView here:
 *
 *  1. A bar pinned with `absolute bottom-0` cannot scroll, so no amount of
 *     scroll padding reveals a TextInput inside it once the keyboard is up —
 *     and on Android 15+ (this app targets SDK 36) the window is not resized
 *     either, so the OS supplies nothing. The bar itself has to move.
 *  2. RN's KeyboardAvoidingView compares the keyboard's SCREEN y against its
 *     own PARENT-relative `onLayout` frame, so it under-lifts by however much
 *     chrome sits above it — ~64px of in-flow TopBar on a tabbed route, and
 *     that number ANIMATES as the bar collapses on scroll. A constant
 *     `keyboardVerticalOffset` is therefore wrong by construction here.
 *
 * Anchoring to the keyboard's own screen-space top edge sidesteps both: the
 * screen container runs to the bottom of the window under edge-to-edge, so
 * `bottom: keyboardTopFromWindowBottom` puts the bar exactly on the keyboard,
 * with no parent-relative arithmetic to get wrong.
 *
 * It also publishes its measured height, because the other half of the bug is
 * the scroll content behind it: ListingDetail guessed `paddingBottom: 140`
 * against a bar that is conditionally one to four rows tall (~280px with a
 * quantity stepper, a coupon row and two button rows), so ~140px of the page
 * was unreachable. A guessed literal cannot track a conditional bar; a
 * measurement can.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { useScreenBottomPadding } from '../../../components/layout';
import { useKeyboardBottomOffset } from './useKeyboardBottomOffset';
import { stickyBarPaddingBottom } from './keyboardSafeLayout';

export interface StickyActionBarProps {
  children: React.ReactNode;
  /**
   * Called with the bar's measured height (including the clearance it pays),
   * so the scroll content behind it can reserve exactly that much and no
   * literal has to be guessed.
   */
  onHeightChange?: (height: number) => void;
  /**
   * Bottom clearance while the keyboard is CLOSED. `'auto'` (default) resolves
   * to tab-bar clearance on a route the bottom tab bar covers and to the plain
   * system inset otherwise — the distinction that made the same hand-written
   * bar correct in Cart and wrong in Offers.
   */
  bottom?: 'auto' | 'tabBar' | 'safe';
  /** Gap added on top of that clearance. Default 16. */
  bottomExtra?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * A bar pinned to the bottom of the screen that stays above BOTH the
 * absolutely-positioned bottom tab bar and the keyboard.
 */
export function StickyActionBar({
  children,
  onHeightChange,
  bottom = 'auto',
  bottomExtra = 16,
  // `bottom` is owned by the style below, never by the class, so the two
  // cannot fight over which one wins.
  className = 'absolute left-0 right-0 bg-lantern-surface border-t border-lantern-border',
  style,
  accessibilityLabel,
}: StickyActionBarProps) {
  const keyboardOffset = useKeyboardBottomOffset();
  const restingClearance = useScreenBottomPadding({ bottom, bottomExtra });

  // With the keyboard up, the tab bar is behind it: paying its clearance too
  // would strand the bar in a ~102px gap above the keyboard.
  const paddingBottom = stickyBarPaddingBottom({
    keyboardOffset,
    restingClearance,
    keyboardExtra: bottomExtra,
  });

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (Number.isFinite(height)) onHeightChange?.(Math.round(height));
    },
    [onHeightChange]
  );

  const barStyle = useMemo<StyleProp<ViewStyle>>(
    () => [{ bottom: keyboardOffset, paddingBottom }, style],
    [keyboardOffset, paddingBottom, style]
  );

  return (
    <View
      className={className}
      style={barStyle}
      onLayout={handleLayout}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </View>
  );
}

export default StickyActionBar;
