// ===========================================
// Lantern Study Mobile - Flashcard Review Screen
// ===========================================

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  PanResponder,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useFlashcardStore, type Flashcard } from '../../stores/flashcardStore';
import { useTheme } from '../../theme';

type SRSGrade = 'again' | 'hard' | 'good' | 'easy';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 40;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.55;
const SWIPE_THRESHOLD = 120;

type FlashcardReviewRouteParams = {
  FlashcardReview: {
    deckId: string;
    deckName: string;
    mode: 'review' | 'cram';
  };
};

const SRS_BUTTONS: { grade: SRSGrade; label: string; color: string; icon: string }[] = [
  { grade: 'again', label: 'Again', color: '#ef4444', icon: 'close-circle' },
  { grade: 'hard', label: 'Hard', color: '#f97316', icon: 'warning' },
  { grade: 'good', label: 'Good', color: '#10b981', icon: 'checkmark-circle' },
  { grade: 'easy', label: 'Easy', color: '#6366f1', icon: 'star' },
];

export default function FlashcardReviewScreen() {
  const route = useRoute<RouteProp<FlashcardReviewRouteParams, 'FlashcardReview'>>();
  const navigation = useNavigation<any>();
  const { deckId, deckName, mode } = route.params;
  const { colors } = useTheme();

  // Get flashcards from store
  const { flashcards: allFlashcards, fetchFlashcards } = useFlashcardStore();
  const deckFlashcards = allFlashcards[deckId] || [];
  
  // Fetch flashcards if not loaded
  useEffect(() => {
    if (deckFlashcards.length === 0) {
      fetchFlashcards(deckId);
    }
  }, [deckId, deckFlashcards.length, fetchFlashcards]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewResults, setReviewResults] = useState<{ grade: SRSGrade; cardId: string }[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  // Animation values
  const flipAnimation = useRef(new Animated.Value(0)).current;
  const cardPosition = useRef(new Animated.ValueXY()).current;

  const cards = deckFlashcards;
  const currentCard = useMemo(() => cards[currentIndex], [cards, currentIndex]);
  const progress = useMemo(() => cards.length > 0 ? (currentIndex + 1) / cards.length : 0, [currentIndex, cards.length]);

  // Front and back interpolations for flip animation
  const frontInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const frontAnimatedStyle = {
    transform: [{ rotateY: frontInterpolate }],
  };

  const backAnimatedStyle = {
    transform: [{ rotateY: backInterpolate }],
  };

  // Pan responder for swipe gestures - only capture when actually swiping
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // Don't capture on start - allow taps to pass through
      onMoveShouldSetPanResponder: (_, gesture) => {
        // Only capture when there's significant horizontal movement (swiping)
        return Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10;
      },
      onPanResponderMove: (_, gesture) => {
        cardPosition.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          // Swiped right - Good
          handleSwipeComplete('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          // Swiped left - Again
          handleSwipeComplete('left');
        } else {
          // Return to center
          Animated.spring(cardPosition, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleGradeCard = useCallback((grade: SRSGrade) => {
    if (!currentCard) return;

    // Record the result
    setReviewResults(prev => [...prev, { grade, cardId: currentCard.id }]);

    // Animate card out
    const direction = (grade === 'good' || grade === 'easy') ? 1 : -1;
    Animated.timing(cardPosition, {
      toValue: { x: direction * SCREEN_WIDTH * 1.5, y: 0 },
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      // Move to next card
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setIsFlipped(false);
        flipAnimation.setValue(0);
        cardPosition.setValue({ x: 0, y: 0 });
      } else {
        // Review complete
        setIsComplete(true);
      }
    });
  }, [currentCard, currentIndex, cards.length, cardPosition, flipAnimation]);

  const handleSwipeComplete = useCallback((direction: 'left' | 'right') => {
    const grade: SRSGrade = direction === 'right' ? 'good' : 'again';
    handleGradeCard(grade);
  }, [handleGradeCard]);

  const flipCard = useCallback(() => {
    const toValue = isFlipped ? 0 : 180;
    Animated.spring(flipAnimation, {
      toValue,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(!isFlipped);
  }, [isFlipped, flipAnimation]);

  const handleExit = useCallback(() => {
    Alert.alert(
      'Exit Review',
      'Are you sure you want to exit? Your progress will be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  }, [navigation]);

  // Calculate session stats
  const sessionStats = useMemo(() => {
    const totalCards = reviewResults.length;
    const correctCards = reviewResults.filter(r => r.grade === 'good' || r.grade === 'easy').length;
    const accuracy = totalCards > 0 ? Math.round((correctCards / totalCards) * 100) : 0;
    
    const gradeBreakdown = {
      again: reviewResults.filter(r => r.grade === 'again').length,
      hard: reviewResults.filter(r => r.grade === 'hard').length,
      good: reviewResults.filter(r => r.grade === 'good').length,
      easy: reviewResults.filter(r => r.grade === 'easy').length,
    };

    return { totalCards, correctCards, accuracy, gradeBreakdown };
  }, [reviewResults]);

  if (isComplete) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.completeContainer}>
          <View style={styles.completeIcon}>
            <Ionicons name="trophy" size={64} color="#fbbf24" />
          </View>
          <Text style={styles.completeTitle}>Session Complete!</Text>
          <Text style={styles.completeSubtitle}>
            You reviewed {sessionStats.totalCards} cards
          </Text>

          {/* Stats */}
          <View style={styles.completeStats}>
            <View style={styles.completeStat}>
              <Text style={styles.completeStatValue}>{sessionStats.accuracy}%</Text>
              <Text style={styles.completeStatLabel}>Accuracy</Text>
            </View>
            <View style={styles.completeStat}>
              <Text style={[styles.completeStatValue, { color: '#10b981' }]}>
                {sessionStats.correctCards}
              </Text>
              <Text style={styles.completeStatLabel}>Correct</Text>
            </View>
            <View style={styles.completeStat}>
              <Text style={[styles.completeStatValue, { color: '#ef4444' }]}>
                {sessionStats.totalCards - sessionStats.correctCards}
              </Text>
              <Text style={styles.completeStatLabel}>To Review</Text>
            </View>
          </View>

          {/* Grade Breakdown */}
          <View style={styles.gradeBreakdown}>
            {Object.entries(sessionStats.gradeBreakdown).map(([grade, count]) => (
              <View key={grade} style={styles.gradeItem}>
                <View
                  style={[
                    styles.gradeDot,
                    {
                      backgroundColor:
                        grade === 'again' ? '#ef4444' :
                        grade === 'hard' ? '#f97316' :
                        grade === 'good' ? '#10b981' : '#6366f1',
                    },
                  ]}
                />
                <Text style={styles.gradeLabel}>
                  {grade.charAt(0).toUpperCase() + grade.slice(1)}
                </Text>
                <Text style={styles.gradeCount}>{count}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.completeActions}>
            <TouchableOpacity
              style={styles.completeButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.completeButtonText}>Back to Deck</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.exitButton} onPress={handleExit}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{deckName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {currentIndex + 1} / {cards.length}
          </Text>
        </View>
        <View style={styles.modeIndicator}>
          <Ionicons
            name={mode === 'cram' ? 'flash' : 'time'}
            size={20}
            color={mode === 'cram' ? '#f97316' : '#6366f1'}
          />
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <Animated.View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>
      </View>

      {/* Card Container */}
      <View style={styles.cardContainer}>
        <Animated.View
          style={[
            styles.cardWrapper,
            {
              transform: [
                { translateX: cardPosition.x },
                { translateY: cardPosition.y },
                {
                  rotate: cardPosition.x.interpolate({
                    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
                    outputRange: ['-15deg', '0deg', '15deg'],
                  }),
                },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Swipe Indicators */}
          <Animated.View
            style={[
              styles.swipeIndicator,
              styles.leftIndicator,
              {
                opacity: cardPosition.x.interpolate({
                  inputRange: [-SWIPE_THRESHOLD, 0],
                  outputRange: [1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Text style={styles.swipeIndicatorText}>Again</Text>
          </Animated.View>
          <Animated.View
            style={[
              styles.swipeIndicator,
              styles.rightIndicator,
              {
                opacity: cardPosition.x.interpolate({
                  inputRange: [0, SWIPE_THRESHOLD],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <Text style={styles.swipeIndicatorText}>Good</Text>
          </Animated.View>

          {/* Front of Card */}
          <Animated.View style={[styles.card, styles.cardFront, frontAnimatedStyle]}>
            <TouchableOpacity
              style={styles.cardTouchable}
              onPress={flipCard}
              activeOpacity={0.95}
            >
              <Text style={styles.cardLabel}>Question</Text>
              <Text style={styles.cardText}>{currentCard?.front || currentCard?.cloze_text || ''}</Text>
              <View style={styles.tapHint}>
                <Ionicons name="sync-outline" size={16} color="#9ca3af" />
                <Text style={styles.tapHintText}>Tap to reveal answer</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Back of Card */}
          <Animated.View style={[styles.card, styles.cardBack, backAnimatedStyle]}>
            <TouchableOpacity
              style={styles.cardTouchable}
              onPress={flipCard}
              activeOpacity={0.95}
            >
              <Text style={styles.cardLabel}>Answer</Text>
              <Text style={styles.cardText}>{currentCard?.back || ''}</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>

      {/* SRS Grade Buttons */}
      {isFlipped && (
        <View style={styles.gradeButtons}>
          {SRS_BUTTONS.map((button) => (
            <TouchableOpacity
              key={button.grade}
              style={[styles.gradeButton, { backgroundColor: button.color + '20' }]}
              onPress={() => handleGradeCard(button.grade)}
              activeOpacity={0.7}
            >
              <Ionicons name={button.icon as any} size={24} color={button.color} />
              <Text style={[styles.gradeButtonText, { color: button.color }]}>
                {button.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Tap to flip hint */}
      {!isFlipped && (
        <View style={styles.bottomHint}>
          <TouchableOpacity 
            style={styles.flipButton}
            onPress={flipCard}
            activeOpacity={0.8}
          >
            <Ionicons name="sync" size={24} color="#ffffff" />
            <Text style={styles.flipButtonText}>Flip Card</Text>
          </TouchableOpacity>
          <Text style={styles.bottomHintText}>
            or swipe to grade • tap card to flip
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  exitButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  modeIndicator: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 2,
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  cardWrapper: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    position: 'relative',
  },
  swipeIndicator: {
    position: 'absolute',
    top: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    zIndex: 10,
  },
  leftIndicator: {
    left: 20,
    backgroundColor: '#ef4444',
  },
  rightIndicator: {
    right: 20,
    backgroundColor: '#10b981',
  },
  swipeIndicatorText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 24,
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cardFront: {
    zIndex: 1,
  },
  cardBack: {
    transform: [{ rotateY: '180deg' }],
  },
  cardTouchable: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  cardText: {
    fontSize: 20,
    color: '#ffffff',
    lineHeight: 32,
    textAlign: 'center',
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    gap: 8,
  },
  tapHintText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  gradeButtons: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 20,
    gap: 8,
  },
  gradeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 4,
  },
  gradeButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomHint: {
    alignItems: 'center',
    paddingBottom: 30,
    gap: 12,
  },
  flipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  flipButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  bottomHintText: {
    fontSize: 13,
    color: '#64748b',
  },
  // Complete screen styles
  completeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  completeIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fbbf2420',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  completeTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  completeSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 32,
  },
  completeStats: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 32,
  },
  completeStat: {
    alignItems: 'center',
  },
  completeStatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  completeStatLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  gradeBreakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 40,
  },
  gradeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gradeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  gradeLabel: {
    fontSize: 14,
    color: '#e2e8f0',
  },
  gradeCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  completeActions: {
    width: '100%',
    gap: 12,
  },
  completeButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
