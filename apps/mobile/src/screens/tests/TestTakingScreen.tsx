// ===========================================
// Lantern Study Mobile - Enhanced Test Taking Screen
// Supports all 7 question types + Test/Study modes
// ===========================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTestStore, TestQuestion, QuestionType, MatchingPair, TestMode } from '../../stores/testStore';
import { useTheme } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TestTakingRouteParams = {
  TestTaking: {
    testId: string;
    testName: string;
    mode?: TestMode;
  };
};

// ============================================
// Question Type Components
// ============================================

// Multiple Choice Single Answer
const MCQSingleComponent = ({ 
  question, 
  selectedAnswer, 
  onAnswer 
}: { 
  question: TestQuestion; 
  selectedAnswer?: string; 
  onAnswer: (answer: string) => void;
}) => (
  <View style={styles.optionsContainer}>
    {question.options?.map((option, index) => (
      <TouchableOpacity
        key={index}
        style={[
          styles.optionButton,
          selectedAnswer === option && styles.optionSelected
        ]}
        onPress={() => onAnswer(option)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.optionRadio,
          selectedAnswer === option && styles.optionRadioSelected
        ]}>
          {selectedAnswer === option && <View style={styles.optionRadioInner} />}
        </View>
        <Text style={[
          styles.optionText,
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
  onAnswer 
}: { 
  question: TestQuestion; 
  selectedAnswers?: string[]; 
  onAnswer: (answers: string[]) => void;
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
      <Text style={styles.multiSelectHint}>Select all that apply</Text>
      {question.options?.map((option, index) => {
        const isSelected = selectedAnswers?.includes(option);
        return (
          <TouchableOpacity
            key={index}
            style={[
              styles.optionButton,
              isSelected && styles.optionSelected
            ]}
            onPress={() => toggleOption(option)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.optionCheckbox,
              isSelected && styles.optionCheckboxSelected
            ]}>
              {isSelected && <Ionicons name="checkmark" size={16} color="#ffffff" />}
            </View>
            <Text style={[
              styles.optionText,
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
  question, 
  selectedAnswer, 
  onAnswer 
}: { 
  question: TestQuestion; 
  selectedAnswer?: string; 
  onAnswer: (answer: string) => void;
}) => (
  <View style={styles.trueFalseContainer}>
    <TouchableOpacity
      style={[
        styles.trueFalseButton,
        styles.trueButton,
        selectedAnswer === 'True' && styles.trueFalseSelected,
        selectedAnswer === 'True' && styles.trueButtonSelected,
      ]}
      onPress={() => onAnswer('True')}
    >
      <Ionicons 
        name="checkmark-circle" 
        size={32} 
        color={selectedAnswer === 'True' ? '#ffffff' : '#10b981'} 
      />
      <Text style={[
        styles.trueFalseText,
        selectedAnswer === 'True' && styles.trueFalseTextSelected
      ]}>
        True
      </Text>
    </TouchableOpacity>
    
    <TouchableOpacity
      style={[
        styles.trueFalseButton,
        styles.falseButton,
        selectedAnswer === 'False' && styles.trueFalseSelected,
        selectedAnswer === 'False' && styles.falseButtonSelected,
      ]}
      onPress={() => onAnswer('False')}
    >
      <Ionicons 
        name="close-circle" 
        size={32} 
        color={selectedAnswer === 'False' ? '#ffffff' : '#ef4444'} 
      />
      <Text style={[
        styles.trueFalseText,
        selectedAnswer === 'False' && styles.trueFalseTextSelected
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
  onAnswer 
}: { 
  question: TestQuestion; 
  labels?: Record<string, string>; 
  onAnswer: (labels: Record<string, string>) => void;
}) => {
  const handleLabelChange = (id: string, value: string) => {
    onAnswer({ ...(labels || {}), [id]: value });
  };

  return (
    <View style={styles.diagramContainer}>
      {/* Placeholder for diagram image */}
      <View style={styles.diagramImagePlaceholder}>
        {question.diagramUrl ? (
          <Image 
            source={{ uri: question.diagramUrl }} 
            style={styles.diagramImage}
            resizeMode="contain"
          />
        ) : (
          <>
            <Ionicons name="image-outline" size={48} color="#64748b" />
            <Text style={styles.diagramPlaceholderText}>Diagram will appear here</Text>
          </>
        )}
      </View>
      
      <Text style={styles.diagramHint}>Label each part:</Text>
      
      <View style={styles.labelInputsContainer}>
        {question.diagramLabels?.map((label, index) => (
          <View key={label.id} style={styles.labelInputRow}>
            <View style={styles.labelNumber}>
              <Text style={styles.labelNumberText}>{index + 1}</Text>
            </View>
            <TextInput
              style={styles.labelInput}
              value={labels?.[label.id] || ''}
              onChangeText={(value) => handleLabelChange(label.id, value)}
              placeholder={`Label for point ${index + 1}...`}
              placeholderTextColor="#64748b"
            />
          </View>
        ))}
      </View>
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
  const { testName } = route.params;

  const {
    activeTest,
    answerQuestion,
    revealAnswer,
    checkCurrentAnswer,
    nextQuestion,
    previousQuestion,
    submitTest,
    exitStudyMode,
  } = useTestStore();

  const [timeRemaining, setTimeRemaining] = useState(activeTest?.timeRemaining || 0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);

  // Get mode from active test
  const isStudyMode = activeTest?.mode === 'study';

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
  }, [activeTest?.currentQuestionIndex]);

  const currentQuestion = useMemo(() => {
    if (!activeTest) return null;
    return activeTest.questions[activeTest.currentQuestionIndex];
  }, [activeTest]);

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
    answerQuestion(currentQuestion.id, answer);
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

  const handleSubmit = useCallback(async (timeUp = false) => {
    if (!activeTest) return;

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

    const unanswered = activeTest.questions.length - answeredCount;

    if (unanswered > 0 && !timeUp) {
      Alert.alert(
        'Unanswered Questions',
        `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Are you sure you want to submit?`,
        [
          { text: 'Continue Test', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: async () => {
            const attempt = await submitTest();
            navigation.replace('TestResults', { attemptId: attempt.id });
          }},
        ]
      );
    } else {
      if (timeUp) {
        Alert.alert('Time\'s Up!', 'Your test has been submitted automatically.');
      }
      const attempt = await submitTest();
      navigation.replace('TestResults', { attemptId: attempt.id });
    }
  }, [activeTest, answeredCount, submitTest, exitStudyMode, navigation]);

  const handleExit = useCallback(() => {
    if (isStudyMode) {
      Alert.alert(
        'Exit Study Mode',
        'Are you sure you want to exit? You can come back anytime.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', onPress: () => {
            exitStudyMode();
            navigation.goBack();
          }},
        ]
      );
    } else {
      Alert.alert(
        'Exit Test',
        'Are you sure you want to exit? Your progress will be lost.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
    }
  }, [navigation, isStudyMode, exitStudyMode]);

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
          />
        );
      
      case 'multiple_choice_multiple':
        return (
          <MCQMultipleComponent
            question={currentQuestion}
            selectedAnswers={answer as string[]}
            onAnswer={handleAnswer}
          />
        );
      
      case 'true_false':
        return (
          <TrueFalseComponent
            question={currentQuestion}
            selectedAnswer={answer as string}
            onAnswer={handleAnswer}
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
      <SafeAreaView style={[styles.container, { backgroundColor: '#0f172a' }]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Test not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.errorLink}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isStudyMode && styles.headerStudy]}>
        <TouchableOpacity onPress={handleExit} style={styles.exitButton}>
          <Ionicons name="close" size={24} color="#ffffff" />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.testName} numberOfLines={1}>{testName}</Text>
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

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, isStudyMode && styles.progressBarStudy]}>
          <View style={[
            styles.progressFill, 
            { width: `${progress * 100}%` },
            isStudyMode && styles.progressFillStudy
          ]} />
        </View>
        <Text style={styles.progressText}>
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
        <View style={styles.questionCard}>
          <View style={styles.questionHeader}>
            <View style={styles.questionTypeBadge}>
              <Text style={styles.questionTypeText}>
                {getQuestionTypeLabel(currentQuestion.type)}
              </Text>
            </View>
            <Text style={styles.pointsText}>{currentQuestion.points} pts</Text>
          </View>
          
          <Text style={styles.questionText}>{currentQuestion.question}</Text>
          
          {currentQuestion.tags && currentQuestion.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {currentQuestion.tags.map((tag, i) => (
                <View key={i} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
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
            {!feedbackResult.isCorrect && currentQuestion.correctAnswer && (
              <View style={styles.correctAnswerBox}>
                <Text style={styles.correctAnswerLabel}>Correct answer:</Text>
                <Text style={styles.correctAnswerText}>{currentQuestion.correctAnswer}</Text>
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
      <View style={[styles.navigation, isStudyMode && styles.navigationStudy]}>
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
            color={activeTest.currentQuestionIndex === 0 ? '#4b5563' : '#ffffff'} 
          />
          <Text style={[
            styles.navButtonText,
            activeTest.currentQuestionIndex === 0 && styles.navButtonTextDisabled
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
            
            return (
              <View
                key={q.id}
                style={[
                  styles.dot,
                  isAnswered && styles.dotAnswered,
                  isCurrent && styles.dotCurrent,
                  isStudyMode && isRevealed && styles.dotRevealed,
                ]}
              />
            );
          })}
        </View>

        {/* Next/Finish button */}
        {activeTest.currentQuestionIndex === activeTest.questions.length - 1 ? (
          isStudyMode ? (
            <TouchableOpacity
              style={[styles.navButton, styles.finishStudyButton]}
              onPress={() => handleSubmit()}
            >
              <Text style={styles.finishStudyText}>Finish</Text>
              <Ionicons name="checkmark" size={24} color="#10b981" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.navButton, styles.navButtonDisabled]}
              disabled
            >
              <Text style={styles.navButtonTextDisabled}>Next</Text>
              <Ionicons name="chevron-forward" size={24} color="#4b5563" />
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            style={styles.navButton}
            onPress={nextQuestion}
          >
            <Text style={styles.navButtonText}>Next</Text>
            <Ionicons name="chevron-forward" size={24} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
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
    color: '#e2e8f0',
    marginTop: 8,
  },
  trueFalseTextSelected: {
    color: '#ffffff',
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
  diagramImagePlaceholder: {
    backgroundColor: '#1e293b',
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
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelNumberText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  labelInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
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
    paddingVertical: 16,
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
    fontWeight: '500',
    color: '#ffffff',
  },
  navButtonTextDisabled: {
    color: '#4b5563',
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
