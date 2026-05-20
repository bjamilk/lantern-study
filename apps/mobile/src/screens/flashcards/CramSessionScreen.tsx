// ===========================================
// Lantern Study Mobile - Cram Session Screen
// Fast-paced flashcard review without SRS scheduling
// ===========================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types
interface Deck {
  id: string;
  name: string;
  description?: string;
}

interface Flashcard {
  id: string;
  deckId: string;
  type: 'BASIC' | 'CLOZE';
  front?: string;
  back?: string;
  clozeText?: string;
}

interface CramSession {
  deck: Deck;
  cardQueue: Flashcard[];
}

interface CramStats {
  correct: number;
  incorrect: number;
}

type CramSessionRouteParams = {
  CramSession: {
    deckId: string;
    deckName: string;
    cards: Flashcard[];
  };
};

interface CramSessionScreenProps {
  session?: CramSession;
  onAnswer?: (cardId: string, isCorrect: boolean) => void;
  onEndSession?: (stats: CramStats) => void;
  onCramIncorrect?: (incorrectCards: Flashcard[]) => void;
}

export default function CramSessionScreen() {
  const route = useRoute<RouteProp<CramSessionRouteParams, 'CramSession'>>();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();

  const { deckId, deckName, cards: initialCards } = route.params || {};

  const [cards, setCards] = useState<Flashcard[]>(initialCards || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [incorrectCards, setIncorrectCards] = useState<Flashcard[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [isSessionComplete, setIsSessionComplete] = useState(false);

  // Animations
  const cardFlipAnim = useRef(new Animated.Value(0)).current;
  const cardSlideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const currentCard = cards[currentIndex];

  // Update progress bar
  useEffect(() => {
    if (cards.length > 0) {
      Animated.timing(progressAnim, {
        toValue: ((currentIndex + 1) / cards.length) * 100,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [currentIndex, cards.length]);

  // Reset answer visibility on card change
  useEffect(() => {
    setIsAnswerShown(false);
    cardFlipAnim.setValue(0);
    cardSlideAnim.setValue(0);
  }, [currentIndex]);

  const showAnswer = useCallback(() => {
    setIsAnswerShown(true);
    Animated.timing(cardFlipAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [cardFlipAnim]);

  const handleAnswer = useCallback((isCorrect: boolean) => {
    if (!currentCard) return;

    // Slide animation
    const direction = isCorrect ? 1 : -1;
    Animated.timing(cardSlideAnim, {
      toValue: direction * SCREEN_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      if (isCorrect) {
        setCorrectCount(prev => prev + 1);
      } else {
        setIncorrectCards(prev => [...prev, currentCard]);
      }

      if (currentIndex + 1 >= cards.length) {
        setIsSessionComplete(true);
      } else {
        setCurrentIndex(prev => prev + 1);
        cardSlideAnim.setValue(0);
      }
    });
  }, [currentCard, currentIndex, cards.length, cardSlideAnim]);

  const handleCramIncorrect = useCallback(() => {
    if (incorrectCards.length === 0) return;
    setCards(incorrectCards);
    setCurrentIndex(0);
    setIncorrectCards([]);
    setCorrectCount(0);
    setIsSessionComplete(false);
  }, [incorrectCards]);

  const handleEndSession = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Parse cloze text for display
  const renderClozeText = (text: string, showAnswer: boolean) => {
    const clozeRegex = /\{\{c1::(.*?)\}\}/g;
    const parts: { text: string; isCloze: boolean }[] = [];
    let lastIndex = 0;
    let match;

    while ((match = clozeRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), isCloze: false });
      }
      parts.push({ text: match[1], isCloze: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), isCloze: false });
    }

    return (
      <Text style={styles.cardText}>
        {parts.map((part, index) => {
          if (part.isCloze) {
            return showAnswer ? (
              <Text key={index} style={[styles.clozeReveal, { color: colors.primary }]}>
                {part.text}
              </Text>
            ) : (
              <Text key={index} style={[styles.clozeHidden, { backgroundColor: colors.cardSecondary }]}>
                [...]
              </Text>
            );
          }
          return (
            <Text key={index} style={{ color: colors.text }}>
              {part.text}
            </Text>
          );
        })}
      </Text>
    );
  };

  // Session Complete Screen
  if (isSessionComplete) {
    const totalCards = cards.length;
    const incorrectCount = incorrectCards.length;
    const accuracy = totalCards > 0 ? Math.round((correctCount / totalCards) * 100) : 0;

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.completeContainer}>
          <View style={[styles.completeIconContainer, { backgroundColor: '#8b5cf6' + '20' }]}>
            <Ionicons name="checkmark-done-circle" size={60} color="#8b5cf6" />
          </View>

          <Text style={[styles.completeTitle, { color: '#8b5cf6' }]}>
            Cram Session Complete!
          </Text>
          <Text style={[styles.completeSubtitle, { color: colors.textSecondary }]}>
            You reviewed {totalCards} cards
          </Text>

          {/* Stats */}
          <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#10b981' }]}>{correctCount}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Correct</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#ef4444' }]}>{incorrectCount}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Incorrect</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{accuracy}%</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Accuracy</Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.completeButtons}>
            <TouchableOpacity
              style={[styles.finishButton, { backgroundColor: colors.primary }]}
              onPress={handleEndSession}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
              <Text style={styles.finishButtonText}>Finish</Text>
            </TouchableOpacity>

            {incorrectCount > 0 && (
              <TouchableOpacity
                style={[styles.cramIncorrectButton, { backgroundColor: '#f97316' }]}
                onPress={handleCramIncorrect}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={20} color="#fff" />
                <Text style={styles.cramIncorrectButtonText}>
                  Cram Incorrect ({incorrectCount})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentCard) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.emptyContainer}>
          <Ionicons name="albums-outline" size={64} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No cards to review
          </Text>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const cardFront = currentCard.type === 'BASIC' ? currentCard.front! : currentCard.clozeText!;
  const cardBack = currentCard.type === 'BASIC' ? currentCard.back! : currentCard.clozeText!;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleEndSession} style={styles.closeButton}>
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#8b5cf6' }]} numberOfLines={1}>
          Cramming: {deckName}
        </Text>
        <View style={[styles.counterBadge, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.counterText, { color: colors.text }]}>
            {currentIndex + 1} / {cards.length}
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={[styles.progressContainer, { backgroundColor: colors.cardSecondary }]}>
        <Animated.View
          style={[
            styles.progressBar,
            {
              backgroundColor: '#8b5cf6',
              width: progressAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      {/* Card */}
      <View style={styles.cardContainer}>
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.card, transform: [{ translateX: cardSlideAnim }] },
          ]}
        >
          <ScrollView contentContainerStyle={styles.cardContent}>
            {/* Front */}
            <View style={styles.cardSection}>
              {currentCard.type === 'CLOZE' ? (
                renderClozeText(cardFront, false)
              ) : (
                <Text style={[styles.cardText, { color: colors.text }]}>{cardFront}</Text>
              )}
            </View>

            {/* Answer (shown after flip) */}
            {isAnswerShown && (
              <Animated.View
                style={[
                  styles.answerSection,
                  {
                    opacity: cardFlipAnim,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                {currentCard.type === 'CLOZE' ? (
                  renderClozeText(cardBack, true)
                ) : (
                  <Text style={[styles.cardText, { color: colors.text }]}>{cardBack}</Text>
                )}
              </Animated.View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {!isAnswerShown ? (
              <TouchableOpacity
                style={[styles.showAnswerButton, { backgroundColor: colors.primary }]}
                onPress={showAnswer}
                activeOpacity={0.8}
              >
                <Text style={styles.showAnswerText}>Show Answer</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.answerButtons}>
                <TouchableOpacity
                  style={[styles.answerButton, styles.incorrectButton]}
                  onPress={() => handleAnswer(false)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={24} color="#fff" />
                  <Text style={styles.answerButtonText}>Incorrect</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.answerButton, styles.correctButton]}
                  onPress={() => handleAnswer(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark" size={24} color="#fff" />
                  <Text style={styles.answerButtonText}>Correct</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Animated.View>
      </View>

      {/* End Session Link */}
      <TouchableOpacity onPress={handleEndSession} style={styles.endSessionLink}>
        <Text style={[styles.endSessionText, { color: colors.textTertiary }]}>
          End Cram Session
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  counterBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  counterText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressContainer: {
    height: 4,
  },
  progressBar: {
    height: '100%',
  },
  cardContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
    minHeight: SCREEN_HEIGHT * 0.5,
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  cardContent: {
    padding: 24,
    flexGrow: 1,
    justifyContent: 'center',
  },
  cardSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  clozeHidden: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  clozeReveal: {
    fontWeight: 'bold',
  },
  answerSection: {
    marginTop: 24,
    paddingTop: 24,
  },
  divider: {
    height: 1,
    width: '30%',
    alignSelf: 'center',
    marginBottom: 24,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  showAnswerButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  showAnswerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  answerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  answerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  incorrectButton: {
    backgroundColor: '#ef4444',
  },
  correctButton: {
    backgroundColor: '#10b981',
  },
  answerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  endSessionLink: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  endSessionText: {
    fontSize: 14,
  },
  // Complete screen
  completeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  completeIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  completeTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  completeSubtitle: {
    fontSize: 16,
    marginBottom: 24,
  },
  statsCard: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  completeButtons: {
    width: '100%',
    gap: 12,
  },
  finishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  finishButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cramIncorrectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  cramIncorrectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
