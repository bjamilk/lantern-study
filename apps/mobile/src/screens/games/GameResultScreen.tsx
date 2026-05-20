// ===========================================
// Lantern Study Mobile - Game Result Screen
// Displays 1v1 Quiz Battle Results
// ===========================================

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useGameStore } from '../../stores';
import Confetti from '../../components/Confetti';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types (should match shared types)
interface User {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface TestQuestion {
  id: string;
  questionNumber: number;
  questionStem: string;
}

interface UserAnswerRecord {
  questionId: string;
  selectedOptionIds?: string[];
  isCorrect?: boolean;
  timeTaken?: number;
}

interface GameSession {
  id: string;
  user: User;
  opponent: User;
  questions: TestQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
  opponentAnswers: Record<string, UserAnswerRecord>;
  userScore: number;
  opponentScore: number;
  userTime: number;
  opponentTime: number;
  isComplete: boolean;
  winnerId?: string;
}

type GameResultRouteParams = {
  GameResult: {
    session: GameSession;
    currentUser: User;
  };
};

export default function GameResultScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<GameResultRouteParams, 'GameResult'>>();
  const { resetGame, setChallengeOpponent } = useGameStore();
  
  const { session, currentUser } = route.params;

  const isWinner = session.winnerId === currentUser.id;
  const isDraw = !session.winnerId;
  const opponent = session.user.id === currentUser.id ? session.opponent : session.user;

  const handleRematch = () => {
    resetGame();
    setChallengeOpponent({
      id: opponent.id,
      name: opponent.name,
      avatarUrl: opponent.avatarUrl,
    });
    // Go back to group chat where user can start a new challenge
    navigation.goBack();
  };

  const handleExit = () => {
    resetGame();
    navigation.goBack();
  };

  // Animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    // Animate result in
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  const getResultText = () => {
    if (isDraw) return "It's a Draw!";
    if (isWinner) return 'You Won! 🎉';
    return 'You Lost';
  };

  const getResultColor = () => {
    if (isDraw) return '#f59e0b';
    if (isWinner) return '#10b981';
    return '#ef4444';
  };

  const getResultIcon = () => {
    if (isDraw) return 'remove-circle';
    if (isWinner) return 'trophy';
    return 'sad';
  };

  const renderAvatar = (user: User, size: number = 50) => {
    if (user.avatarUrl) {
      return (
        <Image
          source={{ uri: user.avatarUrl }}
          style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        />
      );
    }
    return (
      <View
        style={[
          styles.avatarPlaceholder,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.cardSecondary,
          },
        ]}
      >
        <Text style={[styles.avatarText, { color: colors.text, fontSize: size * 0.4 }]}>
          {user.name?.charAt(0)?.toUpperCase() || 'U'}
        </Text>
      </View>
    );
  };

  const renderPlayerStats = (
    user: User,
    score: number,
    time: number,
    isCurrentUser: boolean
  ) => (
    <View style={[styles.playerStatsCard, { backgroundColor: colors.card }]}>
      <View style={styles.playerHeader}>
        {renderAvatar(user, 40)}
        <View style={styles.playerNameContainer}>
          <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>
            {user.name}
          </Text>
          {isCurrentUser && (
            <Text style={[styles.youLabel, { color: colors.textSecondary }]}>(You)</Text>
          )}
        </View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{score}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            / {session.questions.length}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{time.toFixed(1)}s</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Time</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Result Icon & Text */}
        <Animated.View
          style={[
            styles.resultContainer,
            {
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View
            style={[
              styles.resultIconContainer,
              { backgroundColor: getResultColor() + '20' },
            ]}
          >
            <Ionicons
              name={getResultIcon() as any}
              size={60}
              color={getResultColor()}
            />
          </View>
          <Text style={[styles.resultText, { color: getResultColor() }]}>
            {getResultText()}
          </Text>
          <Text style={[styles.resultSubtext, { color: colors.textSecondary }]}>
            {isDraw
              ? 'A hard-fought battle ends in a stalemate.'
              : isWinner
              ? `Congratulations! You defeated ${opponent.name}.`
              : `A valiant effort, but ${opponent.name} was faster this time.`}
          </Text>
        </Animated.View>

        {/* Stats Comparison */}
        <Animated.View
          style={[
            styles.statsContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {renderPlayerStats(
            currentUser,
            session.user.id === currentUser.id ? session.userScore : session.opponentScore,
            session.user.id === currentUser.id ? session.userTime : session.opponentTime,
            true
          )}
          <View style={styles.vsContainer}>
            <Text style={[styles.vsText, { color: colors.textTertiary }]}>VS</Text>
          </View>
          {renderPlayerStats(
            opponent,
            session.user.id === opponent.id ? session.userScore : session.opponentScore,
            session.user.id === opponent.id ? session.userTime : session.opponentTime,
            false
          )}
        </Animated.View>

        {/* Action Buttons */}
        <Animated.View
          style={[
            styles.buttonsContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.rematchButton, { backgroundColor: '#ef4444' }]}
            onPress={handleRematch}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={22} color="#fff" />
            <Text style={styles.buttonText}>Rematch</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.exitButton, { backgroundColor: colors.cardSecondary }]}
            onPress={handleExit}
            activeOpacity={0.8}
          >
            <Ionicons name="exit-outline" size={22} color={colors.text} />
            <Text style={[styles.buttonText, { color: colors.text }]}>Exit</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Show confetti on win */}
        {isWinner && <Confetti />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  resultContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  resultIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  resultText: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resultSubtext: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  statsContainer: {
    marginBottom: 32,
  },
  playerStatsCard: {
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    borderWidth: 2,
    borderColor: '#6366f1',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6366f1',
  },
  avatarText: {
    fontWeight: 'bold',
  },
  playerNameContainer: {
    marginLeft: 12,
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
  },
  youLabel: {
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e2e8f0',
  },
  vsContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  vsText: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  rematchButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  exitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
