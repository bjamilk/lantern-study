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
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

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
  const triggered = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(18)
    .failOffsetY([-12, 12])
    .onBegin(() => {
      triggered.value = false;
    })
    .onUpdate((event) => {
      const next = Math.max(0, Math.min(event.translationX, MAX_DRAG));
      translateX.value = next;
      if (!triggered.value && next >= REPLY_THRESHOLD) {
        triggered.value = true;
        runOnJS(onReply)();
      }
    })
    .onEnd(() => {
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
      triggered.value = false;
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
          <Ionicons name="arrow-undo" size={16} color={colors.primary} />
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
