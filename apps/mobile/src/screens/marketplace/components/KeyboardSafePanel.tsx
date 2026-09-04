/**
 * A block of form controls that is NOT inside a scrollable region, made
 * reachable with the keyboard up.
 *
 * The marketplace filters panel is a plain View in the fixed header chrome, a
 * sibling ABOVE the product list rather than inside it, holding "Min ₦",
 * "Max ₦" and "Pickup or delivery area". That is the founder's "the screen is
 * not always scrollable" report literally: there is no scroll container around
 * those fields, so when the keyboard covers the lower half of a panel that
 * already stacks category chips, a campus picker, a price row, an area row and
 * sort chips, nothing can bring the covered field back into view.
 *
 * A KeyboardAvoidingView cannot fix it either — it lifts a container from the
 * bottom, and this panel is pinned by the chrome above it. What the panel
 * needs is to become scrollable, bounded by the space actually left above the
 * keyboard. That bound is measured, never guessed: the panel's own top edge in
 * window coordinates, against the keyboard's top edge in the same coordinates.
 *
 * With the keyboard down there is no bound at all, so the panel lays out
 * exactly as it did before.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useKeyboardBottomOffset } from './useKeyboardBottomOffset';
import { keyboardSafeMaxHeight } from './keyboardSafeLayout';

export interface KeyboardSafePanelProps {
  children: React.ReactNode;
  /** Class for the outer wrapper — the panel's own padding/gap live here. */
  className?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Class for the scroll CONTENT — the panel's row gap belongs here. */
  contentClassName?: string;
  /** Never shrink below this, so the panel cannot collapse to a sliver. */
  minHeight?: number;
  /** Breathing room between the panel's last row and the keyboard. */
  margin?: number;
}

export function KeyboardSafePanel({
  children,
  className,
  contentContainerStyle,
  contentClassName,
  minHeight = 140,
  margin = 8,
}: KeyboardSafePanelProps) {
  const keyboardOffset = useKeyboardBottomOffset();
  const { height: windowHeight } = useWindowDimensions();
  const ref = useRef<View | null>(null);
  const [topY, setTopY] = useState(0);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y) => {
      if (!Number.isFinite(y)) return;
      const next = Math.max(0, Math.round(y));
      // Commit only real movement, so a remeasure cannot loop.
      setTopY(prev => (Math.abs(prev - next) >= 1 ? next : prev));
    });
  }, []);

  // The panel's top is fixed by the chrome above it, so capping its height
  // cannot move its top — there is no feedback loop between the two.
  const maxHeight = keyboardSafeMaxHeight({
    windowHeight,
    keyboardOffset,
    panelTopY: topY,
    margin,
    minHeight,
  });

  return (
    <View ref={ref} onLayout={onLayout} className={className}>
      <ScrollView
        style={maxHeight ? { maxHeight } : undefined}
        contentContainerStyle={contentContainerStyle}
        contentContainerClassName={contentClassName}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export default KeyboardSafePanel;
