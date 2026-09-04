import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import type {
  KeyboardEvent,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  SCREEN_KEYBOARD_BEHAVIOR,
  Screen,
  useScreenBottomPadding,
  type ScreenProps,
} from './Screen';
import { scrollDeltaToRevealInput, type BottomClearance } from './screenInsets';

/**
 * WHY A SCROLLVIEW ALONE IS NOT ENOUGH ON THIS APP
 * ------------------------------------------------
 * Android 15 (API 35) stopped honouring `windowSoftInputMode="adjustResize"`
 * for apps targeting SDK 35+, and this app targets 36 with edge-to-edge on.
 * The window therefore does NOT shrink when the keyboard opens: the scroll
 * viewport keeps its full height, gains no extra scroll range, and the user
 * cannot scroll a covered input or a covered submit button into view. "It is
 * inside a ScrollView so they can scroll to it" is false here.
 *
 * So this component supplies all three halves of the fix together, because any
 * one of them alone still fails:
 *
 *   1. a KeyboardAvoidingView with `behavior={SCREEN_KEYBOARD_BEHAVIOR}` —
 *      'padding' on iOS and Android 35+, `undefined` below 35 where the window
 *      still resizes itself and padding would lift the content twice;
 *   2. `keyboardShouldPersistTaps="handled"`, so a button that is still
 *      reachable fires on the FIRST tap instead of the tap being swallowed to
 *      dismiss the keyboard;
 *   3. an explicit scroll to the focused input, since the OS will not resize
 *      the viewport for us.
 */

export interface KeyboardAwareScrollViewProps extends Omit<ScrollViewProps, 'children'> {
  children: React.ReactNode;
  /**
   * Bottom padding for the scroll CONTENT container, in px. Put it here and
   * never on the ScrollView's own `style`/`className`: vertical padding on the
   * outer style clips the scrollable extent on Android.
   */
  bottomPadding?: number;
  /** Breathing room left between the focused input and the keyboard. */
  revealMargin?: number;
  /** Disable the explicit scroll-to-focused-input pass. */
  autoRevealFocusedInput?: boolean;
  /** Position offset for the KeyboardAvoidingView; see `Screen`. */
  keyboardVerticalOffset?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollableRef?: React.RefObject<ScrollView | null>;
}

/**
 * A keyboard-aware scroller. Usable on its own inside a bottom sheet or a
 * modal, where there is no `Screen` around it — that is the shape that is
 * missing from every sheet in the app today.
 */
export function KeyboardAwareScrollView({
  children,
  bottomPadding = 0,
  revealMargin = 16,
  autoRevealFocusedInput = true,
  keyboardVerticalOffset = 0,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  scrollEventThrottle = 16,
  onScroll,
  scrollableRef,
  style,
  ...rest
}: KeyboardAwareScrollViewProps) {
  const innerRef = useRef<ScrollView | null>(null);
  const ref = scrollableRef ?? innerRef;
  const offsetRef = useRef(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll]
  );

  useEffect(() => {
    if (!autoRevealFocusedInput) return;
    // iOS fires `will*` before the frame lands, Android only `did*`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const subscription = Keyboard.addListener(showEvent, (event: KeyboardEvent) => {
      const keyboardTopY = event?.endCoordinates?.screenY;
      if (typeof keyboardTopY !== 'number') return;
      // Let the KeyboardAvoidingView's padding land first, or the input is
      // measured at the position it is about to leave.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        if (!input?.measureInWindow) return;
        input.measureInWindow((_x, y, _width, height) => {
          const delta = scrollDeltaToRevealInput({
            inputBottomY: y + height,
            keyboardTopY,
            margin: revealMargin,
          });
          if (delta <= 0) return;
          ref.current?.scrollTo({ y: offsetRef.current + delta, animated: true });
        });
      }, 80);
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [autoRevealFocusedInput, revealMargin, ref]);

  const contentStyle = useMemo<StyleProp<ViewStyle>>(
    // Only override when there is a clearance to apply. Composing
    // `{paddingBottom: 0}` unconditionally would SILENTLY ZERO a caller that
    // put its own clearance on `contentContainerStyle` and did not know about
    // the `bottomPadding` prop — the bug this file exists to prevent.
    () => (bottomPadding > 0 ? [contentContainerStyle, { paddingBottom: bottomPadding }] : contentContainerStyle),
    [contentContainerStyle, bottomPadding]
  );

  return (
    <KeyboardAvoidingView
      behavior={SCREEN_KEYBOARD_BEHAVIOR}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={{ flex: 1 }}
    >
      <ScrollView
        ref={ref}
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        scrollEventThrottle={scrollEventThrottle}
        onScroll={handleScroll}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export interface ScreenScrollProps
  extends Omit<ScreenProps, 'children' | 'keyboard' | 'bottom' | 'bottomExtra'>,
    Omit<KeyboardAwareScrollViewProps, 'bottomPadding' | 'keyboardVerticalOffset'> {
  /** See `Screen`. Defaults to `'auto'`. */
  bottom?: BottomClearance;
  bottomExtra?: number;
  /**
   * Style/class for the OUTER safe-area container. `style` and `className`
   * (inherited from ScrollViewProps) go to the scroller instead, so the two
   * layers stay separately addressable.
   */
  containerStyle?: StyleProp<ViewStyle>;
  containerClassName?: string;
}

/**
 * The everyday screen shape: safe-area container + keyboard-aware scroller,
 * with the bottom clearance landing on the scroll content container where it
 * belongs.
 *
 * This is the auth screens' pattern — the one area the audit found fully
 * covered — generalised so no screen has to remember any of it:
 *
 *   SafeAreaView > KeyboardAvoidingView(behavior) > ScrollView(flex-grow, padding)
 */
export function ScreenScroll({
  children,
  edges,
  bottom = 'auto',
  bottomExtra,
  cookieNoticeInset = 0,
  containerStyle,
  containerClassName,
  testID,
  contentContainerStyle,
  ...scrollProps
}: ScreenScrollProps) {
  const bottomPadding = useScreenBottomPadding({ bottom, bottomExtra, cookieNoticeInset });
  const keyboardOffsetRef = useRef<View | null>(null);
  const [offset, setOffset] = React.useState(0);

  // Same measurement as `Screen`: RN's KeyboardAvoidingView compares the
  // keyboard's screen Y against a PARENT-relative frame, so it under-lifts by
  // however much chrome sits above it. Measuring closes the gap and collapses
  // to 0 where there is no chrome, matching the auth screens.
  const onLayout = useCallback((_event: LayoutChangeEvent) => {
    keyboardOffsetRef.current?.measureInWindow((_x, y) => {
      if (!Number.isFinite(y)) return;
      const next = Math.max(0, Math.round(y));
      setOffset(prev => (Math.abs(prev - next) >= 1 ? next : prev));
    });
  }, []);

  return (
    <Screen
      edges={edges}
      bottom="none"
      cookieNoticeInset={0}
      className={containerClassName}
      style={containerStyle}
      testID={testID}
    >
      <View className="flex-1" ref={keyboardOffsetRef} onLayout={onLayout}>
        <KeyboardAwareScrollView
          bottomPadding={bottomPadding}
          keyboardVerticalOffset={offset}
          contentContainerStyle={contentContainerStyle}
          {...scrollProps}
        >
          {children}
        </KeyboardAwareScrollView>
      </View>
    </Screen>
  );
}

export default KeyboardAwareScrollView;
