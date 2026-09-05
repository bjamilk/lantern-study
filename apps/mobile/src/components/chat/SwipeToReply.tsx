/**
 * Swipe right on a chat row to start a quote-reply (iMessage / WhatsApp style).
 * Vertical scroll still wins via failOffsetY / activeOffsetX.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';

const REPLY_THRESHOLD = 56;
const MAX_DRAG = 88;

interface SwipeToReplyProps {
  enabled?: boolean;
  onReply: () => void;
  children: React.ReactNode;
}

export function SwipeToReply({ enabled = true, onReply, children }: SwipeToReplyProps) {
  const { colors } = useTheme();
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(18)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      // Track the drag only; the reply is committed on release below so that
      // dragging back under the threshold aborts and the keyboard never yanks
      // up mid-gesture.
      translateX.value = Math.max(0, Math.min(event.translationX, MAX_DRAG));
    })
    .onEnd(() => {
      // Commit only if the row was still held past the threshold at release.
      if (translateX.value >= REPLY_THRESHOLD) {
        runOnJS(onReply)();
      }
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    })
    .onFinalize(() => {
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [12, REPLY_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(translateX.value, [12, REPLY_THRESHOLD], [0.6, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.iconSlot, iconStyle]} pointerEvents="none">
        <View style={[styles.iconCircle, { backgroundColor: colors.primaryBackground }]}>
          <AppIcon name="arrow-undo" size={16} color={colors.primary} />
        </View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'relative',
    width: '100%',
  },
  iconSlot: {
    position: 'absolute',
    left: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 0,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SwipeToReply;
