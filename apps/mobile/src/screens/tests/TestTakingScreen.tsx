// ===========================================
// Lantern Study Mobile - Enhanced Test Taking Screen
// Supports all 7 question types + Test/Study modes
// ===========================================

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Dimensions,
  TextInput,
  Image,
  Modal,
  Pressable,
  AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTestStore, TestQuestion, QuestionType, MatchingPair, TestMode, DiagramLabel } from '../../stores/testStore';
import { useTheme, type ThemeColors } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { useStudySettings } from '../../stores/settingsStore';
import { shuffleArray } from '@lantern/shared/utils';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { hapticSuccess } from '../../utils/haptics';
import { formatCorrectAnswerDisplay } from '../../utils/questionHelpers';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TestTakingRouteParams = {
  TestTaking: {
    testId: string;
    testName: string;
    mode?: TestMode;
    isOffline?: boolean;
    offlineTestId?: string;
    groupName?: string;
    groupId?: string;
  };
};

// ============================================
// Question Type Components
// ============================================

// Multiple Choice Single Answer
const MCQSingleComponent = ({ 
  question, 
  selectedAnswer, 
  onAnswer,
  colors,
}: { 
  question: TestQuestion; 
  selectedAnswer?: string; 
  onAnswer: (answer: string) => void;
  colors: ThemeColors;
}) => (
  <View style={s(colors).optionsContainer}>
    {question.options?.map((option, index) => (
      <TouchableOpacity
        key={index}
        style={[
          s(colors).optionButton,
          { backgroundColor: colors.inputBackground, borderColor: colors.border },
          selectedAnswer === option && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
        onPress={() => onAnswer(option)}
        activeOpacity={0.7}
      >
        <View style={[
          s(colors).optionRadio,
          { borderColor: colors.border },
          selectedAnswer === option && s(colors).optionRadioSelected
        ]}>
          {selectedAnswer === option && <View style={s(colors).optionRadioInner} />}
        </View>
        <Text style={[
          s(colors).optionText,
          { color: colors.text },
          selectedAnswer === option && s(colors).optionTextSelected
        ]}>
          {option}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// Multiple Choice Multiple Answers
const MCQMultipleComponent = ({ 
  question, 
  selectedAnswers, 
  onAnswer,
  colors,
}: { 
  question: TestQuestion; 
  selectedAnswers?: string[]; 
  onAnswer: (answers: string[]) => void;
  colors: ThemeColors;
}) => {
  const toggleOption = (option: string) => {
    const current = selectedAnswers || [];
    if (current.includes(option)) {
      onAnswer(current.filter(a => a !== option));
    } else {
      onAnswer([...current, option]);
    }
  };

  return (
    <View style={s(colors).optionsContainer}>
      <Text style={[s(colors).multiSelectHint, { color: colors.textSecondary }]}>Select all that apply</Text>
      {question.options?.map((option, index) => {
        const isSelected = selectedAnswers?.includes(option);
        return (
          <TouchableOpacity
            key={index}
            style={[
              s(colors).optionButton,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
              isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => toggleOption(option)}
            activeOpacity={0.7}
          >
            <View style={[
              s(colors).optionCheckbox,
              { borderColor: colors.border },
              isSelected && s(colors).optionCheckboxSelected
            ]}>
              {isSelected && <Ionicons name="checkmark" size={16} color="#ffffff" />}
            </View>
            <Text style={[
              s(colors).optionText,
              { color: colors.text },
              isSelected && s(colors).optionTextSelected
            ]}>
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// True/False
const TrueFalseComponent = ({ 
  selectedAnswer, 
  onAnswer,
  colors,
}: { 
  question: TestQuestion; 
  selectedAnswer?: string; 
  onAnswer: (answer: string) => void;
  colors: ThemeColors;
}) => (
  <View style={s(colors).trueFalseContainer}>
    <TouchableOpacity
      style={[
        s(colors).trueFalseButton,
        {
          backgroundColor: selectedAnswer === 'True' ? colors.success : colors.successBackground,
          borderColor: colors.success,
        },
        selectedAnswer === 'True' && s(colors).trueFalseSelected,
      ]}
      onPress={() => onAnswer('True')}
    >
      <Ionicons 
        name="checkmark-circle" 
        size={32} 
        color={selectedAnswer === 'True' ? colors.textInverse : colors.success} 
      />
      <Text style={[
        s(colors).trueFalseText,
        { color: selectedAnswer === 'True' ? colors.textInverse : colors.text },
      ]}>
        True
      </Text>
    </TouchableOpacity>
    
    <TouchableOpacity
      style={[
        s(colors).trueFalseButton,
        {
          backgroundColor: selectedAnswer === 'False' ? colors.error : colors.errorBackground,
          borderColor: colors.error,
        },
        selectedAnswer === 'False' && s(colors).trueFalseSelected,
      ]}
      onPress={() => onAnswer('False')}
    >
      <Ionicons 
        name="close-circle" 
        size={32} 
        color={selectedAnswer === 'False' ? colors.textInverse : colors.error} 
      />
      <Text style={[
        s(colors).trueFalseText,
        { color: selectedAnswer === 'False' ? colors.textInverse : colors.text },
      ]}>
        False
      </Text>
    </TouchableOpacity>
  </View>
);

// Fill in the Blank
const FillBlankComponent = ({ 
  question, 
  answer, 
  onAnswer, 
  colors,
}: { 
  question: TestQuestion; 
  answer?: string; 
  onAnswer: (answer: string) => void;
  colors: ThemeColors;
}) => (
  <View style={s(colors).fillBlankContainer}>
    <Text style={s(colors).fillBlankHint}>Type your answer below:</Text>
    <TextInput
      style={s(colors).fillBlankInput}
      value={answer || ''}
      onChangeText={onAnswer}
      placeholder="Enter your answer..."
      placeholderTextColor="#64748b"
      autoCapitalize="none"
      autoCorrect={false}
    />
  </View>
);

// Matching
const MatchingComponent = ({ 
  question, 
  matches, 
  onAnswer, 
  colors,
}: { 
  question: TestQuestion; 
  matches?: Record<string, string>; 
  onAnswer: (matches: Record<string, string>) => void;
  colors: ThemeColors;
}) => {
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const pairs = question.matchingPairs || [];
  const rightOptions = pairs.map(p => p.right);
  
  const handleLeftSelect = (left: string) => {
    setSelectedLeft(left);
  };
  
  const handleRightSelect = (right: string) => {
    if (selectedLeft) {
      const newMatches = { ...(matches || {}), [selectedLeft]: right };
      onAnswer(newMatches);
      setSelectedLeft(null);
    }
  };
  
  const getMatchedRight = (left: string) => matches?.[left];
  const isRightUsed = (right: string) => Object.values(matches || {}).includes(right);

  return (
    <View style={s(colors).matchingContainer}>
      <Text style={s(colors).matchingHint}>
        {selectedLeft ? `Now select a match for "${selectedLeft}"` : 'Tap an item on the left, then its match on the right'}
      </Text>
      
      <View style={s(colors).matchingColumns}>
        {/* Left Column */}
        <View style={s(colors).matchingColumn}>
          <Text style={s(colors).matchingColumnTitle}>Items</Text>
          {pairs.map((pair) => {
            const matched = getMatchedRight(pair.left);
            return (
              <TouchableOpacity
                key={pair.id}
                style={[
                  s(colors).matchingItem,
                  selectedLeft === pair.left && s(colors).matchingItemSelected,
                  matched && s(colors).matchingItemMatched,
                ]}
                onPress={() => handleLeftSelect(pair.left)}
              >
                <Text style={s(colors).matchingItemText}>{pair.left}</Text>
                {matched && (
                  <View style={s(colors).matchBadge}>
                    <Ionicons name="link" size={14} color="#10b981" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        
        {/* Right Column */}
        <View style={s(colors).matchingColumn}>
          <Text style={s(colors).matchingColumnTitle}>Matches</Text>
          {rightOptions.map((right, index) => {
            const isUsed = isRightUsed(right);
            return (
              <TouchableOpacity
                key={index}
                style={[
                  s(colors).matchingItem,
                  isUsed && s(colors).matchingItemUsed,
                  !selectedLeft && s(colors).matchingItemDisabled,
                ]}
                onPress={() => handleRightSelect(right)}
                disabled={!selectedLeft}
              >
                <Text style={[
                  s(colors).matchingItemText,
                  isUsed && s(colors).matchingItemTextUsed,
                ]}>
                  {right}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      
      {/* Clear matches button */}
      {matches && Object.keys(matches).length > 0 && (
        <TouchableOpacity 
          style={s(colors).clearMatchesButton}
          onPress={() => onAnswer({})}
        >
          <Ionicons name="refresh" size={16} color="#f59e0b" />
          <Text style={s(colors).clearMatchesText}>Clear all matches</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// Diagram Labeling
const DiagramLabelingComponent = ({
  question,
  labels,
  onAnswer,
  colors,
}: {
  question: TestQuestion;
  labels?: Record<string, string>;
  onAnswer: (labels: Record<string, string>) => void;
  colors: ThemeColors;
}) => {
  const shuffledOptions = useMemo(
    () => shuffleArray(question.diagramLabels || []),
    [question.id, question.diagramLabels]
  );
  const [pickerLabelId, setPickerLabelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const rawImageUri = question.diagramUrl || question.imageUrl;
  const imageUri = useResolvedStorageUrl(rawImageUri);
  const imagePending = !!rawImageUri && !imageUri;

  const handleSelect = (pointId: string, selectedId: string) => {
    onAnswer({ ...(labels || {}), [pointId]: selectedId });
    setPickerLabelId(null);
  };

  const selectedOptionText = (selectedId?: string) => {
    const opt = shuffledOptions.find(o => o.id === selectedId);
    return opt?.label || (opt as { text?: string } | undefined)?.text || 'Select a label...';
  };

  return (
    <View style={s(colors).diagramContainer}>
      <View style={[s(colors).diagramImageWrapper, imageUri ? { aspectRatio } : null]}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={s(colors).diagramImage}
            resizeMode="contain"
            onLoad={e => {
              const { width, height } = e.nativeEvent.source;
              if (width > 0 && height > 0) setAspectRatio(width / height);
            }}
          />
        ) : (
          <View style={s(colors).diagramImagePlaceholder}>
            <Ionicons name="image-outline" size={48} color="#64748b" />
            <Text style={s(colors).diagramPlaceholderText}>
              {imagePending ? 'Loading diagram…' : 'Diagram will appear here'}
            </Text>
          </View>
        )}
        {imageUri
          ? question.diagramLabels?.map((label, index) => (
              <View
                key={label.id}
                style={[
                  s(colors).diagramMarker,
                  {
                    left: `${typeof label.x === 'number' ? label.x : 50}%`,
                    top: `${typeof label.y === 'number' ? label.y : 50}%`,
                  },
                ]}
                pointerEvents="none"
              >
                <Text style={s(colors).diagramMarkerText}>{index + 1}</Text>
              </View>
            ))
          : null}
      </View>

      <Text style={s(colors).diagramHint}>Match each numbered point to the correct label:</Text>

      <View style={s(colors).labelInputsContainer}>
        {question.diagramLabels?.map((label, index) => (
          <View key={label.id} style={s(colors).labelInputRow}>
            <View style={s(colors).labelNumber}>
              <Text style={s(colors).labelNumberText}>{index + 1}</Text>
            </View>
            <TouchableOpacity
              style={[
                s(colors).labelPicker,
                labels?.[label.id] ? s(colors).labelPickerSelected : null,
              ]}
              onPress={() => setPickerLabelId(label.id)}
            >
              <Text
                style={[
                  s(colors).labelPickerText,
                  !labels?.[label.id] ? s(colors).labelPickerPlaceholder : null,
                ]}
                numberOfLines={1}
              >
                {selectedOptionText(labels?.[label.id])}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <Modal visible={pickerLabelId !== null} transparent animationType="fade">
        <Pressable style={s(colors).pickerOverlay} onPress={() => setPickerLabelId(null)}>
          <Pressable style={s(colors).pickerSheet} onPress={e => e.stopPropagation?.()}>
            <Text style={s(colors).pickerTitle}>Select label</Text>
            <ScrollView
              style={s(colors).pickerScroll}
              contentContainerStyle={s(colors).pickerScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {shuffledOptions.map((opt: DiagramLabel) => (
                <TouchableOpacity
                  key={opt.id}
                  style={s(colors).pickerOption}
                  onPress={() => pickerLabelId && handleSelect(pickerLabelId, opt.id)}
                >
                  <Text style={s(colors).pickerOptionText}>
                    {opt.label || (opt as { text?: string }).text}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

// Open Ended
const OpenEndedComponent = ({ 
  question, 
  answer, 
  onAnswer, 
  colors,
}: { 
  question: TestQuestion; 
  answer?: string; 
  onAnswer: (answer: string) => void;
  colors: ThemeColors;
}) => {
  const wordCount = answer ? answer.trim().split(/\s+/).filter(w => w).length : 0;

  return (
    <View style={s(colors).openEndedContainer}>
      <Text style={s(colors).openEndedHint}>
        Write your answer in detail. Include relevant examples where applicable.
      </Text>
      <TextInput
        style={s(colors).openEndedInput}
        value={answer || ''}
        onChangeText={onAnswer}
        placeholder="Type your answer here..."
        placeholderTextColor="#64748b"
        multiline
        textAlignVertical="top"
      />
      <View style={s(colors).openEndedFooter}>
        <Text style={s(colors).wordCount}>{wordCount} words</Text>
        {question.keywords && (
          <Text style={s(colors).keywordsHint}>
            Hint: Consider these concepts: {question.keywords.slice(0, 2).join(', ')}...
          </Text>
        )}
      </View>
    </View>
  );
};

// ============================================
// Main Component
// ============================================

export default function TestTakingScreen() {
  const route = useRoute<RouteProp<TestTakingRouteParams, 'TestTaking'>>();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { testName, isOffline, groupName, groupId, offlineTestId } = route.params;

  const {
    activeTest,
    answerQuestion,
    revealAnswer,
    checkCurrentAnswer,
    nextQuestion,
    previousQuestion,
    submitTest,
    exitStudyMode,
    toggleFlag,
    goToQuestion,
    updateTimeRemaining,
    setActiveTestAttribution,
  } = useTestStore();

  const { showExplanationsImmediately } = useStudySettings();
  const isFocused = useIsFocused();
  const [timeRemaining, setTimeRemaining] = useState(activeTest?.timeRemaining || 0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const questionViewStartTimeRef = useRef<number | null>(null);
  const handleSubmitRef = useRef<(timeUp?: boolean) => Promise<void>>(async () => undefined);

  // Route params often arrive after draft create — bind study-group attribution ASAP.
  useEffect(() => {
    if (!groupId && !groupName) return;
    setActiveTestAttribution({ groupId, groupName });
  }, [groupId, groupName, setActiveTestAttribution]);

  // Get mode from active test
  const isStudyMode = activeTest?.mode === 'study';

  useConfirmBeforeExit(!!activeTest && !isSubmitting, {
    title: isStudyMode ? 'Exit Study Mode' : 'Exit Test',
    message: isStudyMode
      ? 'Are you sure you want to exit? You can come back anytime.'
      : 'Are you sure you want to exit? Your progress will be lost and the test will not be scored.',
    confirmLabel: 'Exit',
    destructive: !isStudyMode,
    // Always abandon so the timer cannot keep running and auto-submit a zero.
    onConfirm: () => exitStudyMode(),
  });

  // Keep local countdown in sync when resuming an in-progress session.
  useEffect(() => {
    if (activeTest?.timeRemaining != null) {
      setTimeRemaining(activeTest.timeRemaining);
    }
  }, [activeTest?.test.id, activeTest?.startTime]);

  // Reset feedback when changing questions
  useEffect(() => {
    setShowFeedback(false);
    setFeedbackResult(null);
    questionViewStartTimeRef.current = Date.now();
  }, [activeTest?.currentQuestionIndex]);

  const currentQuestion = useMemo(() => {
    if (!activeTest) return null;
    return activeTest.questions[activeTest.currentQuestionIndex];
  }, [activeTest]);

  const questionImageSrc =
    currentQuestion && currentQuestion.type !== 'diagram_labeling'
      ? currentQuestion.imageUrl || currentQuestion.diagramUrl
      : undefined;
  const resolvedQuestionImage = useResolvedStorageUrl(questionImageSrc);

  const progress = useMemo(() => {
    if (!activeTest) return 0;
    return (activeTest.currentQuestionIndex + 1) / activeTest.questions.length;
  }, [activeTest]);

  const answeredCount = useMemo(() => {
    if (!activeTest) return 0;
    return Object.keys(activeTest.answers).length;
  }, [activeTest]);

  // Check if current question has been answered (for study mode)
  const hasAnsweredCurrent = useMemo(() => {
    if (!activeTest || !currentQuestion) return false;
    return activeTest.answers[currentQuestion.id] !== undefined;
  }, [activeTest, currentQuestion]);

  // Check if answer has been revealed (for study mode)
  const isAnswerRevealed = useMemo(() => {
    if (!activeTest || !currentQuestion) return false;
    return activeTest.revealedAnswers.has(currentQuestion.id);
  }, [activeTest, currentQuestion]);

  useEffect(() => {
    if (
      !isStudyMode ||
      !showExplanationsImmediately ||
      !hasAnsweredCurrent ||
      isAnswerRevealed ||
      !currentQuestion
    ) {
      return;
    }

    const result = checkCurrentAnswer();
    if (result) {
      setFeedbackResult(result);
      setShowFeedback(true);
      revealAnswer(currentQuestion.id);
    }
  }, [
    isStudyMode,
    showExplanationsImmediately,
    hasAnsweredCurrent,
    isAnswerRevealed,
    currentQuestion,
    checkCurrentAnswer,
    revealAnswer,
  ]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getQuestionTypeLabel = (type: QuestionType): string => {
    const labels: Record<QuestionType, string> = {
      'multiple_choice_single': 'Multiple Choice',
      'multiple_choice_multiple': 'Select Multiple',
      'true_false': 'True/False',
      'fill_in_blank': 'Fill in Blank',
      'matching': 'Matching',
      'diagram_labeling': 'Diagram Labeling',
      'open_ended': 'Open Ended',
    };
    return labels[type] || 'Question';
  };

  const handleAnswer = useCallback((answer: string | string[] | Record<string, string>) => {
    if (!currentQuestion) return;
    const timeSpentSeconds = questionViewStartTimeRef.current
      ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000)
      : 0;
    answerQuestion(currentQuestion.id, answer, timeSpentSeconds);
  }, [currentQuestion, answerQuestion]);

  // Check answer in study mode
  const handleCheckAnswer = useCallback(() => {
    if (!currentQuestion || !activeTest) return;
    
    const result = checkCurrentAnswer();
    if (result) {
      setFeedbackResult(result);
      setShowFeedback(true);
      revealAnswer(currentQuestion.id);
    }
  }, [currentQuestion, activeTest, checkCurrentAnswer, revealAnswer]);

  const flaggedCount = useMemo(() => {
    if (!activeTest) return 0;
    return activeTest.flaggedQuestions.size;
  }, [activeTest]);

  const isCurrentFlagged = useMemo(() => {
    if (!activeTest || !currentQuestion) return false;
    return activeTest.flaggedQuestions.has(currentQuestion.id);
  }, [activeTest, currentQuestion]);

  const finalizeSubmit = useCallback(async () => {
    const liveSession = useTestStore.getState().activeTest;
    if (!liveSession || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const attempt = await submitTest(userId, {
        isOffline: !!isOffline,
        groupName: groupName || liveSession.test.name,
        groupId,
      });
      // Marketplace question bank: queue the attempt for its leaderboard.
      // These sessions are usually finished offline, so the post is deferred
      // to the pending-results sync rather than attempted here.
      if (offlineTestId && offlineTestId.startsWith('qbank-')) {
        const correct = (attempt.answers || []).filter((a) => a.isCorrect).length;
        void import('../../utils/pendingQuestionBankScores')
          .then(async ({ enqueueScoreForBundle, flushPendingQuestionBankScores }) => {
            await enqueueScoreForBundle(offlineTestId, correct, liveSession.questions.length);
            // Opportunistic flush; failures stay queued for the next sync.
            await flushPendingQuestionBankScores();
          })
          .catch(() => {
            // leaderboard is not critical to finishing a test
          });
      }
      setShowReviewModal(false);
      navigation.replace('TestResults', { attemptId: attempt.id });
    } catch {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [submitTest, userId, isOffline, groupName, groupId, offlineTestId, navigation]);

  const handleSubmit = useCallback(async (timeUp = false) => {
    // Session may have been abandoned (exit) while a timer tick was queued.
    const liveSession = useTestStore.getState().activeTest;
    if (!liveSession) return;
    hapticSuccess();

    // Study mode doesn't need submission
    if (liveSession.mode === 'study') {
      Alert.alert(
        'End Study Session',
        'Would you like to end this study session?',
        [
          { text: 'Continue', style: 'cancel' },
          { text: 'End Session', onPress: () => {
            exitStudyMode();
            navigation.goBack();
          }},
        ]
      );
      return;
    }

    if (timeUp) {
      Alert.alert('Time\'s Up!', 'Your test has been submitted automatically.');
      await finalizeSubmit();
      return;
    }

    setShowReviewModal(true);
  }, [finalizeSubmit, exitStudyMode, navigation]);

  handleSubmitRef.current = handleSubmit;

  // Timer — only while focused and app is active; never after abandon.
  useEffect(() => {
    if (!isFocused) return;
    if (!activeTest || activeTest.mode === 'study' || activeTest.test.timeLimit === 0) return;

    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (!useTestStore.getState().activeTest) {
        clearInterval(timer);
        return;
      }

      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          updateTimeRemaining(0);
          void handleSubmitRef.current(true);
          return 0;
        }
        const next = prev - 1;
        updateTimeRemaining(next);
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeTest?.test.timeLimit, activeTest?.mode, activeTest?.test.id, isFocused, updateTimeRemaining]);

  // Render question based on type
  const renderQuestionInput = () => {
    if (!currentQuestion || !activeTest) return null;
    
    const answer = activeTest.answers[currentQuestion.id];
    
    switch (currentQuestion.type) {
      case 'multiple_choice_single':
        return (
          <MCQSingleComponent
            question={currentQuestion}
            selectedAnswer={answer as string}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'multiple_choice_multiple':
        return (
          <MCQMultipleComponent
            question={currentQuestion}
            selectedAnswers={answer as string[]}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'true_false':
        return (
          <TrueFalseComponent
            question={currentQuestion}
            selectedAnswer={answer as string}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'fill_in_blank':
        return (
          <FillBlankComponent
            question={currentQuestion}
            answer={answer as string}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'matching':
        return (
          <MatchingComponent
            question={currentQuestion}
            matches={answer as Record<string, string>}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'diagram_labeling':
        return (
          <DiagramLabelingComponent
            question={currentQuestion}
            labels={answer as Record<string, string>}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      case 'open_ended':
        return (
          <OpenEndedComponent
            question={currentQuestion}
            answer={answer as string}
            onAnswer={handleAnswer}
            colors={colors}
          />
        );
      
      default:
        return (
          <Text style={s(colors).errorText}>Unknown question type</Text>
        );
    }
  };

  if (!activeTest || !currentQuestion) {
    const endedCopy = isSubmitting
      ? 'Submitting your answers…'
      : 'This test session has ended.';
    return (
      <SafeAreaView style={[s(colors).container, { backgroundColor: colors.background }]}>
        <View style={s(colors).errorContainer}>
          <Text style={[s(colors).errorText, { color: colors.textSecondary }]}>{endedCopy}</Text>
          {!isSubmitting && (
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={[s(colors).errorLink, { color: colors.primary }]}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s(colors).container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[s(colors).header, { backgroundColor: colors.card, borderBottomColor: colors.border }, isStudyMode && s(colors).headerStudy]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s(colors).exitButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <View style={s(colors).headerCenter}>
          <View style={s(colors).headerTitleRow}>
            <Text style={[s(colors).testName, { color: colors.text }]} numberOfLines={1}>{testName}</Text>
            {isStudyMode && (
              <View style={s(colors).studyBadge}>
                <Ionicons name="book" size={12} color="#10b981" />
                <Text style={s(colors).studyBadgeText}>Study</Text>
              </View>
            )}
          </View>
          {!isStudyMode && activeTest.test.timeLimit > 0 && (
            <View style={[
              s(colors).timerBadge,
              timeRemaining < 60 && s(colors).timerWarning
            ]}>
              <Ionicons name="time" size={14} color={timeRemaining < 60 ? colors.error : colors.text} />
              <Text style={[
                s(colors).timerText,
                timeRemaining < 60 && s(colors).timerTextWarning
              ]}>
                {formatTime(timeRemaining)}
              </Text>
            </View>
          )}
        </View>
        
        {!isStudyMode ? (
          <TouchableOpacity onPress={() => handleSubmit()} style={s(colors).submitButton}>
            <Text style={s(colors).submitButtonText}>Submit</Text>
          </TouchableOpacity>
        ) : (
          <View style={s(colors).studyProgress}>
            <Text style={s(colors).studyProgressText}>{answeredCount}/{activeTest.questions.length}</Text>
          </View>
        )}
      </View>

      {!isStudyMode && currentQuestion && (
        <View style={s(colors).flagRow}>
          <TouchableOpacity
            style={[s(colors).flagButton, isCurrentFlagged && s(colors).flagButtonActive]}
            onPress={() => toggleFlag(currentQuestion.id)}
            accessibilityLabel={isCurrentFlagged ? 'Remove bookmark' : 'Bookmark for review'}
          >
            <Ionicons
              name={isCurrentFlagged ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={isCurrentFlagged ? '#eab308' : '#94a3b8'}
            />
            <Text style={[s(colors).flagButtonText, isCurrentFlagged && s(colors).flagButtonTextActive]}>
              {isCurrentFlagged ? 'Bookmarked' : 'Bookmark for review'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Progress Bar */}
      <View style={s(colors).progressContainer}>
        <View style={[s(colors).progressBar, { backgroundColor: colors.border }, isStudyMode && s(colors).progressBarStudy]}>
          <View style={[
            s(colors).progressFill, 
            { width: `${progress * 100}%` },
            isStudyMode && s(colors).progressFillStudy
          ]} />
        </View>
        <Text style={[s(colors).progressText, { color: colors.textSecondary }]}>
          {activeTest.currentQuestionIndex + 1} / {activeTest.questions.length}
        </Text>
      </View>

      {/* Question */}
      <ScrollView 
        style={s(colors).content}
        contentContainerStyle={s(colors).contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s(colors).questionCard, { backgroundColor: colors.card }]}>
          <View style={s(colors).questionHeader}>
            <View style={[s(colors).questionTypeBadge, { backgroundColor: colors.primaryBackground }]}>
              <Text style={[s(colors).questionTypeText, { color: colors.primary }]}>
                {getQuestionTypeLabel(currentQuestion.type)}
              </Text>
            </View>
            <Text style={[s(colors).pointsText, { color: colors.textSecondary }]}>{currentQuestion.points} pts</Text>
          </View>
          
          <Text style={[s(colors).questionText, { color: colors.text }]}>{currentQuestion.question}</Text>

          {resolvedQuestionImage ? (
            <View style={s(colors).questionImageWrapper}>
              <Image
                source={{ uri: resolvedQuestionImage }}
                style={s(colors).questionImage}
                resizeMode="contain"
              />
            </View>
          ) : null}
          
          {currentQuestion.tags && currentQuestion.tags.length > 0 && (
            <View style={s(colors).tagsContainer}>
              {currentQuestion.tags.map((tag) => (
                <View key={tag} style={[s(colors).tag, { backgroundColor: colors.inputBackground }]}>
                  <Text style={[s(colors).tagText, { color: colors.textSecondary }]}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Question Input */}
        {renderQuestionInput()}

        {/* Study Mode Feedback */}
        {isStudyMode && showFeedback && feedbackResult && (
          <View style={[
            s(colors).feedbackContainer,
            feedbackResult.isCorrect ? s(colors).feedbackCorrect : s(colors).feedbackIncorrect
          ]}>
            <View style={s(colors).feedbackHeader}>
              <Ionicons 
                name={feedbackResult.isCorrect ? 'checkmark-circle' : 'close-circle'} 
                size={28} 
                color={feedbackResult.isCorrect ? colors.success : colors.error} 
              />
              <Text style={[
                s(colors).feedbackTitle,
                feedbackResult.isCorrect ? s(colors).feedbackTitleCorrect : s(colors).feedbackTitleIncorrect
              ]}>
                {feedbackResult.isCorrect ? 'Correct!' : 'Incorrect'}
              </Text>
            </View>
            {feedbackResult.explanation && (
              <Text style={s(colors).feedbackExplanation}>{feedbackResult.explanation}</Text>
            )}
            {!feedbackResult.isCorrect && (
              <View style={s(colors).correctAnswerBox}>
                <Text style={s(colors).correctAnswerLabel}>Correct answer:</Text>
                <Text style={s(colors).correctAnswerText}>
                  {formatCorrectAnswerDisplay(currentQuestion)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Study Mode Check Answer Button */}
        {isStudyMode && hasAnsweredCurrent && !isAnswerRevealed && (
          <TouchableOpacity
            style={s(colors).checkAnswerButton}
            onPress={handleCheckAnswer}
            activeOpacity={0.8}
          >
            <Ionicons name="eye" size={20} color="#ffffff" />
            <Text style={s(colors).checkAnswerText}>Check Answer</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Navigation */}
      <View
        style={[
          s(colors).navigation,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          },
          isStudyMode && s(colors).navigationStudy,
        ]}
      >
        <TouchableOpacity
          style={[
            s(colors).navButton,
            activeTest.currentQuestionIndex === 0 && s(colors).navButtonDisabled
          ]}
          onPress={previousQuestion}
          disabled={activeTest.currentQuestionIndex === 0}
        >
          <Ionicons 
            name="chevron-back" 
            size={24} 
            color={activeTest.currentQuestionIndex === 0 ? colors.textTertiary : colors.text} 
          />
          <Text style={[
            s(colors).navButtonText,
            { color: colors.text },
            activeTest.currentQuestionIndex === 0 && { color: colors.textTertiary },
          ]}>
            Previous
          </Text>
        </TouchableOpacity>

        <View style={s(colors).questionDots}>
          {activeTest.questions.slice(
            Math.max(0, activeTest.currentQuestionIndex - 2),
            Math.min(activeTest.questions.length, activeTest.currentQuestionIndex + 3)
          ).map((q, i) => {
            const actualIndex = Math.max(0, activeTest.currentQuestionIndex - 2) + i;
            const isAnswered = !!activeTest.answers[q.id];
            const isCurrent = actualIndex === activeTest.currentQuestionIndex;
            const isRevealed = activeTest.revealedAnswers.has(q.id);
            const isFlagged = activeTest.flaggedQuestions.has(q.id);
            
            return (
              <TouchableOpacity
                key={q.id}
                onPress={() => goToQuestion(actualIndex)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <View
                  style={[
                    s(colors).dot,
                    { backgroundColor: colors.border },
                    isAnswered && { backgroundColor: colors.success },
                    isCurrent && { backgroundColor: colors.primary, width: 12 },
                    isStudyMode && isRevealed && { backgroundColor: colors.info },
                    isFlagged && { backgroundColor: colors.warning },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Next/Finish button */}
        {activeTest.currentQuestionIndex === activeTest.questions.length - 1 ? (
          isStudyMode ? (
            <TouchableOpacity
              style={[s(colors).navButton, s(colors).finishStudyButton, { backgroundColor: colors.successBackground }]}
              onPress={() => handleSubmit()}
            >
              <Text style={[s(colors).finishStudyText, { color: colors.success }]}>Finish</Text>
              <Ionicons name="checkmark" size={24} color={colors.success} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s(colors).navButton, s(colors).navButtonDisabled]}
              disabled
            >
              <Text style={[s(colors).navButtonTextDisabled, { color: colors.textTertiary }]}>Next</Text>
              <Ionicons name="chevron-forward" size={24} color={colors.textTertiary} />
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            style={s(colors).navButton}
            onPress={nextQuestion}
          >
            <Text style={[s(colors).navButtonText, { color: colors.primary }]}>Next</Text>
            <Ionicons name="chevron-forward" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <Modal
        visible={showReviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={s(colors).reviewOverlay}>
          <View style={[s(colors).reviewModal, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <Text style={s(colors).reviewTitle}>Review & Submit</Text>
            <Text style={s(colors).reviewSubtitle}>
              {answeredCount} answered · {activeTest.questions.length - answeredCount} skipped · {flaggedCount} bookmarked
            </Text>

            <ScrollView style={s(colors).reviewGridScroll} contentContainerStyle={s(colors).reviewGrid}>
              {activeTest.questions.map((q, index) => {
                const isAnswered = !!activeTest.answers[q.id];
                const isFlagged = activeTest.flaggedQuestions.has(q.id);
                return (
                  <TouchableOpacity
                    key={q.id}
                    style={[
                      s(colors).reviewCell,
                      isAnswered && s(colors).reviewCellAnswered,
                      isFlagged && s(colors).reviewCellFlagged,
                    ]}
                    onPress={() => {
                      setShowReviewModal(false);
                      goToQuestion(index);
                    }}
                  >
                    <Text style={s(colors).reviewCellText}>{index + 1}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={s(colors).reviewActions}>
              <TouchableOpacity
                style={s(colors).reviewCancelButton}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={s(colors).reviewCancelText}>Continue Test</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s(colors).reviewSubmitButton, isSubmitting && { opacity: 0.6 }]}
                disabled={isSubmitting}
                onPress={() => void finalizeSubmit()}
              >
                <Text style={s(colors).reviewSubmitText}>{isSubmitting ? 'Submitting...' : 'Submit Test'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Styles were hardcoded slate, so a test stayed dark in light mode. Built per
// theme and cached, so the implicit-return question components can read them
// straight from the `colors` prop they already receive.
const styleCache = new WeakMap<ThemeColors, ReturnType<typeof createStyles>>();
const s = (c: ThemeColors) => {
  let cached = styleCache.get(c);
  if (!cached) {
    cached = createStyles(c);
    styleCache.set(c, cached);
  }
  return cached;
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  exitButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  testName: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
    marginBottom: 4,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  timerWarning: {
    backgroundColor: '#ef444420',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text,
  },
  timerTextWarning: {
    color: c.error,
  },
  submitButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: c.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
    minWidth: 50,
    textAlign: 'right',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  questionCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  questionTypeBadge: {
    backgroundColor: '#6366f120',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  questionTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '500',
    color: c.text,
    lineHeight: 28,
  },
  questionImageWrapper: {
    marginTop: 16,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  questionImage: {
    width: '100%',
    minHeight: 120,
    maxHeight: 320,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  tag: {
    backgroundColor: c.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: c.textSecondary,
  },
  
  // MCQ Single styles
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f110',
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4b5563',
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionRadioSelected: {
    borderColor: '#6366f1',
  },
  optionRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#6366f1',
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: c.text,
  },
  optionTextSelected: {
    color: c.textInverse,
    fontWeight: '500',
  },
  
  // MCQ Multiple styles
  multiSelectHint: {
    fontSize: 14,
    color: c.textSecondary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  optionCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4b5563',
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionCheckboxSelected: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  
  // True/False styles
  trueFalseContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  trueFalseButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 2,
  },
  trueButton: {
    backgroundColor: '#10b98110',
    borderColor: '#10b98140',
  },
  falseButton: {
    backgroundColor: '#ef444410',
    borderColor: '#ef444440',
  },
  trueFalseSelected: {
    borderWidth: 3,
  },
  trueButtonSelected: {
    backgroundColor: c.success,
    borderColor: c.success,
  },
  falseButtonSelected: {
    backgroundColor: c.error,
    borderColor: c.error,
  },
  trueFalseText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  
  // Fill in Blank styles
  fillBlankContainer: {
    gap: 12,
  },
  fillBlankHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  fillBlankInput: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: c.text,
    borderWidth: 2,
    borderColor: c.border,
  },
  
  // Matching styles
  matchingContainer: {
    gap: 16,
  },
  matchingHint: {
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  matchingColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  matchingColumn: {
    flex: 1,
    gap: 8,
  },
  matchingColumnTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
    textAlign: 'center',
    marginBottom: 4,
  },
  matchingItem: {
    backgroundColor: c.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchingItemSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  matchingItemMatched: {
    borderColor: c.success,
    backgroundColor: '#10b98110',
  },
  matchingItemUsed: {
    opacity: 0.5,
    backgroundColor: '#10b98120',
  },
  matchingItemDisabled: {
    opacity: 0.7,
  },
  matchingItemText: {
    fontSize: 14,
    color: c.text,
    flex: 1,
  },
  matchingItemTextUsed: {
    color: c.success,
  },
  matchBadge: {
    marginLeft: 8,
  },
  clearMatchesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  clearMatchesText: {
    fontSize: 14,
    color: '#f59e0b',
  },
  
  // Diagram Labeling styles
  diagramContainer: {
    gap: 16,
  },
  diagramImageWrapper: {
    position: 'relative',
    backgroundColor: c.card,
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
  },
  diagramImagePlaceholder: {
    backgroundColor: c.card,
    borderRadius: 12,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagramImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  diagramMarker: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    borderRadius: 14,
    backgroundColor: '#dc2626',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  diagramMarkerText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
  },
  diagramPlaceholderText: {
    fontSize: 14,
    color: c.textTertiary,
    marginTop: 8,
  },
  diagramHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  labelInputsContainer: {
    gap: 10,
  },
  labelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  labelNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelNumberText: {
    fontSize: 14,
    fontWeight: '600',
    // sits on a hardcoded red chip
    color: '#ffffff',
  },
  labelPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  labelPickerSelected: {
    borderColor: '#6366f1',
  },
  labelPickerText: {
    flex: 1,
    fontSize: 14,
    color: c.text,
    marginRight: 8,
  },
  labelPickerPlaceholder: {
    color: c.textTertiary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerScrollContent: {
    paddingBottom: 8,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
    marginBottom: 12,
  },
  pickerOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  pickerOptionText: {
    fontSize: 15,
    color: c.text,
  },
  
  // Open Ended styles
  openEndedContainer: {
    gap: 12,
  },
  openEndedHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  openEndedInput: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: c.text,
    borderWidth: 2,
    borderColor: c.border,
    minHeight: 180,
  },
  openEndedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordCount: {
    fontSize: 12,
    color: c.textTertiary,
  },
  keywordsHint: {
    fontSize: 11,
    color: '#6366f1',
    fontStyle: 'italic',
    flex: 1,
    textAlign: 'right',
  },
  
  // Navigation styles
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: c.card,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  navButtonTextDisabled: {
    fontSize: 16,
    fontWeight: '500',
  },
  questionDots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.backgroundSecondary,
  },
  dotAnswered: {
    backgroundColor: c.success,
  },
  dotCurrent: {
    backgroundColor: '#6366f1',
    width: 12,
  },
  dotRevealed: {
    backgroundColor: '#f59e0b',
  },
  dotFlagged: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  flagRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: c.card,
  },
  flagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  flagButtonActive: {
    backgroundColor: '#eab30820',
  },
  flagButtonText: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  flagButtonTextActive: {
    color: '#eab308',
  },
  reviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
  },
  reviewModal: {
    backgroundColor: c.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  reviewTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewSubtitle: {
    color: c.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  reviewGridScroll: {
    maxHeight: 280,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 8,
  },
  reviewCell: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: c.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCellAnswered: {
    backgroundColor: '#10b98130',
    borderWidth: 1,
    borderColor: c.success,
  },
  reviewCellFlagged: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  reviewCellText: {
    color: c.text,
    fontWeight: '600',
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  reviewCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: c.backgroundSecondary,
    alignItems: 'center',
  },
  reviewCancelText: {
    color: c.text,
    fontWeight: '600',
  },
  reviewSubmitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  reviewSubmitText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  
  // Study Mode styles
  headerStudy: {
    borderBottomColor: '#10b98140',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#10b98120',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  studyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.success,
  },
  studyProgress: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  studyProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
  },
  progressBarStudy: {
    backgroundColor: '#10b98130',
  },
  progressFillStudy: {
    backgroundColor: c.success,
  },
  navigationStudy: {
    borderTopColor: '#10b98140',
  },
  feedbackContainer: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  feedbackCorrect: {
    backgroundColor: '#10b98115',
    borderColor: c.success,
  },
  feedbackIncorrect: {
    backgroundColor: '#ef444415',
    borderColor: c.error,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  feedbackTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  feedbackTitleCorrect: {
    color: c.success,
  },
  feedbackTitleIncorrect: {
    color: c.error,
  },
  feedbackExplanation: {
    fontSize: 14,
    color: c.textSecondary,
    lineHeight: 22,
  },
  correctAnswerBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: c.card,
    borderRadius: 8,
  },
  correctAnswerLabel: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 4,
  },
  correctAnswerText: {
    fontSize: 15,
    color: c.success,
    fontWeight: '600',
  },
  checkAnswerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    padding: 16,
    backgroundColor: c.success,
    borderRadius: 12,
  },
  checkAnswerText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
  },
  finishStudyButton: {
    backgroundColor: '#10b98120',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  finishStudyText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.success,
  },
  
  // Error styles
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: c.textSecondary,
    marginBottom: 16,
  },
  errorLink: {
    fontSize: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
});
