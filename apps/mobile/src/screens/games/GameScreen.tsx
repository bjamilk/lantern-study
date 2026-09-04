// ===========================================
// Lantern Study Mobile - Game Screen
// 1v1 Quiz Battle Mode
// ===========================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  Dimensions,
  Animated,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useGameStore } from '../../stores';
import { useAuthStore } from '../../stores/authStore';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types (should match shared types)
interface User {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface QuestionOption {
  id: string;
  text: string;
}

interface MatchingItem {
  id: string;
  text: string;
}

interface DiagramLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

interface UserAnswerRecord {
  questionId: string;
  selectedOptionIds?: string[];
  fillText?: string;
  matchingAnswers?: { promptItemId: string; answerItemId: string }[];
  diagramAnswers?: { labelId: string; selectedLabelId: string }[];
  isCorrect?: boolean;
  timeTaken?: number;
}

enum QuestionType {
  MULTIPLE_CHOICE_SINGLE = 'MULTIPLE_CHOICE_SINGLE',
  MULTIPLE_CHOICE_MULTIPLE = 'MULTIPLE_CHOICE_MULTIPLE',
  TRUE_FALSE = 'TRUE_FALSE',
  FILL_IN_THE_BLANK = 'FILL_IN_THE_BLANK',
  MATCHING = 'MATCHING',
  DIAGRAM_LABELING = 'DIAGRAM_LABELING',
}

interface TestQuestion {
  id: string;
  questionNumber: number;
  questionStem: string;
  questionType?: QuestionType;
  options?: QuestionOption[];
  correctAnswerIds?: string[];
  correctFillText?: string;
  matchingPromptItems?: MatchingItem[];
  matchingAnswerItems?: MatchingItem[];
  imageUrl?: string;
  diagramLabels?: DiagramLabel[];
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
  /** Set by gameStore.startSoloPractice — practice sessions have no real opponent. */
  isSoloPractice?: boolean;
}

type GameScreenRouteParams = {
  GameScreen: {
    session: GameSession;
  };
};

// Shuffle array helper
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export default function GameScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<GameScreenRouteParams, 'GameScreen'>>();
  const { user } = useAuthStore();
  const { activeSession, updateAnswer, quitGame } = useGameStore();
  
  // Prefer live store session (updates after each answer / submit)
  const session = activeSession || route.params?.session;
  
  // Safety check
  if (!session) {
    return (
      <Screen edges={['top']} bottom="safe" className="flex-1" style={{ backgroundColor: colors.background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 18 }}>No active game session</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 20, padding: 12, backgroundColor: colors.primary, borderRadius: 8 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const currentQuestion = session.questions[currentQuestionIndex];
  const diagramImageUri = useResolvedStorageUrl(currentQuestion?.imageUrl);
  const [diagramAspectRatio, setDiagramAspectRatio] = useState(4 / 3);
  // `presentation: 'fullScreenModal'` gives this route its own native window,
  // so the raw safe-area hook read 0 on every edge: the HUD quit button drew
  // under the clock. The old container also used default `edges` (all four)
  // AND re-added the system bottom inset to the scroll content, paying it
  // twice once the window is measured correctly.
  const scrollPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 24 });
  const totalQuestions = session.questions.length;

  const [currentSelections, setCurrentSelections] = useState<string[]>([]);
  const [fillText, setFillText] = useState('');
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});
  const [diagramSelections, setDiagramSelections] = useState<Record<string, string>>({});
  const [shuffledAnswers, setShuffledAnswers] = useState<MatchingItem[] | DiagramLabel[]>([]);
  const [showMatchingDropdown, setShowMatchingDropdown] = useState<string | null>(null);

  const isQuestionAnswered = !!session.userAnswers[currentQuestion.id];

  const resetQuestionState = useCallback(
    (questionIndex: number) => {
      const question = session.questions[questionIndex];
      if (!question) return;

      const existingAnswer = session.userAnswers[question.id];
      setCurrentSelections(existingAnswer?.selectedOptionIds || []);
      setFillText(existingAnswer?.fillText || '');
      setMatchSelections(
        Object.fromEntries(
          (existingAnswer?.matchingAnswers || []).map(m => [m.promptItemId, m.answerItemId])
        )
      );
      setDiagramSelections(
        Object.fromEntries(
          (existingAnswer?.diagramAnswers || []).map(d => [d.labelId, d.selectedLabelId])
        )
      );
      setShowMatchingDropdown(null);
      questionViewStartTimeRef.current = Date.now();

      if (question.questionType === QuestionType.MATCHING && question.matchingAnswerItems) {
        setShuffledAnswers(shuffleArray(question.matchingAnswerItems));
      } else if (question.questionType === QuestionType.DIAGRAM_LABELING && question.diagramLabels) {
        setShuffledAnswers(shuffleArray(question.diagramLabels));
      } else {
        setShuffledAnswers([]);
      }
    },
    [session.questions, session.userAnswers]
  );

  const questionViewStartTimeRef = useRef<number | null>(null);
  const progressAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    resetQuestionState(currentQuestionIndex);
  }, [currentQuestionIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- reset UI only when changing questions

  // Animate progress bar
  useEffect(() => {
    const userProgress = (Object.keys(session.userAnswers).length / totalQuestions) * 100;
    Animated.timing(progressAnimation, {
      toValue: userProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [session.userAnswers, totalQuestions]);

  const submitAnswer = useCallback((answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => {
    if (isQuestionAnswered) return;
    const timeSpentSeconds = questionViewStartTimeRef.current
      ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000)
      : 0;
    updateAnswer(currentQuestion.id, answerData, timeSpentSeconds);
  }, [isQuestionAnswered, currentQuestion.id, updateAnswer]);

  const handleNextQuestion = useCallback(() => {
    if (currentQuestionIndex < totalQuestions - 1) {
      const nextIndex = currentQuestionIndex + 1;
      resetQuestionState(nextIndex);
      setCurrentQuestionIndex(nextIndex);
    }
  }, [currentQuestionIndex, totalQuestions, resetQuestionState]);

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.isComplete || activeSession.awaitingOpponent) {
      navigation.replace('GameResult', {
        session: activeSession,
        currentUser: { id: user?.id, name: activeSession.user.name },
      });
    }
  }, [activeSession?.isComplete, activeSession?.awaitingOpponent, activeSession, navigation, user?.id]);

  const exitGuardEnabled =
    !!activeSession && !activeSession.isComplete && !activeSession.awaitingOpponent;

  useConfirmBeforeExit(exitGuardEnabled, {
    title: 'Quit Game?',
    message: session.isSoloPractice
      ? 'Are you sure you want to end this practice session? Your progress will not be saved.'
      : 'Are you sure you want to quit this duel? Your opponent will win by default.',
    confirmLabel: 'Quit',
    destructive: true,
    onConfirm: () => {
      void quitGame();
    },
  });

  const handleOptionSelect = useCallback((optionId: string) => {
    if (isQuestionAnswered) return;
    const isMulti = currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE;
    
    if (isMulti) {
      setCurrentSelections(prev =>
        prev.includes(optionId) ? prev.filter(id => id !== optionId) : [...prev, optionId]
      );
    } else {
      setCurrentSelections([optionId]);
      submitAnswer({ selectedOptionIds: [optionId] });
    }
  }, [isQuestionAnswered, currentQuestion.questionType, submitAnswer]);

  const handleMatchSelect = useCallback((promptItemId: string, answerItemId: string) => {
    if (isQuestionAnswered) return;
    setMatchSelections(prev => ({ ...prev, [promptItemId]: answerItemId }));
    setShowMatchingDropdown(null);
  }, [isQuestionAnswered]);

  const handleDiagramLabelSelect = useCallback((labelId: string, selectedLabelId: string) => {
    if (isQuestionAnswered) return;
    setDiagramSelections(prev => ({ ...prev, [labelId]: selectedLabelId }));
  }, [isQuestionAnswered]);

  const handleSubmitMultiOrComplex = useCallback(() => {
    if (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE) {
      submitAnswer({ selectedOptionIds: currentSelections });
    } else if (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK) {
      submitAnswer({ fillText });
    } else if (currentQuestion.questionType === QuestionType.MATCHING) {
      submitAnswer({
        matchingAnswers: Object.entries(matchSelections).map(([promptItemId, answerItemId]) => ({
          promptItemId,
          answerItemId,
        })),
      });
    } else if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) {
      submitAnswer({
        diagramAnswers: Object.entries(diagramSelections).map(([labelId, selectedLabelId]) => ({
          labelId,
          selectedLabelId,
        })),
      });
    }
  }, [currentQuestion.questionType, currentSelections, fillText, matchSelections, diagramSelections, submitAnswer]);

  const canSubmit = useMemo(() => {
    if (isQuestionAnswered) return false;
    switch (currentQuestion.questionType) {
      case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
        return currentSelections.length > 0;
      case QuestionType.FILL_IN_THE_BLANK:
        return fillText.trim() !== '';
      case QuestionType.MATCHING:
        return currentQuestion.matchingPromptItems?.every(p => matchSelections[p.id]) ?? false;
      case QuestionType.DIAGRAM_LABELING:
        return currentQuestion.diagramLabels?.every(l => diagramSelections[l.id]) ?? false;
      default:
        return false;
    }
  }, [isQuestionAnswered, currentQuestion, currentSelections, fillText, matchSelections, diagramSelections]);

  const userProgress = (Object.keys(session.userAnswers).length / totalQuestions) * 100;
  const opponentProgress = (Object.keys(session.opponentAnswers).length / totalQuestions) * 100;

  const renderAvatar = (user: User, borderColor: string) => {
    if (user.avatarUrl) {
      return (
        <Image
          source={{ uri: user.avatarUrl }}
          style={[styles.avatar, { borderColor }]}
        />
      );
    }
    return (
      <View style={[styles.avatarPlaceholder, { borderColor, backgroundColor: colors.cardSecondary }]}>
        <Text style={[styles.avatarText, { color: colors.text }]}>
          {user.name?.charAt(0)?.toUpperCase() || 'U'}
        </Text>
      </View>
    );
  };

  const renderOptions = () => {
    if (!currentQuestion.options) return null;
    const isMulti = currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE;

    return currentQuestion.options.map((opt) => {
      const isSelected = currentSelections.includes(opt.id);
      const isCorrectOption = currentQuestion.correctAnswerIds?.includes(opt.id);

      let optionStyle: StyleProp<ViewStyle>[] = [styles.optionButton, { backgroundColor: colors.card, borderColor: colors.border }];
      const textStyle: StyleProp<TextStyle>[] = [styles.optionText, { color: colors.text }];
      let iconName: string | null = null;
      let iconColor = '';

      if (isQuestionAnswered) {
        if (isCorrectOption) {
          optionStyle = [...optionStyle, styles.optionCorrect];
          iconName = 'checkmark-circle';
          iconColor = '#10b981';
        } else if (isSelected && !isCorrectOption) {
          optionStyle = [...optionStyle, styles.optionIncorrect];
          iconName = 'close-circle';
          iconColor = '#ef4444';
        }
      } else if (isSelected) {
        optionStyle = [...optionStyle, styles.optionSelected];
      }

      return (
        <TouchableOpacity
          key={opt.id}
          style={optionStyle}
          onPress={() => handleOptionSelect(opt.id)}
          disabled={isQuestionAnswered}
          activeOpacity={0.7}
        >
          {isMulti && (
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          )}
          <Text style={textStyle}>{opt.text}</Text>
          {iconName && (
            <Ionicons name={iconName as any} size={24} color={iconColor} style={styles.optionIcon} />
          )}
        </TouchableOpacity>
      );
    });
  };

  const renderFillBlank = () => (
    <View style={styles.fillContainer}>
      <TextInput
        style={[styles.fillInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
        value={fillText}
        onChangeText={setFillText}
        placeholder="Type your answer here..."
        placeholderTextColor={colors.textTertiary}
        editable={!isQuestionAnswered}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );

  const renderMatching = () => (
    <View style={styles.matchingContainer}>
      {currentQuestion.matchingPromptItems?.map((prompt) => (
        <View key={prompt.id} style={[styles.matchingRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.matchingPrompt, { color: colors.text }]}>{prompt.text}</Text>
          <TouchableOpacity
            style={[styles.matchingSelect, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
            onPress={() => !isQuestionAnswered && setShowMatchingDropdown(showMatchingDropdown === prompt.id ? null : prompt.id)}
            disabled={isQuestionAnswered}
          >
            <Text style={[styles.matchingSelectText, { color: matchSelections[prompt.id] ? colors.text : colors.textTertiary }]}>
              {matchSelections[prompt.id]
                ? (shuffledAnswers as MatchingItem[]).find(a => a.id === matchSelections[prompt.id])?.text
                : 'Select...'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {showMatchingDropdown === prompt.id && (
            <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(shuffledAnswers as MatchingItem[]).map((ans) => (
                <TouchableOpacity
                  key={ans.id}
                  style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                  onPress={() => handleMatchSelect(prompt.id, ans.id)}
                >
                  <Text style={[styles.dropdownText, { color: colors.text }]}>{ans.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderDiagram = () => (
    <View style={styles.diagramContainer}>
      {diagramImageUri ? (
        <View style={[styles.diagramImageWrapper, { aspectRatio: diagramAspectRatio }]}>
          <Image
            source={{ uri: diagramImageUri }}
            style={styles.diagramImage}
            resizeMode="contain"
            onLoad={e => {
              const { width, height } = e.nativeEvent.source;
              if (width > 0 && height > 0) setDiagramAspectRatio(width / height);
            }}
          />
          {currentQuestion.diagramLabels?.map((label, index) => (
            <View
              key={label.id}
              style={[
                styles.diagramMarker,
                {
                  left: `${typeof label.x === 'number' ? label.x : 50}%`,
                  top: `${typeof label.y === 'number' ? label.y : 50}%`,
                },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.diagramMarkerText}>{index + 1}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.matchingPrompt, { color: colors.textSecondary, marginBottom: 12 }]}>
          {currentQuestion.imageUrl ? 'Loading diagram…' : 'Diagram image unavailable'}
        </Text>
      )}
      {currentQuestion.diagramLabels?.map((label, index) => (
        <View
          key={label.id}
          style={[styles.matchingRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.matchingPrompt, { color: colors.text }]}>{index + 1}.</Text>
          <TouchableOpacity
            style={[styles.matchingSelect, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
            onPress={() =>
              !isQuestionAnswered &&
              setShowMatchingDropdown(showMatchingDropdown === label.id ? null : label.id)
            }
            disabled={isQuestionAnswered}
          >
            <Text
              style={[
                styles.matchingSelectText,
                { color: diagramSelections[label.id] ? colors.text : colors.textTertiary },
              ]}
            >
              {diagramSelections[label.id]
                ? (shuffledAnswers as DiagramLabel[]).find(a => a.id === diagramSelections[label.id])
                    ?.text || 'Selected'
                : 'Select label...'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {showMatchingDropdown === label.id && (
            <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(shuffledAnswers as DiagramLabel[]).map(opt => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    handleDiagramLabelSelect(label.id, opt.id);
                    setShowMatchingDropdown(null);
                  }}
                >
                  <Text style={[styles.dropdownText, { color: colors.text }]}>{opt.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderQuestionContent = () => {
    switch (currentQuestion.questionType) {
      case QuestionType.MULTIPLE_CHOICE_SINGLE:
      case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
      case QuestionType.TRUE_FALSE:
        return <View style={styles.optionsContainer}>{renderOptions()}</View>;
      case QuestionType.FILL_IN_THE_BLANK:
        return renderFillBlank();
      case QuestionType.MATCHING:
        return renderMatching();
      case QuestionType.DIAGRAM_LABELING:
        return renderDiagram();
      default:
        return <View style={styles.optionsContainer}>{renderOptions()}</View>;
    }
  };

  return (
    // `keyboard` supplies the KeyboardAvoidingView the fill-in-the-blank answer
    // field never had: on Android 15+ (this app targets SDK 36) the window is
    // not resized, so the keyboard covered both the input and Submit Answer.
    <Screen edges={['top']} bottom="none" keyboard className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Game HUD */}
      <View style={[styles.hudContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.hudTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.quitButton}
            accessibilityLabel="Quit game"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {/* Players */}
        <View style={styles.playersRow}>
          <View style={styles.playerInfo}>
            {renderAvatar(session.user, '#6366f1')}
            <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>
              {session.user.name}
            </Text>
          </View>
          <Text style={styles.vsText}>VS</Text>
          <View style={styles.playerInfo}>
            <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>
              {session.opponent.name}
            </Text>
            {renderAvatar(session.opponent, '#64748b')}
          </View>
        </View>

        {/* Progress Bars */}
        <View style={styles.progressSection}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              Score: {session.userScore} | {session.userTime.toFixed(1)}s
            </Text>
            <View style={[styles.progressBar, { backgroundColor: colors.cardSecondary }]}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { backgroundColor: '#6366f1', width: `${userProgress}%` },
                ]}
              />
            </View>
          </View>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              Score: {session.opponentScore} | {session.opponentTime.toFixed(1)}s
            </Text>
            <View style={[styles.progressBar, { backgroundColor: colors.cardSecondary }]}>
              <View
                style={[styles.progressFill, { backgroundColor: '#64748b', width: `${opponentProgress}%` }]}
              />
            </View>
          </View>
        </View>

        <Text style={[styles.questionCounter, { color: colors.textSecondary }]}>
          Question {currentQuestionIndex + 1} of {totalQuestions}
        </Text>
      </View>

      {/* Question Area */}
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.questionCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.questionNumber, { color: colors.primary }]}>
            Question {currentQuestion.questionNumber}
          </Text>
          <Text style={[styles.questionText, { color: colors.text }]}>
            {(currentQuestion as any).questionStem ?? (currentQuestion as any).text ?? (currentQuestion as any).question ?? ''}
          </Text>

          {renderQuestionContent()}

          {/* Submit button for multi-select or complex questions */}
          {canSubmit && (
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSubmitMultiOrComplex}
              activeOpacity={0.8}
            >
              <Text style={styles.submitButtonText}>Submit Answer</Text>
            </TouchableOpacity>
          )}

          {/* Next button after answering */}
          {isQuestionAnswered && (
            <TouchableOpacity
              style={[styles.nextButton, { backgroundColor: colors.primary }]}
              onPress={handleNextQuestion}
              activeOpacity={0.8}
            >
              <Text style={styles.nextButtonText}>
                {currentQuestionIndex < totalQuestions - 1 ? 'Next Question' : 'View Results'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hudContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  hudTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  quitButton: {
    padding: 4,
    marginLeft: -4,
  },
  playersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  playerName: {
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 8,
    maxWidth: 80,
  },
  vsText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ef4444',
    marginHorizontal: 8,
  },
  progressSection: {
    gap: 8,
  },
  progressRow: {
    gap: 4,
  },
  progressLabel: {
    fontSize: 11,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  questionCounter: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  questionCard: {
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  questionText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  optionSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#6366f1',
    borderWidth: 2,
  },
  optionCorrect: {
    backgroundColor: '#d1fae5',
    borderColor: '#10b981',
    borderWidth: 2,
  },
  optionIncorrect: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
    borderWidth: 2,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  optionIcon: {
    marginLeft: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  fillContainer: {
    marginTop: 8,
  },
  fillInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
  },
  matchingContainer: {
    gap: 12,
  },
  diagramContainer: {
    gap: 12,
  },
  diagramImageWrapper: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    position: 'relative',
    marginBottom: 4,
  },
  diagramImage: {
    width: '100%',
    height: '100%',
  },
  diagramMarker: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -12,
    marginTop: -12,
    borderWidth: 2,
    borderColor: '#ffffff',
    zIndex: 2,
  },
  diagramMarkerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  matchingRow: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  matchingPrompt: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  matchingSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  matchingSelectText: {
    fontSize: 14,
  },
  dropdown: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
  },
  dropdownText: {
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#10b981',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    marginTop: 16,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 4,
  },
});
