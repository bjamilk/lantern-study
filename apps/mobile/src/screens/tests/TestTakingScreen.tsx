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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
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
  <View style={styles.optionsContainer}>
    {question.options?.map((option, index) => (
      <TouchableOpacity
        key={index}
        style={[
          styles.optionButton,
          { backgroundColor: colors.inputBackground, borderColor: colors.border },
          selectedAnswer === option && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
        onPress={() => onAnswer(option)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.optionRadio,
          { borderColor: colors.border },
          selectedAnswer === option && styles.optionRadioSelected
        ]}>
          {selectedAnswer === option && <View style={styles.optionRadioInner} />}
        </View>
        <Text style={[
          styles.optionText,
          { color: colors.text },
          selectedAnswer === option && styles.optionTextSelected
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
    <View style={styles.optionsContainer}>
      <Text style={[styles.multiSelectHint, { color: colors.textSecondary }]}>Select all that apply</Text>
      {question.options?.map((option, index) => {
        const isSelected = selectedAnswers?.includes(option);
        return (
          <TouchableOpacity
            key={index}
            style={[
              styles.optionButton,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
              isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => toggleOption(option)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.optionCheckbox,
              { borderColor: colors.border },
              isSelected && styles.optionCheckboxSelected
            ]}>
              {isSelected && <Ionicons name="checkmark" size={16} color="#ffffff" />}
            </View>
            <Text style={[
              styles.optionText,
              { color: colors.text },
              isSelected && styles.optionTextSelected
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
  <View style={styles.trueFalseContainer}>
    <TouchableOpacity
      style={[
        styles.trueFalseButton,
        {
          backgroundColor: selectedAnswer === 'True' ? colors.success : colors.successBackground,
          borderColor: colors.success,
        },
        selectedAnswer === 'True' && styles.trueFalseSelected,
      ]}
      onPress={() => onAnswer('True')}
    >
      <Ionicons 
        name="checkmark-circle" 
        size={32} 
        color={selectedAnswer === 'True' ? colors.textInverse : colors.success} 
      />
      <Text style={[
        styles.trueFalseText,
        { color: selectedAnswer === 'True' ? colors.textInverse : colors.text },
      ]}>
        True
      </Text>
    </TouchableOpacity>
    
    <TouchableOpacity
      style={[
        styles.trueFalseButton,
        {
          backgroundColor: selectedAnswer === 'False' ? colors.error : colors.errorBackground,
          borderColor: colors.error,
        },
        selectedAnswer === 'False' && styles.trueFalseSelected,
      ]}
      onPress={() => onAnswer('False')}
    >
      <Ionicons 
        name="close-circle" 
        size={32} 
        color={selectedAnswer === 'False' ? colors.textInverse : colors.error} 
      />
      <Text style={[
        styles.trueFalseText,
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
  onAnswer 
}: { 
  question: TestQuestion; 
  answer?: string; 
  onAnswer: (answer: string) => void;
}) => (
  <View style={styles.fillBlankContainer}>
    <Text style={styles.fillBlankHint}>Type your answer below:</Text>
    <TextInput
      style={styles.fillBlankInput}
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
  onAnswer 
}: { 
  question: TestQuestion; 
  matches?: Record<string, string>; 
  onAnswer: (matches: Record<string, string>) => void;
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
    <View style={styles.matchingContainer}>
      <Text style={styles.matchingHint}>
        {selectedLeft ? `Now select a match for "${selectedLeft}"` : 'Tap an item on the left, then its match on the right'}
      </Text>
      
      <View style={styles.matchingColumns}>
        {/* Left Column */}
        <View style={styles.matchingColumn}>
          <Text style={styles.matchingColumnTitle}>Items</Text>
          {pairs.map((pair) => {
            const matched = getMatchedRight(pair.left);
            return (
              <TouchableOpacity
                key={pair.id}
                style={[
                  styles.matchingItem,
                  selectedLeft === pair.left && styles.matchingItemSelected,
                  matched && styles.matchingItemMatched,
                ]}
                onPress={() => handleLeftSelect(pair.left)}
              >
                <Text style={styles.matchingItemText}>{pair.left}</Text>
                {matched && (
                  <View style={styles.matchBadge}>
                    <Ionicons name="link" size={14} color="#10b981" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        
        {/* Right Column */}
        <View style={styles.matchingColumn}>
          <Text style={styles.matchingColumnTitle}>Matches</Text>
          {rightOptions.map((right, index) => {
            const isUsed = isRightUsed(right);
            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.matchingItem,
                  isUsed && styles.matchingItemUsed,
                  !selectedLeft && styles.matchingItemDisabled,
                ]}
                onPress={() => handleRightSelect(right)}
                disabled={!selectedLeft}
              >
                <Text style={[
                  styles.matchingItemText,
                  isUsed && styles.matchingItemTextUsed,
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
          style={styles.clearMatchesButton}
          onPress={() => onAnswer({})}
        >
          <Ionicons name="refresh" size={16} color="#f59e0b" />
          <Text style={styles.clearMatchesText}>Clear all matches</Text>
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
}: {
  question: TestQuestion;
  labels?: Record<string, string>;
  onAnswer: (labels: Record<string, string>) => void;
}) => {
  const shuffledOptions = useMemo(
    () => shuffleArray(question.diagramLabels || []),
    [question.id, question.diagramLabels]
  );
  const [pickerLabelId, setPickerLabelId] = useState<string | null>(null);
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
    <View style={styles.diagramContainer}>
      <View style={styles.diagramImageWrapper}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.diagramImage} resizeMode="contain" />
        ) : (
          <View style={styles.diagramImagePlaceholder}>
            <Ionicons name="image-outline" size={48} color="#64748b" />
            <Text style={styles.diagramPlaceholderText}>
              {imagePending ? 'Loading diagram…' : 'Diagram will appear here'}
            </Text>
          </View>
        )}
        {imageUri
          ? question.diagramLabels?.map((label, index) => (
              <View
                key={label.id}
                style={[
                  styles.diagramMarker,
                  { left: `${label.x}%`, top: `${label.y}%` },
                ]}
              >
                <Text style={styles.diagramMarkerText}>{index + 1}</Text>
              </View>
            ))
          : null}
      </View>

      <Text style={styles.diagramHint}>Match each numbered point to the correct label:</Text>

      <View style={styles.labelInputsContainer}>
        {question.diagramLabels?.map((label, index) => (
          <View key={label.id} style={styles.labelInputRow}>
            <View style={styles.labelNumber}>
              <Text style={styles.labelNumberText}>{index + 1}</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.labelPicker,
                labels?.[label.id] ? styles.labelPickerSelected : null,
              ]}
              onPress={() => setPickerLabelId(label.id)}
            >
              <Text
                style={[
                  styles.labelPickerText,
                  !labels?.[label.id] ? styles.labelPickerPlaceholder : null,
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
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerLabelId(null)}>
          <Pressable style={styles.pickerSheet} onPress={e => e.stopPropagation?.()}>
            <Text style={styles.pickerTitle}>Select label</Text>
            <ScrollView
              style={styles.pickerScroll}
              contentContainerStyle={styles.pickerScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {shuffledOptions.map((opt: DiagramLabel) => (
                <TouchableOpacity
                  key={opt.id}
                  style={styles.pickerOption}
                  onPress={() => pickerLabelId && handleSelect(pickerLabelId, opt.id)}
                >
                  <Text style={styles.pickerOptionText}>
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
  onAnswer 
}: { 
  question: TestQuestion; 
  answer?: string; 
  onAnswer: (answer: string) => void;
}) => {
  const wordCount = answer ? answer.trim().split(/\s+/).filter(w => w).length : 0;

  return (
    <View style={styles.openEndedContainer}>
      <Text style={styles.openEndedHint}>
        Write your answer in detail. Include relevant examples where applicable.
      </Text>
      <TextInput
        style={styles.openEndedInput}
        value={answer || ''}
        onChangeText={onAnswer}
        placeholder="Type your answer here..."
        placeholderTextColor="#64748b"
        multiline
        textAlignVertical="top"
      />
      <View style={styles.openEndedFooter}>
        <Text style={styles.wordCount}>{wordCount} words</Text>
        {question.keywords && (
          <Text style={styles.keywordsHint}>
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
  const { testName, isOffline, groupName, groupId } = route.params;

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
  } = useTestStore();

  const { showExplanationsImmediately } = useStudySettings();
  const [timeRemaining, setTimeRemaining] = useState(activeTest?.timeRemaining || 0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const questionViewStartTimeRef = useRef<number | null>(null);

  // Get mode from active test
  const isStudyMode = activeTest?.mode === 'study';

  useConfirmBeforeExit(!!activeTest && !isSubmitting, {
    title: isStudyMode ? 'Exit Study Mode' : 'Exit Test',
    message: isStudyMode
      ? 'Are you sure you want to exit? You can come back anytime.'
      : 'Are you sure you want to exit? Your progress will be lost.',
    confirmLabel: 'Exit',
    destructive: !isStudyMode,
    onConfirm: isStudyMode ? exitStudyMode : undefined,
  });

  // Timer effect - only for test mode
  useEffect(() => {
    if (!activeTest || activeTest.mode === 'study' || activeTest.test.timeLimit === 0) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeTest?.test.timeLimit, activeTest?.mode]);

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
    if (!activeTest || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const attempt = await submitTest(userId, {
        isOffline: !!isOffline,
        groupName: groupName || activeTest.test.name,
        groupId,
      });
      setShowReviewModal(false);
      navigation.replace('TestResults', { attemptId: attempt.id });
    } catch {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [activeTest, submitTest, userId, isOffline, groupName, groupId, navigation]);

  const handleSubmit = useCallback(async (timeUp = false) => {
    if (!activeTest) return;
    hapticSuccess();

    // Study mode doesn't need submission
    if (activeTest.mode === 'study') {
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
  }, [activeTest, finalizeSubmit, exitStudyMode, navigation]);

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
          />
        );
      
      case 'matching':
        return (
          <MatchingComponent
            question={currentQuestion}
            matches={answer as Record<string, string>}
            onAnswer={handleAnswer}
          />
        );
      
      case 'diagram_labeling':
        return (
          <DiagramLabelingComponent
            question={currentQuestion}
            labels={answer as Record<string, string>}
            onAnswer={handleAnswer}
          />
        );
      
      case 'open_ended':
        return (
          <OpenEndedComponent
            question={currentQuestion}
            answer={answer as string}
            onAnswer={handleAnswer}
          />
        );
      
      default:
        return (
          <Text style={styles.errorText}>Unknown question type</Text>
        );
    }
  };

  if (!activeTest || !currentQuestion) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Test not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={[styles.errorLink, { color: colors.primary }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }, isStudyMode && styles.headerStudy]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.exitButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.testName, { color: colors.text }]} numberOfLines={1}>{testName}</Text>
            {isStudyMode && (
              <View style={styles.studyBadge}>
                <Ionicons name="book" size={12} color="#10b981" />
                <Text style={styles.studyBadgeText}>Study</Text>
              </View>
            )}
          </View>
          {!isStudyMode && activeTest.test.timeLimit > 0 && (
            <View style={[
              styles.timerBadge,
              timeRemaining < 60 && styles.timerWarning
            ]}>
              <Ionicons name="time" size={14} color={timeRemaining < 60 ? '#ef4444' : '#ffffff'} />
              <Text style={[
                styles.timerText,
                timeRemaining < 60 && styles.timerTextWarning
              ]}>
                {formatTime(timeRemaining)}
              </Text>
            </View>
          )}
        </View>
        
        {!isStudyMode ? (
          <TouchableOpacity onPress={() => handleSubmit()} style={styles.submitButton}>
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.studyProgress}>
            <Text style={styles.studyProgressText}>{answeredCount}/{activeTest.questions.length}</Text>
          </View>
        )}
      </View>

      {!isStudyMode && currentQuestion && (
        <View style={styles.flagRow}>
          <TouchableOpacity
            style={[styles.flagButton, isCurrentFlagged && styles.flagButtonActive]}
            onPress={() => toggleFlag(currentQuestion.id)}
          >
            <Ionicons
              name={isCurrentFlagged ? 'flag' : 'flag-outline'}
              size={18}
              color={isCurrentFlagged ? '#f97316' : '#94a3b8'}
            />
            <Text style={[styles.flagButtonText, isCurrentFlagged && styles.flagButtonTextActive]}>
              {isCurrentFlagged ? 'Flagged' : 'Flag for review'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: colors.border }, isStudyMode && styles.progressBarStudy]}>
          <View style={[
            styles.progressFill, 
            { width: `${progress * 100}%` },
            isStudyMode && styles.progressFillStudy
          ]} />
        </View>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>
          {activeTest.currentQuestionIndex + 1} / {activeTest.questions.length}
        </Text>
      </View>

      {/* Question */}
      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.questionCard, { backgroundColor: colors.card }]}>
          <View style={styles.questionHeader}>
            <View style={[styles.questionTypeBadge, { backgroundColor: colors.primaryBackground }]}>
              <Text style={[styles.questionTypeText, { color: colors.primary }]}>
                {getQuestionTypeLabel(currentQuestion.type)}
              </Text>
            </View>
            <Text style={[styles.pointsText, { color: colors.textSecondary }]}>{currentQuestion.points} pts</Text>
          </View>
          
          <Text style={[styles.questionText, { color: colors.text }]}>{currentQuestion.question}</Text>

          {resolvedQuestionImage ? (
            <View style={styles.questionImageWrapper}>
              <Image
                source={{ uri: resolvedQuestionImage }}
                style={styles.questionImage}
                resizeMode="contain"
              />
            </View>
          ) : null}
          
          {currentQuestion.tags && currentQuestion.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {currentQuestion.tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.inputBackground }]}>
                  <Text style={[styles.tagText, { color: colors.textSecondary }]}>{tag}</Text>
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
            styles.feedbackContainer,
            feedbackResult.isCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect
          ]}>
            <View style={styles.feedbackHeader}>
              <Ionicons 
                name={feedbackResult.isCorrect ? 'checkmark-circle' : 'close-circle'} 
                size={28} 
                color={feedbackResult.isCorrect ? '#10b981' : '#ef4444'} 
              />
              <Text style={[
                styles.feedbackTitle,
                feedbackResult.isCorrect ? styles.feedbackTitleCorrect : styles.feedbackTitleIncorrect
              ]}>
                {feedbackResult.isCorrect ? 'Correct!' : 'Incorrect'}
              </Text>
            </View>
            {feedbackResult.explanation && (
              <Text style={styles.feedbackExplanation}>{feedbackResult.explanation}</Text>
            )}
            {!feedbackResult.isCorrect && (
              <View style={styles.correctAnswerBox}>
                <Text style={styles.correctAnswerLabel}>Correct answer:</Text>
                <Text style={styles.correctAnswerText}>
                  {formatCorrectAnswerDisplay(currentQuestion)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Study Mode Check Answer Button */}
        {isStudyMode && hasAnsweredCurrent && !isAnswerRevealed && (
          <TouchableOpacity
            style={styles.checkAnswerButton}
            onPress={handleCheckAnswer}
            activeOpacity={0.8}
          >
            <Ionicons name="eye" size={20} color="#ffffff" />
            <Text style={styles.checkAnswerText}>Check Answer</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Navigation */}
      <View
        style={[
          styles.navigation,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          },
          isStudyMode && styles.navigationStudy,
        ]}
      >
        <TouchableOpacity
          style={[
            styles.navButton,
            activeTest.currentQuestionIndex === 0 && styles.navButtonDisabled
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
            styles.navButtonText,
            { color: colors.text },
            activeTest.currentQuestionIndex === 0 && { color: colors.textTertiary },
          ]}>
            Previous
          </Text>
        </TouchableOpacity>

        <View style={styles.questionDots}>
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
                    styles.dot,
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
              style={[styles.navButton, styles.finishStudyButton, { backgroundColor: colors.successBackground }]}
              onPress={() => handleSubmit()}
            >
              <Text style={[styles.finishStudyText, { color: colors.success }]}>Finish</Text>
              <Ionicons name="checkmark" size={24} color={colors.success} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.navButton, styles.navButtonDisabled]}
              disabled
            >
              <Text style={[styles.navButtonTextDisabled, { color: colors.textTertiary }]}>Next</Text>
              <Ionicons name="chevron-forward" size={24} color={colors.textTertiary} />
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            style={styles.navButton}
            onPress={nextQuestion}
          >
            <Text style={[styles.navButtonText, { color: colors.primary }]}>Next</Text>
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
        <View style={styles.reviewOverlay}>
          <View style={[styles.reviewModal, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <Text style={styles.reviewTitle}>Review & Submit</Text>
            <Text style={styles.reviewSubtitle}>
              {answeredCount} answered · {activeTest.questions.length - answeredCount} skipped · {flaggedCount} flagged
            </Text>

            <ScrollView style={styles.reviewGridScroll} contentContainerStyle={styles.reviewGrid}>
              {activeTest.questions.map((q, index) => {
                const isAnswered = !!activeTest.answers[q.id];
                const isFlagged = activeTest.flaggedQuestions.has(q.id);
                return (
                  <TouchableOpacity
                    key={q.id}
                    style={[
                      styles.reviewCell,
                      isAnswered && styles.reviewCellAnswered,
                      isFlagged && styles.reviewCellFlagged,
                    ]}
                    onPress={() => {
                      setShowReviewModal(false);
                      goToQuestion(index);
                    }}
                  >
                    <Text style={styles.reviewCellText}>{index + 1}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.reviewActions}>
              <TouchableOpacity
                style={styles.reviewCancelButton}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={styles.reviewCancelText}>Continue Test</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reviewSubmitButton, isSubmitting && { opacity: 0.6 }]}
                disabled={isSubmitting}
                onPress={() => void finalizeSubmit()}
              >
                <Text style={styles.reviewSubmitText}>{isSubmitting ? 'Submitting...' : 'Submit Test'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
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
    color: '#ffffff',
    marginBottom: 4,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#334155',
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
    color: '#ffffff',
  },
  timerTextWarning: {
    color: '#ef4444',
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
    backgroundColor: '#334155',
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
    color: '#9ca3af',
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
    backgroundColor: '#1e293b',
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
    color: '#9ca3af',
  },
  questionText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#ffffff',
    lineHeight: 28,
  },
  questionImageWrapper: {
    marginTop: 16,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
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
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  
  // MCQ Single styles
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
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
    color: '#e2e8f0',
  },
  optionTextSelected: {
    color: '#ffffff',
    fontWeight: '500',
  },
  
  // MCQ Multiple styles
  multiSelectHint: {
    fontSize: 14,
    color: '#9ca3af',
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
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  falseButtonSelected: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
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
    color: '#9ca3af',
  },
  fillBlankInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: '#334155',
  },
  
  // Matching styles
  matchingContainer: {
    gap: 16,
  },
  matchingHint: {
    fontSize: 14,
    color: '#9ca3af',
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
    backgroundColor: '#1e293b',
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
    borderColor: '#10b981',
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
    color: '#e2e8f0',
    flex: 1,
  },
  matchingItemTextUsed: {
    color: '#10b981',
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
    backgroundColor: '#1e293b',
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 200,
  },
  diagramImagePlaceholder: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagramImage: {
    width: '100%',
    minHeight: 160,
    maxHeight: 360,
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
  },
  diagramMarkerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  diagramPlaceholderText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
  },
  diagramHint: {
    fontSize: 14,
    color: '#9ca3af',
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
    color: '#ffffff',
  },
  labelPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  labelPickerSelected: {
    borderColor: '#6366f1',
  },
  labelPickerText: {
    flex: 1,
    fontSize: 14,
    color: '#ffffff',
    marginRight: 8,
  },
  labelPickerPlaceholder: {
    color: '#64748b',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#1e293b',
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
    color: '#ffffff',
    marginBottom: 12,
  },
  pickerOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  pickerOptionText: {
    fontSize: 15,
    color: '#e2e8f0',
  },
  
  // Open Ended styles
  openEndedContainer: {
    gap: 12,
  },
  openEndedHint: {
    fontSize: 14,
    color: '#9ca3af',
  },
  openEndedInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: '#334155',
    minHeight: 180,
  },
  openEndedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordCount: {
    fontSize: 12,
    color: '#64748b',
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
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
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
    backgroundColor: '#334155',
  },
  dotAnswered: {
    backgroundColor: '#10b981',
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
    backgroundColor: '#1e293b',
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
    backgroundColor: '#f9731620',
  },
  flagButtonText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  flagButtonTextActive: {
    color: '#f97316',
  },
  reviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
  },
  reviewModal: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  reviewTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewSubtitle: {
    color: '#94a3b8',
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
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCellAnswered: {
    backgroundColor: '#10b98130',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  reviewCellFlagged: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  reviewCellText: {
    color: '#ffffff',
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
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  reviewCancelText: {
    color: '#ffffff',
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
    color: '#10b981',
  },
  studyProgress: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  studyProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  progressBarStudy: {
    backgroundColor: '#10b98130',
  },
  progressFillStudy: {
    backgroundColor: '#10b981',
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
    borderColor: '#10b981',
  },
  feedbackIncorrect: {
    backgroundColor: '#ef444415',
    borderColor: '#ef4444',
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
    color: '#10b981',
  },
  feedbackTitleIncorrect: {
    color: '#ef4444',
  },
  feedbackExplanation: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 22,
  },
  correctAnswerBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#1e293b',
    borderRadius: 8,
  },
  correctAnswerLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  correctAnswerText: {
    fontSize: 15,
    color: '#10b981',
    fontWeight: '600',
  },
  checkAnswerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    padding: 16,
    backgroundColor: '#10b981',
    borderRadius: 12,
  },
  checkAnswerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
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
    color: '#10b981',
  },
  
  // Error styles
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#9ca3af',
    marginBottom: 16,
  },
  errorLink: {
    fontSize: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
});
