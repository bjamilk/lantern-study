import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { PerformanceRating } from '@lantern/shared/utils';
import { Card } from './ui';
import { ImageOcclusionView } from './ImageOcclusionView';
import type { Flashcard } from '../stores';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.28;
const SWIPE_THRESHOLD_Y = 100;
const ROTATION_FACTOR = 0.12;

interface Props {
  card: Flashcard;
  cardKey: string;
  front: string;
  back: string;
  isImageOcclusion: boolean;
  showBack: boolean;
  reduceMotion?: boolean;
  onToggleBack: () => void;
  onGrade: (rating: PerformanceRating) => void;
}

function resolveSwipeGrade(
  translationX: number,
  translationY: number,
  velocityX: number,
  velocityY: number
): PerformanceRating | null {
  const absX = Math.abs(translationX);
  const absY = Math.abs(translationY);

  if (absX >= absY) {
    if (translationX <= -SWIPE_THRESHOLD_X || velocityX <= -700) return 'again';
    if (translationX >= SWIPE_THRESHOLD_X || velocityX >= 700) return 'good';
    return null;
  }

  if (translationY <= -SWIPE_THRESHOLD_Y || velocityY <= -700) return 'easy';
  if (translationY >= SWIPE_THRESHOLD_Y || velocityY >= 700) return 'hard';
  return null;
}

export function SwipeableFlashcard({
  card,
  cardKey,
  front,
  back,
  isImageOcclusion,
  showBack,
  reduceMotion = false,
  onToggleBack,
  onGrade,
}: Props) {
  const springBack = (toValue: number) =>
    reduceMotion ? toValue : withSpring(toValue, { damping: 18, stiffness: 180 });
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const flipProgress = useSharedValue(showBack ? 1 : 0);

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    flipProgress.value = showBack ? 1 : 0;
  }, [cardKey, showBack, flipProgress, translateX, translateY]);

  useEffect(() => {
    flipProgress.value = reduceMotion
      ? (showBack ? 1 : 0)
      : withTiming(showBack ? 1 : 0, { duration: 280 });
  }, [showBack, flipProgress, reduceMotion]);

  const finishGrade = (rating: PerformanceRating) => {
    onGrade(rating);
  };

  const pan = Gesture.Pan()
    .enabled(showBack)
    .onUpdate(event => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd(event => {
      const rating = resolveSwipeGrade(
        event.translationX,
        event.translationY,
        event.velocityX,
        event.velocityY
      );

      if (!rating) {
        translateX.value = springBack(0);
        translateY.value = springBack(0);
        return;
      }

      const exitX =
        rating === 'again'
          ? -SCREEN_WIDTH * 1.2
          : rating === 'good'
            ? SCREEN_WIDTH * 1.2
            : translateX.value;
      const exitY =
        rating === 'easy'
          ? -SCREEN_HEIGHT * 0.6
          : rating === 'hard'
            ? SCREEN_HEIGHT * 0.6
            : translateY.value;

      translateX.value = reduceMotion ? exitX : withTiming(exitX, { duration: 220 });
      if (reduceMotion) {
        translateY.value = exitY;
        runOnJS(finishGrade)(rating);
        return;
      }
      translateY.value = withTiming(exitY, { duration: 220 }, finished => {
        if (finished) {
          runOnJS(finishGrade)(rating);
        }
      });
    });

  const tap = Gesture.Tap()
    .enabled(!isImageOcclusion)
    .maxDuration(250)
    .onEnd(() => {
      runOnJS(onToggleBack)();
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${translateX.value * ROTATION_FACTOR}deg` },
    ],
  }));

  const againOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD_X, -40, 0],
      [1, 0.35, 0],
      Extrapolation.CLAMP
    ),
  }));

  const goodOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, 40, SWIPE_THRESHOLD_X],
      [0, 0.35, 1],
      Extrapolation.CLAMP
    ),
  }));

  const easyOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [-SWIPE_THRESHOLD_Y, -30, 0],
      [1, 0.35, 0],
      Extrapolation.CLAMP
    ),
  }));

  const hardOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [0, 30, SWIPE_THRESHOLD_Y],
      [0, 0.35, 1],
      Extrapolation.CLAMP
    ),
  }));

  const frontFaceStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flipProgress.value, [0, 1], [0, 180])}deg` }],
    backfaceVisibility: 'hidden' as const,
    opacity: flipProgress.value < 0.5 ? 1 : 0,
  }));

  const backFaceStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flipProgress.value, [0, 1], [180, 360])}deg` }],
    backfaceVisibility: 'hidden' as const,
    opacity: flipProgress.value >= 0.5 ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.cardWrapper, cardAnimatedStyle]}>
        <Animated.View style={[styles.overlay, styles.overlayAgain, againOverlayStyle]}>
          <Text style={styles.overlayText}>Again</Text>
        </Animated.View>
        <Animated.View style={[styles.overlay, styles.overlayGood, goodOverlayStyle]}>
          <Text style={styles.overlayText}>Good</Text>
        </Animated.View>
        <Animated.View style={[styles.overlay, styles.overlayEasy, easyOverlayStyle]}>
          <Text style={styles.overlayText}>Easy</Text>
        </Animated.View>
        <Animated.View style={[styles.overlay, styles.overlayHard, hardOverlayStyle]}>
          <Text style={styles.overlayText}>Hard</Text>
        </Animated.View>

        <View style={styles.flipContainer}>
          <Animated.View style={[styles.face, frontFaceStyle]}>
            <Card className="min-h-[260px] items-center justify-center border-lantern-primary/20 dark:border-lantern-primary/30/50">
              <Text style={styles.sideLabel}>Question</Text>
              {isImageOcclusion ? (
                <View style={styles.occlusionWrap}>
                  {front ? (
                    <Text className="text-base font-medium text-lantern-text text-center px-2 mb-3">
                      {front}
                    </Text>
                  ) : null}
                  <ImageOcclusionView card={card} showAnswer={false} />
                </View>
              ) : (
                <>
                  <Text className="text-xl font-medium text-lantern-text text-center px-2">
                    {front}
                  </Text>
                  <Text style={styles.hintText}>Tap to reveal answer</Text>
                </>
              )}
            </Card>
          </Animated.View>

          <Animated.View style={[styles.face, styles.faceBack, backFaceStyle]}>
            <Card className="min-h-[260px] items-center justify-center border-lantern-primary/20 dark:border-lantern-primary/30/50">
              <Text style={styles.sideLabel}>Answer</Text>
              {isImageOcclusion ? (
                <View style={styles.occlusionWrap}>
                  {front ? (
                    <Text className="text-base font-medium text-lantern-text text-center px-2 mb-3">
                      {front}
                    </Text>
                  ) : null}
                  <ImageOcclusionView card={card} showAnswer />
                </View>
              ) : (
                <Text className="text-xl font-medium text-lantern-text text-center px-2">
                  {back || front}
                </Text>
              )}
            </Card>
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    width: '100%',
    minHeight: 280,
  },
  flipContainer: {
    width: '100%',
    minHeight: 280,
  },
  face: {
    width: '100%',
  },
  faceBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  sideLabel: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#94a3b8',
    marginBottom: 12,
  },
  hintText: {
    fontSize: 12,
    color: '#6366f1',
    marginTop: 24,
  },
  occlusionWrap: {
    width: '100%',
    paddingHorizontal: 4,
  },
  overlay: {
    position: 'absolute',
    zIndex: 2,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  overlayAgain: {
    top: 16,
    left: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
  },
  overlayGood: {
    top: 16,
    right: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.92)',
  },
  overlayEasy: {
    top: 16,
    alignSelf: 'center',
    left: '38%',
    backgroundColor: 'rgba(245, 158, 11, 0.92)',
  },
  overlayHard: {
    bottom: 16,
    alignSelf: 'center',
    left: '38%',
    backgroundColor: 'rgba(100, 116, 139, 0.92)',
  },
  overlayText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});

export default SwipeableFlashcard;
