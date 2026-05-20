// ===========================================
// Lantern Study Mobile - Confetti Animation
// Celebration effect for achievements, wins, etc.
// ===========================================

import React, { useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Confetti colors
const COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
  '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
  '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
];

interface ConfettiPieceProps {
  index: number;
  delay: number;
  duration: number;
  startX: number;
  color: string;
  size: number;
  rotation: number;
}

const ConfettiPiece: React.FC<ConfettiPieceProps> = ({
  index,
  delay,
  duration,
  startX,
  color,
  size,
  rotation,
}) => {
  const animatedY = useMemo(() => new Animated.Value(0), []);
  const animatedX = useMemo(() => new Animated.Value(0), []);
  const animatedRotation = useMemo(() => new Animated.Value(0), []);
  const animatedOpacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    const horizontalSwing = (Math.random() - 0.5) * 100;

    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        // Fall down
        Animated.timing(animatedY, {
          toValue: SCREEN_HEIGHT + 50,
          duration: duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        // Swing horizontally
        Animated.timing(animatedX, {
          toValue: horizontalSwing,
          duration: duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        // Rotate
        Animated.timing(animatedRotation, {
          toValue: rotation + (Math.random() * 720 - 360),
          duration: duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        // Fade out near the end
        Animated.sequence([
          Animated.delay(duration * 0.7),
          Animated.timing(animatedOpacity, {
            toValue: 0,
            duration: duration * 0.3,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [delay, duration, rotation]);

  const animatedStyle = {
    transform: [
      { translateY: animatedY },
      { translateX: animatedX },
      {
        rotate: animatedRotation.interpolate({
          inputRange: [0, 360],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
    opacity: animatedOpacity,
  };

  // Randomly choose between square and rectangle shapes
  const isSquare = Math.random() > 0.5;
  const pieceWidth = isSquare ? size : size * 0.6;
  const pieceHeight = isSquare ? size : size * 1.4;

  return (
    <Animated.View
      style={[
        styles.confettiPiece,
        {
          left: startX,
          top: -20,
          width: pieceWidth,
          height: pieceHeight,
          backgroundColor: color,
          borderRadius: isSquare ? 2 : 1,
        },
        animatedStyle,
      ]}
    />
  );
};

interface ConfettiProps {
  count?: number;
  duration?: number;
  onComplete?: () => void;
}

const Confetti: React.FC<ConfettiProps> = ({
  count = 100,
  duration = 5000,
  onComplete,
}) => {
  useEffect(() => {
    if (onComplete) {
      const timer = setTimeout(onComplete, duration + 1000);
      return () => clearTimeout(timer);
    }
  }, [duration, onComplete]);

  const pieces = useMemo(() => {
    return Array.from({ length: count }, (_, index) => ({
      index,
      delay: Math.random() * 2000,
      duration: 3000 + Math.random() * 2000,
      startX: Math.random() * SCREEN_WIDTH,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 8 + Math.random() * 8,
      rotation: Math.random() * 360,
    }));
  }, [count]);

  return (
    <View style={styles.container} pointerEvents="none">
      {pieces.map((piece) => (
        <ConfettiPiece key={piece.index} {...piece} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 1000,
  },
  confettiPiece: {
    position: 'absolute',
  },
});

export default Confetti;
