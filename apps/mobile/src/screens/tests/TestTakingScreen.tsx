// ===========================================
// Lantern Study Mobile - Enhanced Test Taking Screen
// Supports all 7 question types + Test/Study modes
// ===========================================
/**
 * The `TestTaking` route (a fullScreenModal): sitting one session. Renders all
 * seven question types, runs the countdown, collects confidence on practice
 * attempts, enforces the exam lock, and hands off to TestResults on submit.
 *
 * Main exports: the default `TestTakingScreen`. The per-type input components
 * (MCQ single/multiple, true-false, fill-in-blank, matching, diagram labeling,
 * open ended) are module-local.
 * Touches: testStore (the whole session — `answerQuestion`, `revealAnswer`,
 * `goToQuestion`, `submitTest`, `exitStudyMode`, `updateTimeRemaining`),
 * authStore, settingsStore (`showExplanationsImmediately`), the presence
 * heartbeat's study intent, and `pendingQuestionBankScores` for marketplace
 * bundles. Native: RN AppState/BackHandler and expo-haptics via utils/haptics.
 *
 * Gotchas: exam lock is `!isStudyMode && activeTest.lockAnswered === true` —
 * `lockAnswered` is tri-state and must stay `undefined` where no toggle exists,
 * because an explicit `false` would override a global lock-on. `lockedQuestionIds`
 * is derived by the store on resume rather than persisted, so `goToQuestion`
 * must remain the single navigation choke point. Confidence lives in screen
 * state, not the store, and rides to the results screen as a route param; it is
 * collected on practice attempts only (untimed), and changing an answer before
 * the reveal retracts it. Leaving is never a plain `goBack()` — `planTestExit`
 * decides pop vs reset, and with a `returnTo` the tab switch is deferred until
 * the exit confirmation resolves. The timer only ticks while focused and with
 * the app active, so it cannot auto-submit a zero behind the reader's back.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  TextInput,
  Image,
  Modal,
  Pressable,
  AppState,
  BackHandler,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { Screen, useScreenInsets, useScreenBottomPadding } from '../../components/layout';
import { useRoute, useNavigation, RouteProp, useIsFocused } from '@react-navigation/native';
import { useTestStore, TestQuestion, QuestionType, MatchingPair, TestMode, DiagramLabel } from '../../stores/testStore';
import { type ThemeColors, useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { useStudySettings } from '../../stores/settingsStore';
import { shuffleArray, nearestPreviousUnlockedIndex } from '@lantern/shared/utils';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { hapticSuccess } from '../../utils/haptics';
import { formatCorrectAnswerDisplay } from '../../utils/questionHelpers';
import { setStudyIntent } from '../../hooks/usePresenceHeartbeat';
import { AppIcon } from '../../components/ui/AppIcon';
import { T } from '../../components/ui';
import { TAB_STACK_ROOT_ROUTE } from '../../navigation/tabPressBehavior';
import { toTab } from '../../navigation/nestedTab';
import { planSessionExitCopy, planTestExit, type ReturnToTarget } from './testSessionExit';
import { isPracticeAttempt, type ConfidenceLevel } from './confidenceReveal';
import { useFeatureAccent } from '../../components/ui/FeatureDisc';
import { s } from './TestTakingScreen.styles';

/** Footer dots never exceed this; beyond it the window slides and counts. */
const MAX_QUESTION_DOTS = 10;

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
    /**
     * Set by a launcher outside the Study tab (a group chat thread's Test
     * mode). Exit — and the results screen this session hands off to — go
     * back there instead of leaving the reader on the Study hub.
     */
    returnTo?: ReturnToTarget;
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
          selectedAnswer === option && { backgroundColor: colors.primaryFill, borderColor: colors.primary },
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
              isSelected && { backgroundColor: colors.primaryFill, borderColor: colors.primary },
            ]}
            onPress={() => toggleOption(option)}
            activeOpacity={0.7}
          >
            <View style={[
              s(colors).optionCheckbox,
              { borderColor: colors.border },
              isSelected && s(colors).optionCheckboxSelected
            ]}>
              {isSelected && <AppIcon name="checkmark" size={16} color="#ffffff" />}
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
          // Neutral until the user actually picks it — an unanswered/skipped question
          // must not look pre-selected (green ✓ read as "answer chosen for me").
          backgroundColor: selectedAnswer === 'True' ? colors.success : colors.inputBackground,
          borderColor: selectedAnswer === 'True' ? colors.success : colors.border,
        },
        selectedAnswer === 'True' && s(colors).trueFalseSelected,
      ]}
      onPress={() => onAnswer('True')}
    >
      <AppIcon
        name="checkmark-circle"
        size={32}
        color={selectedAnswer === 'True' ? colors.textInverse : colors.textSecondary}
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
          backgroundColor: selectedAnswer === 'False' ? colors.error : colors.inputBackground,
          borderColor: selectedAnswer === 'False' ? colors.error : colors.border,
        },
        selectedAnswer === 'False' && s(colors).trueFalseSelected,
      ]}
      onPress={() => onAnswer('False')}
    >
      <AppIcon
        name="close-circle"
        size={32}
        color={selectedAnswer === 'False' ? colors.textInverse : colors.textSecondary}
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
                    <AppIcon name="link" size={14} color="#10b981" />
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
          <AppIcon name="refresh" size={16} color="#f59e0b" />
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
            <AppIcon name="image" size={48} color="#64748b" />
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
              <AppIcon name="chevron-down" size={16} color="#94a3b8" />
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
  // `presentation: 'fullScreenModal'` gives this route its own native window,
  // which the app-root provider never measures — the raw hook returned 0 on
  // every edge, so the close button, test name and countdown drew under the
  // status bar and the Prev/Next footer collapsed onto the gesture bar.
  const insets = useScreenInsets();
  /**
   * Clearance for the Prev / dots / Next footer.
   *
   * `'auto'` rather than the raw bottom inset: this route is registered
   * immersive, but when the shared chrome does not stand down (entering the
   * session from another tab, it stayed up) the absolutely-positioned tab bar
   * is drawn OVER this screen and buried the whole footer — no Next button,
   * no question dots, nothing to advance with. `'auto'` pays tab-bar clearance
   * exactly when the bar is really there, and collapses back to the plain
   * inset the moment it is not.
   */
  const navFooterPadding = useScreenBottomPadding({ bottom: 'auto', bottomExtra: 12 });
  const userId = useAuthStore(s => s.user?.id) || '';
  const { testName, isOffline, groupName, groupId, offlineTestId, returnTo } = route.params;

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

  useEffect(() => {
    setStudyIntent({
      context: 'testing',
      courseId: activeTest?.courseId || undefined,
      topic: testName || activeTest?.test.name || undefined,
    });
    return () => setStudyIntent(null);
  }, [activeTest?.courseId, testName, activeTest?.test.name]);
  const [timeRemaining, setTimeRemaining] = useState(activeTest?.timeRemaining || 0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  /**
   * What the reader committed to BEFORE seeing the answer, per question.
   *
   * Screen state, not store state: it is a property of this run, it is handed
   * to the results screen as a route param when the session is submitted, and
   * keeping it here means the confidence prompt cannot change how a session is
   * drafted, resumed or graded. A reader who never answers a question never
   * gets a key here, which is exactly what `classifyReviewOutcome` wants.
   */
  const [confidenceByQuestion, setConfidenceByQuestion] = useState<Record<string, ConfidenceLevel>>({});
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
  /**
   * Confidence-before-reveal, on PRACTICE attempts only (spec §9 #5).
   *
   * The clock is the whole test: an attempt with a time limit is an exam and
   * stays plain, so the JAMB/WAEC presets are untouched. Untimed test mode and
   * study mode are both quiz-style practice and both ask.
   */
  const isPractice = isPracticeAttempt({
    mode: activeTest?.mode,
    timeLimitMinutes: activeTest?.test.timeLimit,
  });
  const testsAccent = useFeatureAccent('tests');
  // Exam lock: once answered + advanced, a question can't be returned to.
  const lockMode = !isStudyMode && activeTest?.lockAnswered === true;
  // In lock mode, "Previous" jumps to the nearest earlier open (skipped) question.
  const prevTargetIndex = !activeTest
    ? -1
    : lockMode
      ? nearestPreviousUnlockedIndex(activeTest.questions.map((q) => q.id), activeTest.lockedQuestionIds, activeTest.currentQuestionIndex)
      : activeTest.currentQuestionIndex - 1;

  /**
   * Getting back to the tab this session was launched from.
   *
   * The parent (tab) navigator is captured BEFORE the Study stack is reset:
   * this screen unmounts on that reset, and `getParent()` on an unmounted
   * screen is not something to rely on — least of all from the deferred
   * branch below, which runs a tick after the reset has already happened.
   */
  const goToReturnTarget = useCallback(
    (target: ReturnToTarget, parent?: { navigate?: (name: string, params?: object) => void } | null) => {
      const tabNav = parent ?? navigation.getParent?.();
      tabNav?.navigate?.(target.tab, toTab(target.screen, target.params));
    },
    [navigation]
  );

  /**
   * A return target waiting on the "Exit Test?" confirmation.
   *
   * The guard below `preventDefault()`s the reset and re-dispatches it only if
   * the reader confirms, so the tab switch cannot be fired beside the reset —
   * cancelling would then leave them in the thread with the session still
   * running behind it. It is parked here and released by `onConfirm`.
   */
  const pendingReturnRef = useRef<{
    target: ReturnToTarget;
    parent?: { navigate?: (name: string, params?: object) => void } | null;
  } | null>(null);

  /** The exact condition the guard is armed under — read by dismissSession. */
  const exitGuardArmed = !!activeTest && !isSubmitting;
  const exitGuardArmedRef = useRef(exitGuardArmed);
  exitGuardArmedRef.current = exitGuardArmed;

  // The dialog states what leaving DOES — `onConfirm` runs `exitStudyMode`,
  // which abandons the draft — instead of the two sentences it shipped with,
  // one of which promised a practice sitting could be resumed and the other
  // of which read as a contradiction of Home's saved sessions.
  const exitCopy = planSessionExitCopy({
    mode: isStudyMode ? 'study' : 'test',
    answeredCount: activeTest ? Object.keys(activeTest.answers).length : 0,
    totalQuestions: activeTest?.questions.length ?? 0,
  });

  useConfirmBeforeExit(exitGuardArmed, {
    title: exitCopy.title,
    message: exitCopy.message,
    confirmLabel: exitCopy.confirmLabel,
    destructive: exitCopy.destructive,
    // Always abandon so the timer cannot keep running and auto-submit a zero.
    onConfirm: () => {
      exitStudyMode();
      const pending = pendingReturnRef.current;
      pendingReturnRef.current = null;
      if (!pending) return;
      // AFTER the guard's own dispatch, never before it: the hook re-dispatches
      // the reset the moment this callback returns, and the Study stack has to
      // shed this screen before the reader is put back in the thread.
      setTimeout(() => goToReturnTarget(pending.target, pending.parent), 0);
    },
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

  /**
   * The footer dots are a MAP of the test, so their count has to be the
   * question count. The old footer hard-sliced a five-wide window around the
   * current question, which drew three dots for a five-question test and told
   * the student the test was shorter than it is (device pass on build 159,
   * D9). Up to ten questions every question gets its dot; beyond that the
   * window slides and the hidden questions are counted at each end, so the
   * total still reads off the footer.
   */
  const dotWindow = useMemo(() => {
    const total = activeTest?.questions.length ?? 0;
    const current = activeTest?.currentQuestionIndex ?? 0;
    if (total <= MAX_QUESTION_DOTS) {
      return { start: 0, end: total, hiddenBefore: 0, hiddenAfter: 0 };
    }
    const start = Math.max(
      0,
      Math.min(current - Math.floor(MAX_QUESTION_DOTS / 2), total - MAX_QUESTION_DOTS)
    );
    const end = start + MAX_QUESTION_DOTS;
    return { start, end, hiddenBefore: start, hiddenAfter: total - end };
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

  /** What the reader committed to for the question on screen, if anything. */
  const currentConfidence = currentQuestion ? confidenceByQuestion[currentQuestion.id] : undefined;

  /**
   * On a practice attempt the answer stays hidden until the reader says how
   * sure they are. That is the point of the feature: a reveal that arrives
   * before the commitment turns "did I know this?" into "did I recognise it
   * once I saw it?", and the four review outcomes stop meaning anything.
   */
  const awaitingConfidence = isPractice && hasAnsweredCurrent && !isAnswerRevealed && !currentConfidence;

  useEffect(() => {
    if (
      !isStudyMode ||
      !showExplanationsImmediately ||
      !hasAnsweredCurrent ||
      isAnswerRevealed ||
      awaitingConfidence ||
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
    awaitingConfidence,
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
    // Changing the answer before the reveal retracts the commitment: the
    // stored pair has to describe the answer that was actually submitted, so
    // the reader re-commits rather than inheriting how sure they were of a
    // choice they have since abandoned. After the reveal there is nothing left
    // to be confident about, so a recorded pair is never disturbed.
    if (!activeTest?.revealedAnswers.has(currentQuestion.id)) {
      setConfidenceByQuestion(prev => {
        if (!(currentQuestion.id in prev)) return prev;
        const next = { ...prev };
        delete next[currentQuestion.id];
        return next;
      });
    }
  }, [currentQuestion, answerQuestion, activeTest]);

  /** Commit to Sure / Not sure, which is what unlocks the reveal. */
  const handleConfidence = useCallback((level: ConfidenceLevel) => {
    if (!currentQuestion) return;
    setConfidenceByQuestion(prev => ({ ...prev, [currentQuestion.id]: level }));
  }, [currentQuestion]);

  // Check answer in study mode
  const handleCheckAnswer = useCallback(() => {
    if (!currentQuestion || !activeTest) return;
    // Belt and braces: the button is not rendered while a commitment is
    // outstanding, but the reveal must not be reachable without one.
    if (isPractice && !confidenceByQuestion[currentQuestion.id]) return;

    const result = checkCurrentAnswer();
    if (result) {
      setFeedbackResult(result);
      setShowFeedback(true);
      revealAnswer(currentQuestion.id);
    }
  }, [currentQuestion, activeTest, checkCurrentAnswer, revealAnswer, isPractice, confidenceByQuestion]);

  const flaggedCount = useMemo(() => {
    if (!activeTest) return 0;
    return activeTest.flaggedQuestions.size;
  }, [activeTest]);

  const isCurrentFlagged = useMemo(() => {
    if (!activeTest || !currentQuestion) return false;
    return activeTest.flaggedQuestions.has(currentQuestion.id);
  }, [activeTest, currentQuestion]);

  /**
   * Leave this session AND take this screen with us.
   *
   * A bare `goBack()` was the whole defect. Reached by nested navigate (Home,
   * a group chat, the offline screen), this screen is the Study stack's only
   * route: GO_BACK is unhandled here, bubbles to the tab navigator and just
   * switches to Home, leaving the session screen mounted as the Study root —
   * later rendering the dead "This test session has ended." with no way back
   * to the Study root at all. planTestExit (testSessionExit.ts) pops when
   * there is genuinely something below, and otherwise resets this stack onto
   * StudyHub, which removes this screen and restores the root in one move.
   *
   * The reset still runs through useConfirmBeforeExit's `beforeRemove` guard,
   * so the "Exit Test?" prompt now appears on this path too — it could not
   * fire before, because nothing was being removed.
   *
   * With a `returnTo` the same reset clears Study and the reader is then put
   * back in the thread they pressed Start Test in. The tab switch waits for
   * the confirmation when the guard is armed (see `pendingReturnRef`), and
   * follows the reset immediately when it is not.
   */
  const dismissSession = useCallback(() => {
    const plan = planTestExit({
      state: navigation.getState?.(),
      rootRouteName: TAB_STACK_ROOT_ROUTE.StudyTab,
      returnTo,
    });
    if (plan.action === 'pop') {
      navigation.goBack();
      return;
    }
    if (plan.action === 'returnToTab') {
      const parent = navigation.getParent?.();
      if (exitGuardArmedRef.current) {
        pendingReturnRef.current = { target: plan.returnTo, parent };
      }
      navigation.reset({ index: 0, routes: plan.routes.map(name => ({ name })) });
      if (!exitGuardArmedRef.current) goToReturnTarget(plan.returnTo, parent);
      return;
    }
    navigation.reset({ index: 0, routes: plan.routes.map(name => ({ name })) });
  }, [navigation, returnTo, goToReturnTarget]);

  /**
   * Hardware BACK, when this session came out of a chat thread.
   *
   * Left alone, BACK is a GO_BACK through the exit guard: it pops the Study
   * stack and lands on the Study hub, while the on-screen Exit beside it
   * returns to the thread — two answers to the same gesture. Routing BACK
   * through `dismissSession` gives it the one answer: the same reset, the
   * same "Exit Test?" prompt (the guard still fires on the reset), the same
   * deferred return. Focus-scoped so anything pushed above owns its own
   * BACK; inert without a `returnTo`, so every in-Study launch keeps the
   * guard's plain GO_BACK exactly as it was.
   */
  useEffect(() => {
    if (!returnTo || !isFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSession();
      return true;
    });
    return () => sub.remove();
  }, [returnTo, isFocused, dismissSession]);

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
        // Stored on the attempt and sent with the session, so reopening this
        // result from History keeps the four confidence outcomes.
        ...(Object.keys(confidenceByQuestion).length > 0 ? { confidenceByQuestion } : {}),
      });
      // Marketplace question bank: queue the attempt for its leaderboard.
      // These sessions are usually finished offline, so the post is deferred
      // to the pending-results sync rather than attempted here.
      if (offlineTestId && offlineTestId.startsWith('qbank-')) {
        const correct = (attempt.answers || []).filter((a) => a.isCorrect).length;
        void import('../../utils/pendingQuestionBankScores')
          .then(async ({ enqueueScoreForBundle, flushPendingQuestionBankScores }) => {
            await enqueueScoreForBundle(
              userId,
              offlineTestId,
              correct,
              liveSession.questions.length
            );
            // Opportunistic flush; failures stay queued for the next sync.
            await flushPendingQuestionBankScores(userId);
          })
          .catch(() => {
            // leaderboard is not critical to finishing a test
          });
      }
      setShowReviewModal(false);
      // Thread the origin on: the results screen is where Done lives, and it
      // has no other way to know this session came out of a chat thread.
      navigation.replace('TestResults', {
        attemptId: attempt.id,
        ...(returnTo ? { returnTo } : {}),
        // The confidence pairs belong to THIS run; review is the only place
        // they are read, and it is the next screen. Omitted entirely on a
        // timed attempt, which never collects them.
        ...(Object.keys(confidenceByQuestion).length > 0
          ? { confidenceByQuestion }
          : {}),
      });
    } catch {
      // FIXED (F2): releasing the guard still re-opens submit — which is
      // correct, a student whose submit failed must be able to try again — but
      // `submitTest` now carries an idempotency key derived from the ATTEMPT
      // id (testStore `attemptIdempotencyKey`), so the second press replays the
      // first write instead of creating a second session and result.
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [submitTest, userId, isOffline, groupName, groupId, offlineTestId, navigation, returnTo, confidenceByQuestion]);

  const handleSubmit = useCallback(async (timeUp = false) => {
    // Session may have been abandoned (exit) while a timer tick was queued.
    const liveSession = useTestStore.getState().activeTest;
    if (!liveSession) return;
    hapticSuccess();

    /**
     * A practice session ENDS IN A REVIEW, exactly like a test.
     *
     * It used to end in `exitStudyMode()` — the session was thrown away, the
     * reader was dropped back on the tests list, and nothing was written: no
     * results screen, no History entry, and therefore nowhere for the four
     * confidence outcomes, the rationale, Explain or the source chip to
     * appear, even though every one of them had been built for practice
     * (device finding T2, build 162). So the one attempt type that collects
     * confidence was the one type that never showed it.
     *
     * `finalizeSubmit` is the same path a test takes: score, file the
     * attempt (its config carries `mode: 'study'`, which is what marks the
     * History row as practice), and REPLACE this screen with TestResults.
     */
    if (liveSession.mode === 'study') {
      appAlert(
        'End Study Session',
        'End this session and see your review? Blanks are counted separately, not as wrong answers.',
        [
          { text: 'Continue', style: 'cancel' },
          { text: 'End & review', onPress: () => { void finalizeSubmit(); } },
        ]
      );
      return;
    }

    if (timeUp) {
      appAlert('Time\'s Up!', 'Your test has been submitted automatically.');
      await finalizeSubmit();
      return;
    }

    setShowReviewModal(true);
  }, [finalizeSubmit]);

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
      <Screen edges={['top']} bottom="safe" className="flex-1" style={{ backgroundColor: colors.background }}>
        <View style={s(colors).errorContainer}>
          <Text style={[s(colors).errorText, { color: colors.textSecondary }]}>{endedCopy}</Text>
          {!isSubmitting && (
            <TouchableOpacity onPress={dismissSession}>
              <Text style={[s(colors).errorLink, { color: colors.primaryText }]}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </Screen>
    );
  }

  return (
    // `keyboard` wraps the header, the question scroller AND the Prev/Next
    // footer in a KeyboardAvoidingView. The fill-in-the-blank field and the
    // open-ended answer box had none, and on Android 15+ (this app targets
    // SDK 36) the window is not resized, so the keyboard covered the field
    // being typed into and the whole footer with no scroll range to recover.
    <Screen edges={['top']} bottom="none" keyboard className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[s(colors).header, { backgroundColor: colors.card, borderBottomColor: colors.border }, isStudyMode && s(colors).headerStudy]}>
        <TouchableOpacity onPress={dismissSession} style={s(colors).exitButton}>
          <AppIcon name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <View style={s(colors).headerCenter}>
          <View style={s(colors).headerTitleRow}>
            <Text style={[s(colors).testName, { color: colors.text }]} numberOfLines={1}>{testName}</Text>
            {isStudyMode && (
              <View style={s(colors).studyBadge}>
                <AppIcon name="book" size={12} color="#10b981" />
                <Text style={s(colors).studyBadgeText}>Study</Text>
              </View>
            )}
          </View>
          {!isStudyMode && activeTest.test.timeLimit > 0 && (
            <View style={[
              s(colors).timerBadge,
              timeRemaining < 60 && s(colors).timerWarning
            ]}>
              <AppIcon name="time" size={14} color={timeRemaining < 60 ? colors.error : colors.text} />
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

      {/* The offline state belongs IN the page, not in the floating chip the
          shell draws over the top-right corner — there it was clipped by the
          Submit button and unreadable (device finding, build 172). The chip
          stands down on this route; this line is what replaces it, and it
          says what offline means for the sitting rather than showing an icon
          alone. */}
      {isOffline && (
        <View style={s(colors).offlineNotice}>
          <AppIcon name="cloud-offline" size={14} color={colors.textSecondary} />
          <T.Caption style={s(colors).offlineNoticeText} numberOfLines={2}>
            Offline · your answers are kept on this phone and your score uploads when you reconnect
          </T.Caption>
        </View>
      )}

      {!isStudyMode && currentQuestion && (
        <View style={s(colors).flagRow}>
          <TouchableOpacity
            style={[s(colors).flagButton, isCurrentFlagged && s(colors).flagButtonActive]}
            onPress={() => toggleFlag(currentQuestion.id)}
            accessibilityLabel={isCurrentFlagged ? 'Remove bookmark' : 'Bookmark for review'}
          >
            <AppIcon
              name="bookmark"
              filled={isCurrentFlagged}
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
        {lockMode && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <AppIcon name="lock-closed" size={12} color={colors.warning} />
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.warning }}>
              Locked — no going back once answered
            </Text>
          </View>
        )}
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
              <Text style={[s(colors).questionTypeText, { color: colors.primaryText }]}>
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
              <AppIcon 
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

        {/* Confidence before reveal — practice attempts only (spec §9 #5) */}
        {isPractice && hasAnsweredCurrent && !isAnswerRevealed && (
          <View
            style={[s(colors).confidenceCard, { backgroundColor: testsAccent.tint }]}
            accessibilityRole="radiogroup"
            accessibilityLabel="How sure are you of this answer?"
          >
            <T.Label style={{ color: testsAccent.ink }}>BEFORE YOU SEE THE ANSWER</T.Label>
            <T.Body style={{ color: testsAccent.ink }}>How sure are you?</T.Body>
            <View style={s(colors).confidenceRow}>
              {([
                { level: 'sure' as ConfidenceLevel, label: 'Sure', icon: 'checkmark-circle' },
                { level: 'unsure' as ConfidenceLevel, label: 'Not sure', icon: 'help-circle' },
              ]).map(option => {
                const selected = currentConfidence === option.level;
                return (
                  <TouchableOpacity
                    key={option.level}
                    style={[
                      s(colors).confidenceOption,
                      { borderColor: testsAccent.ink },
                      selected && { backgroundColor: testsAccent.ink },
                    ]}
                    onPress={() => handleConfidence(option.level)}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                  >
                    <AppIcon
                      name={option.icon as never}
                      size={18}
                      color={selected ? testsAccent.tint : testsAccent.ink}
                    />
                    <T.Body style={{ color: selected ? testsAccent.tint : testsAccent.ink, fontWeight: '600' }}>
                      {option.label}
                    </T.Body>
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* The answer to "why is it asking?", once, where it is asked. */}
            <T.Caption style={{ color: testsAccent.ink }}>
              {currentConfidence
                ? 'Saved. Your review will separate what you knew from what you guessed.'
                : 'Answering this is what tells your review whether a right answer was knowledge or a guess.'}
            </T.Caption>
          </View>
        )}

        {/* Study Mode Check Answer Button */}
        {isStudyMode && hasAnsweredCurrent && !isAnswerRevealed && !awaitingConfidence && (
          <TouchableOpacity
            style={s(colors).checkAnswerButton}
            onPress={handleCheckAnswer}
            activeOpacity={0.8}
          >
            <AppIcon name="eye" size={20} color="#ffffff" />
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
            paddingBottom: navFooterPadding,
          },
          isStudyMode && s(colors).navigationStudy,
        ]}
      >
        {(() => {
          const prevDisabled = prevTargetIndex < 0;
          return (
        <TouchableOpacity
          style={[
            s(colors).navButton,
            prevDisabled && s(colors).navButtonDisabled
          ]}
          onPress={previousQuestion}
          disabled={prevDisabled}
        >
          <AppIcon
            name="chevron-back"
            size={24}
            color={prevDisabled ? colors.textTertiary : colors.text}
          />
          <Text style={[
            s(colors).navButtonText,
            { color: colors.text },
            prevDisabled && { color: colors.textTertiary },
          ]}>
            Previous
          </Text>
        </TouchableOpacity>
          );
        })()}

        <View style={s(colors).questionDots}>
          {dotWindow.hiddenBefore > 0 ? (
            <T.Label tone="tertiary" tabular importantForAccessibility="no">
              +{dotWindow.hiddenBefore}
            </T.Label>
          ) : null}
          {activeTest.questions.slice(dotWindow.start, dotWindow.end).map((q, i) => {
            const actualIndex = dotWindow.start + i;
            const isAnswered = !!activeTest.answers[q.id];
            const isCurrent = actualIndex === activeTest.currentQuestionIndex;
            const isRevealed = activeTest.revealedAnswers.has(q.id);
            const isFlagged = activeTest.flaggedQuestions.has(q.id);
            const isLocked = lockMode && !isCurrent && !!activeTest.lockedQuestionIds?.has(q.id);

            return (
              <TouchableOpacity
                key={q.id}
                onPress={() => { if (!isLocked) goToQuestion(actualIndex); }}
                disabled={isLocked}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <View
                  style={[
                    s(colors).dot,
                    { backgroundColor: colors.border },
                    isAnswered && { backgroundColor: colors.success },
                    isCurrent && { backgroundColor: colors.primaryFill, width: 12 },
                    isStudyMode && isRevealed && { backgroundColor: colors.info },
                    isFlagged && { backgroundColor: colors.warning },
                    isLocked && { backgroundColor: colors.textTertiary, opacity: 0.6 },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
          {dotWindow.hiddenAfter > 0 ? (
            <T.Label tone="tertiary" tabular importantForAccessibility="no">
              +{dotWindow.hiddenAfter}
            </T.Label>
          ) : null}
        </View>

        {/* Next/Finish button */}
        {activeTest.currentQuestionIndex === activeTest.questions.length - 1 ? (
          isStudyMode ? (
            <TouchableOpacity
              style={[s(colors).navButton, s(colors).finishStudyButton, { backgroundColor: colors.successBackground }]}
              onPress={() => handleSubmit()}
            >
              <Text style={[s(colors).finishStudyText, { color: colors.success }]}>Finish</Text>
              <AppIcon name="checkmark" size={24} color={colors.success} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s(colors).navButton, s(colors).navButtonDisabled]}
              disabled
            >
              <Text style={[s(colors).navButtonTextDisabled, { color: colors.textTertiary }]}>Next</Text>
              <AppIcon name="chevron-forward" size={24} color={colors.textTertiary} />
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            style={s(colors).navButton}
            onPress={nextQuestion}
          >
            <Text style={[s(colors).navButtonText, { color: colors.primaryText }]}>Next</Text>
            <AppIcon name="chevron-forward" size={24} color={colors.primaryText} />
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
    </Screen>
  );
}
