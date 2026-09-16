// ===========================================
// Lantern Study Mobile - Test Configuration Modal
// ===========================================

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { appAlert } from './ui/appDialog';
import { QuestionType, TestMode, type TestPreset, type TestPresetConfig } from '../stores/testStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileQuestionTypesToWeb, webQuestionTypesToMobile } from '../utils/questionHelpers';
import {
  QUESTION_VISIBILITY_MODE_OPTIONS,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import { useQuestionVisibilityMode } from '../hooks/useQuestionVisibilityMode';
import { CoursePicker } from './CoursePicker';
import { TopicPicker } from './TopicPicker';
import { topicIdAfterCourseChange } from '../utils/topicSelection';
import { AppIcon, type AppIconName } from './ui/AppIcon';
import { planBottomSheetKeyboard } from './ui/bottomSheetKeyboard';
import { useKeyboardOverlap } from './ui/useKeyboardOverlap';
// The start rules are pure and live beside the tests screens, where mobile
// jest (node env, *.test.ts only) can reach them: this modal renders what
// they return and holds no judgement of its own.
import { isTestConfigValid, testConfigValidationHint } from '../screens/tests/testConfigRules';
// The one line pinned above Start, and the same pure module the Tests screens
// read their retake decision from.
import { formatTestConfigSummary } from '../screens/tests/testAuthoring';
import { resolveSessionTimeLimitMinutes } from '../utils/resolveAttemptTimeLimitMinutes';
import { planTimerChoicePersist, type TimerChoiceExit } from '../screens/tests/testConfigRules';
import { createStyles } from './TestConfigModal.styles';

// Timer presets in seconds
const TIMER_PRESETS = [
  { label: 'None', value: 0 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: '15 min', value: 900 },
  { label: '20 min', value: 1200 },
  { label: '30 min', value: 1800 },
  { label: '1 hour', value: 3600 },
];

const QUESTION_TYPE_OPTIONS: { type: QuestionType; label: string; icon: AppIconName }[] = [
  { type: 'multiple_choice_single', label: 'Multiple Choice', icon: 'radio-button-on' },
  { type: 'multiple_choice_multiple', label: 'Multi-Select', icon: 'checkbox' },
  { type: 'true_false', label: 'True/False', icon: 'swap-horizontal' },
  { type: 'fill_in_blank', label: 'Fill in Blank', icon: 'text' },
  { type: 'matching', label: 'Matching', icon: 'git-compare' },
  { type: 'diagram_labeling', label: 'Diagram Label', icon: 'image' },
  { type: 'open_ended', label: 'Open Ended', icon: 'document-text' },
];

export interface TestConfigOptions {
  numberOfQuestions: number;
  timerDuration: number; // in seconds, 0 = no timer
  selectedQuestionTypes: QuestionType[];
  selectedTags: string[];
  useSpacedRepetition: boolean;
  focusOnNew: boolean;
  selectedSubgroupIds: string[];
  visibilityMode?: QuestionVisibilityMode;
  /** Exam lock: can't return to a question once answered (test mode only). */
  lockAnswered?: boolean;
  /**
   * Shuffle the question order for THIS session. Seeded from the account
   * setting; stated here so one session can differ from the preference
   * without editing it.
   */
  shuffleQuestions?: boolean;
  /** Academic archive: course this session is for (defaults from the group). */
  courseId?: string | null;
  /**
   * Topic within `courseId`. Rides the same config-like payload as `courseId`
   * (the server reads both off the config), so it is never sent without one.
   */
  topicId?: string | null;
}

export interface TestConfigAvailableFilter {
  selectedQuestionTypes: QuestionType[];
  selectedTags: string[];
  useSpacedRepetition: boolean;
  focusOnNew: boolean;
  subgroupIds: string[];
  visibilityMode?: QuestionVisibilityMode;
  sessionMode?: 'test' | 'study';
}

interface TestConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (config: TestConfigOptions, mode: TestMode) => void;
  mode: TestMode;
  maxQuestions: number;
  availableTags: string[];
  testName: string;
  getAvailableCount?: (filter: TestConfigAvailableFilter) => number;
  presets?: TestPreset[];
  onSavePreset?: (name: string, config: TestPresetConfig) => void;
  onDeletePreset?: (presetId: string) => void;
  subgroups?: { id: string; name: string; level: number }[];
  /**
   * Save this configuration as an offline bundle instead of starting a
   * session (web parity: the same modal offers Start and Download there).
   */
  onDownload?: (config: TestConfigOptions) => void;
  isDownloading?: boolean;
  /**
   * Academic archive: the course this session is filed under. Defaults from
   * the group's course; the student can change or clear it per session.
   */
  defaultCourseId?: string | null;
  defaultTopicId?: string | null;
  /**
   * The timer this sheet OPENS on, in minutes (0 = No limit).
   *
   * Supplied by the caller so the sheet, the mode sheet's stats strip and the
   * launch all print the same number (finding T4: the strip said "No Limit"
   * and this sheet said "5 min" for the same test). Omitted — a group session
   * assembled out of chat messages, say — the old auto rule stands: one
   * minute per question until the reader touches a chip.
   */
  defaultTimerMinutes?: number | null;
  /**
   * The timer this sheet is closing with, in MINUTES (0 = No limit).
   *
   * Fired on Start AND on Cancel/×, because a reader who set "No limit" and
   * then backed out has still said the last word on this test — build 163
   * threw that away and reopened the sheet on a minute per question. Only a
   * TEST session reports one: study mode has no Timer section, so it has
   * chosen nothing.
   */
  onTimerChoice?: (minutes: number) => void;
}

export default function TestConfigModal({
  visible,
  onClose,
  onSubmit,
  mode,
  maxQuestions,
  availableTags,
  testName,
  getAvailableCount,
  presets = [],
  onSavePreset,
  onDeletePreset,
  subgroups = [],
  onDownload,
  isDownloading = false,
  defaultCourseId = null,
  defaultTopicId = null,
  defaultTimerMinutes = null,
  onTimerChoice,
}: TestConfigModalProps) {
  const [numberOfQuestions, setNumberOfQuestions] = useState(Math.min(10, maxQuestions));
  const [timerDuration, setTimerDuration] = useState(0);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [useSpacedRepetition, setUseSpacedRepetition] = useState(false);
  const [focusOnNew, setFocusOnNew] = useState(false);
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<string[]>([]);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lockAnswered, setLockAnswered] = useState(false);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [courseId, setCourseId] = useState<string | null>(defaultCourseId ?? null);
  const [topicId, setTopicId] = useState<string | null>(defaultTopicId ?? null);
  // Re-seed from the group whenever the modal (re)opens for a different default.
  useEffect(() => {
    if (visible) {
      setCourseId(defaultCourseId ?? null);
      setTopicId(defaultTopicId ?? null);
    }
  }, [visible, defaultCourseId, defaultTopicId]);
  const { colors } = useTheme();
  // The stylesheet used to hardcode slate-900/800 values, so this modal stayed
  // dark in light mode. Rebuild it whenever the theme changes.
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  // Size the sheet in pixels from the window, not with a percentage: under
  // edge-to-edge a transparent Modal's window can be measured before the
  // system bars are accounted for, and a '92%' container then mounts ~170px
  // too low with its footer off-screen until something re-renders it (seen on
  // build 146). The group-actions sheet uses the same pixel formula and never
  // misplaces.
  const { height: windowHeight } = useWindowDimensions();
  // And what the keyboard does to it. This sheet has a preset-name field and a
  // question-count field; with nothing handling the keyboard they were simply
  // covered, and with the KeyboardAvoidingView its siblings used they would have
  // been stranded instead — on Android RN feeds `keyboardDidHide` through the
  // same handler as the show event and recomputes the padding from the hide
  // frame, which under edge-to-edge is the window minus the gesture bar, so the
  // lift never returns to 0 (build 171, the generate sheet: header and close X
  // pinned under the status bar, untappable). `planBottomSheetKeyboard` returns
  // the resting geometry whenever the overlap is 0, and the overlap is 0 on
  // every hide path — BACK, tap-away, the done key.
  const keyboardOverlap = useKeyboardOverlap(visible);
  const sheet = planBottomSheetKeyboard({
    windowHeight,
    restingHeight: Math.round(windowHeight * 0.92),
    keyboardOverlap,
    topInset: insets.top,
  });
  const [questionVisibilityMode, setQuestionVisibilityMode] = useQuestionVisibilityMode();

  /**
   * Has the reader picked a timer themselves?
   *
   * Until they do, the timer tracks the question count (1 min each). After
   * they do, it stops moving — including on "None", which used to be undone
   * by the next tap on the question stepper.
   */
  const [timerTouched, setTimerTouched] = useState(false);

  const forcesStudyFromVisibility = mode === 'test' && questionVisibilityMode === 'unverified';
  const isStudyMode = mode === 'study' || forcesStudyFromVisibility;
  const effectiveSessionMode: 'test' | 'study' = isStudyMode ? 'study' : 'test';

  const liveAvailableCount = useMemo(() => {
    if (!getAvailableCount) return maxQuestions;
    return getAvailableCount({
      selectedQuestionTypes,
      selectedTags,
      useSpacedRepetition,
      focusOnNew,
      subgroupIds: useSpacedRepetition || focusOnNew ? [] : selectedSubgroupIds,
      visibilityMode: questionVisibilityMode,
      sessionMode: effectiveSessionMode,
    });
  }, [
    getAvailableCount,
    maxQuestions,
    selectedQuestionTypes,
    selectedTags,
    useSpacedRepetition,
    focusOnNew,
    selectedSubgroupIds,
    questionVisibilityMode,
    effectiveSessionMode,
  ]);

  const effectiveMaxQuestions = getAvailableCount ? liveAvailableCount : maxQuestions;

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setNumberOfQuestions(Math.min(10, Math.max(1, maxQuestions)));
      setTimerDuration(isStudyMode ? 0 : Math.min(600, Math.max(60, Math.min(10, maxQuestions) * 60)));
      // All types preselected, matching web: the Question Types section sits
      // below the fold, so an empty default just presented users with disabled
      // Start/Download buttons and no visible reason why.
      setSelectedQuestionTypes(QUESTION_TYPE_OPTIONS.map(option => option.type));
      setSelectedTags([]);
      setUseSpacedRepetition(false);
      setFocusOnNew(false);
      setSelectedSubgroupIds([]);
      setPresetName('');
      setSelectedPresetId('');
      setShowAdvanced(false);
      setTimerTouched(false);
      setLockAnswered(isStudyMode ? false : useSettingsStore.getState().settings.study.lockAnsweredQuestions);
      setShuffleQuestions(useSettingsStore.getState().settings.study.shuffleQuestions);
    }
  }, [visible, maxQuestions, isStudyMode]);

  // Clamp question count when available pool changes
  useEffect(() => {
    if (!visible) return;
    if (effectiveMaxQuestions === 0) {
      setNumberOfQuestions(0);
      return;
    }
    setNumberOfQuestions(prev => {
      if (prev <= 0) return Math.min(10, effectiveMaxQuestions);
      if (prev > effectiveMaxQuestions) return effectiveMaxQuestions;
      if (prev < 1) return 1;
      return prev;
    });
  }, [effectiveMaxQuestions, visible]);

  // Auto-set timer to 1 min per question in test mode — until the reader
  // states a preference, which then stands.
  //
  // A caller-supplied `defaultTimerMinutes` outranks the auto rule, 0
  // included: a test saved as untimed must open untimed here, or the sheet
  // reinstates a clock its own strip said there wasn't (T4).
  useEffect(() => {
    if (!visible || isStudyMode || timerTouched) return;
    if (typeof defaultTimerMinutes === 'number' && Number.isFinite(defaultTimerMinutes)) {
      setTimerDuration(Math.max(0, Math.round(defaultTimerMinutes)) * 60);
      return;
    }
    if (numberOfQuestions > 0) {
      setTimerDuration(numberOfQuestions * 60);
    }
  }, [numberOfQuestions, visible, isStudyMode, timerTouched, defaultTimerMinutes]);

  // Mutual exclusion for SR and Focus on New
  useEffect(() => {
    if (focusOnNew) setUseSpacedRepetition(false);
  }, [focusOnNew]);

  useEffect(() => {
    if (useSpacedRepetition) setFocusOnNew(false);
  }, [useSpacedRepetition]);

  useEffect(() => {
    if (focusOnNew || useSpacedRepetition) {
      setSelectedSubgroupIds([]);
    }
  }, [focusOnNew, useSpacedRepetition]);

  const toggleSubgroup = useCallback((subgroupId: string) => {
    setSelectedSubgroupIds(prev =>
      prev.includes(subgroupId) ? prev.filter(id => id !== subgroupId) : [...prev, subgroupId]
    );
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setNumberOfQuestions(preset.config.numberOfQuestions);
    // A saved preset states its timer, 0 (untimed) included: don't let the
    // question count overwrite it.
    timerTouchedRef.current = true;
    setTimerDuration(preset.config.timerDuration || 0);
    setTimerTouched(true);
    setSelectedQuestionTypes(webQuestionTypesToMobile(preset.config.allowedQuestionTypes || []));
    setSelectedTags(preset.config.selectedTags || []);
    setFocusOnNew(preset.config.focusOnNew || false);
    setUseSpacedRepetition(false);
    setSelectedPresetId(presetId);
  }, [presets]);

  const handleSavePreset = useCallback(() => {
    if (!onSavePreset || !presetName.trim()) {
      appAlert('Preset name required', 'Please enter a name for the preset.');
      return;
    }
    if (presets.length >= 5) {
      appAlert('Limit reached', 'You can save up to 5 presets. Delete one to add another.');
      return;
    }
    const config: TestPresetConfig = {
      numberOfQuestions,
      allowedQuestionTypes:
        useSpacedRepetition || focusOnNew ? [] : mobileQuestionTypesToWeb(selectedQuestionTypes),
      selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
      timerDuration: !isStudyMode && timerDuration > 0 ? timerDuration : undefined,
      focusOnNew,
    };
    onSavePreset(presetName.trim(), config);
    setPresetName('');
  }, [
    onSavePreset,
    presetName,
    presets.length,
    numberOfQuestions,
    useSpacedRepetition,
    focusOnNew,
    selectedQuestionTypes,
    selectedTags,
    timerDuration,
    isStudyMode,
  ]);

  const toggleQuestionType = useCallback((type: QuestionType) => {
    setSelectedQuestionTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  /**
   * Timer "None" is NOT part of this: an untimed test is a real choice, and
   * the old rule refused to start on it — Start Test sat disabled under "Set
   * a timer for the test." while "5 min" worked.
   */
  const validityInput = useMemo(
    () => ({
      effectiveMaxQuestions,
      numberOfQuestions,
      isStudyMode,
      useSpacedRepetition,
      focusOnNew,
      selectedQuestionTypeCount: selectedQuestionTypes.length,
    }),
    [
      effectiveMaxQuestions,
      numberOfQuestions,
      isStudyMode,
      useSpacedRepetition,
      focusOnNew,
      selectedQuestionTypes,
    ]
  );

  const isValid = useMemo(() => isTestConfigValid(validityInput), [validityInput]);

  const validationHint = useMemo(() => testConfigValidationHint(validityInput), [validityInput]);

  const summaryLine = useMemo(
    () =>
      formatTestConfigSummary({
        questionCount: numberOfQuestions,
        // The SAME rule the launch will apply (utils/resolveAttemptTimeLimitMinutes),
        // not a second reading of the timer chips: the summary and the session
        // cannot disagree about how long this runs.
        timeLimitMinutes: resolveSessionTimeLimitMinutes({
          timerDurationSeconds: isStudyMode ? 0 : timerDuration,
          sessionMode: effectiveSessionMode,
          // A study session has no timer of its own and no test to borrow one
          // from: 0 here is what makes the line read "No time limit".
          fallbackMinutes: 0,
        }),
        shuffled: shuffleQuestions,
        lockAnswered: isStudyMode ? false : lockAnswered,
      }),
    [numberOfQuestions, timerDuration, isStudyMode, effectiveSessionMode, shuffleQuestions, lockAnswered]
  );

  /**
   * Tell the caller what the timer is set to, whichever way this sheet closes.
   *
   * One function for both exits so Start and Cancel can never record
   * different things, and none of the judgement lives here — the sheet keeps
   * no rules of its own (`planTimerChoicePersist`).
   */
  const timerTouchedRef = useRef(false);
  const reportTimerChoice = useCallback(
    (exit: TimerChoiceExit) => {
      if (!onTimerChoice) return;
      const minutes = planTimerChoicePersist({
        timerDurationSeconds: timerDuration,
        sessionMode: effectiveSessionMode,
        exit,
        touched: timerTouchedRef.current,
      });
      if (minutes !== null) onTimerChoice(minutes);
    },
    [onTimerChoice, timerDuration, effectiveSessionMode]
  );

  /**
   * Cancel, × and the hardware back — the choice is recorded before the sheet
   * goes, on every one of them.
   *
   * A timer is a SETTING, not a form field: "No limit" is an answer about this
   * test, and backing out of the sheet does not retract it. Build 164 kept it
   * for × and dropped it for Cancel, so the same two presses on the same sheet
   * meant different things. The exit is passed through only so the rule is
   * legible (and testable) — `planTimerChoicePersist` ignores it.
   */
  const handleClose = useCallback(() => {
    reportTimerChoice('cancel');
    onClose();
  }, [reportTimerChoice, onClose]);

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    if (questionVisibilityMode === 'none') {
      appAlert('No questions', 'Question visibility is set to hide all. Change the filter to start.');
      return;
    }
    if (forcesStudyFromVisibility) {
      appAlert(
        'Study session',
        'Unverified questions are study-only. Starting a study session instead.'
      );
    }

    reportTimerChoice('start');
    onSubmit(
      {
        numberOfQuestions,
        timerDuration: isStudyMode ? 0 : timerDuration,
        selectedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
        selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
        useSpacedRepetition,
        focusOnNew,
        selectedSubgroupIds: useSpacedRepetition || focusOnNew ? [] : selectedSubgroupIds,
        visibilityMode: questionVisibilityMode,
        lockAnswered: isStudyMode ? false : lockAnswered,
        shuffleQuestions,
        courseId,
        topicId,
      },
      effectiveSessionMode
    );
  }, [
    isValid,
    numberOfQuestions,
    timerDuration,
    selectedQuestionTypes,
    selectedTags,
    useSpacedRepetition,
    focusOnNew,
    selectedSubgroupIds,
    lockAnswered,
    shuffleQuestions,
    courseId,
    topicId,
    mode,
    questionVisibilityMode,
    forcesStudyFromVisibility,
    isStudyMode,
    effectiveSessionMode,
    isStudyMode,
    onSubmit,
    reportTimerChoice,
  ]);

  /**
   * Same config assembly as handleSubmit, but no timer requirement: a
   * downloaded bundle picks its time limit when the session starts.
   */
  const handleDownload = useCallback(() => {
    if (!onDownload || effectiveMaxQuestions === 0) return;
    if (questionVisibilityMode === 'none') {
      appAlert('No questions', 'Question visibility is set to hide all. Change the filter to download.');
      return;
    }
    onDownload({
      numberOfQuestions,
      timerDuration,
      selectedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
      selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
      useSpacedRepetition,
      focusOnNew,
      selectedSubgroupIds: useSpacedRepetition || focusOnNew ? [] : selectedSubgroupIds,
      visibilityMode: questionVisibilityMode,
      // Downloads are always TAKEN in test mode later, so a study-mode modal
      // (toggle hidden) must not bake in an explicit false — undefined lets
      // the bundle fall back to the global setting, matching web bundles.
      lockAnswered: isStudyMode ? undefined : lockAnswered,
      shuffleQuestions,
      courseId,
      topicId,
    });
  }, [
    onDownload,
    effectiveMaxQuestions,
    numberOfQuestions,
    timerDuration,
    selectedQuestionTypes,
    selectedTags,
    useSpacedRepetition,
    focusOnNew,
    selectedSubgroupIds,
    questionVisibilityMode,
    isStudyMode,
    lockAnswered,
    shuffleQuestions,
    courseId,
    topicId,
  ]);

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return 'No limit';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours} hour`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { paddingBottom: sheet.liftBy }]}>
        <View style={[styles.container, { backgroundColor: colors.card, height: sheet.height }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {/* The hit area is part of the header, so it moves with the sheet
                and never has to be aimed at where the sheet used to be. */}
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeButton, { backgroundColor: colors.background }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <AppIcon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={[styles.headerIcon, isStudyMode && styles.headerIconStudy]}>
                <AppIcon 
                  name={isStudyMode ? 'book' : 'document-text'} 
                  size={24} 
                  color={isStudyMode ? '#10b981' : colors.primary} 
                />
              </View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {isStudyMode ? 'Study Session' : 'Test Configuration'}
              </Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{testName}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView 
            style={styles.content} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.contentContainer}
          >
            {/* Mode Description */}
            <View style={[styles.infoBox, isStudyMode && styles.infoBoxStudy]}>
              <AppIcon 
                name={isStudyMode ? 'bulb' : 'timer'} 
                size={20} 
                color={isStudyMode ? '#10b981' : '#10b981'} 
              />
              <Text style={styles.infoText}>
                {isStudyMode 
                  ? 'Study at your own pace with immediate feedback and explanations.'
                  : 'Timed assessment with scoring. Submit when ready or when time runs out.'
                }
              </Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AppIcon name="filter" size={20} color={colors.primaryText} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Question visibility</Text>
              </View>
              <View style={{ gap: 8, marginTop: 8 }}>
                {QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => {
                  const selected = questionVisibilityMode === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setQuestionVisibilityMode(opt.value)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? `${colors.primary}14` : colors.background,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: selected ? '700' : '500' }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {opt.helper}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {forcesStudyFromVisibility ? (
                <Text style={[styles.availableHint, { color: colors.warning || '#b45309', marginTop: 8 }]}>
                  Unverified pool is practice-only — Start opens Study mode.
                </Text>
              ) : null}
              {mode === 'test' && questionVisibilityMode === 'all' ? (
                <Text style={[styles.availableHint, { color: colors.textSecondary, marginTop: 8 }]}>
                  Graded tests still use the verified subset only.
                </Text>
              ) : null}
            </View>

            {/* Number of Questions */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AppIcon name="list" size={20} color={colors.primaryText} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Number of Questions</Text>
                <Text style={[styles.questionCount, { color: colors.primaryText }]}>
                  {numberOfQuestions} / {effectiveMaxQuestions}
                </Text>
              </View>
              {getAvailableCount ? (
                <Text style={[styles.availableHint, { color: colors.textSecondary }]}>
                  {effectiveMaxQuestions} question{effectiveMaxQuestions === 1 ? '' : 's'} available with current filters
                </Text>
              ) : null}
              
              <View style={styles.sliderContainer}>
                <View style={styles.numberInputRow}>
                  <TouchableOpacity
                    style={[styles.numberButton, { backgroundColor: colors.primaryFill }]}
                    onPress={() => setNumberOfQuestions(Math.max(1, numberOfQuestions - 1))}
                    disabled={numberOfQuestions <= 1}
                  >
                    <AppIcon name="remove" size={20} color={numberOfQuestions <= 1 ? colors.textSecondary : '#ffffff'} />
                  </TouchableOpacity>
                  
                  <TextInput
                    style={[styles.numberInput, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }]}
                    value={String(numberOfQuestions)}
                    onChangeText={(text) => {
                      const val = parseInt(text) || 1;
                      const clamped = Math.min(Math.max(1, val), Math.max(1, effectiveMaxQuestions));
                      setNumberOfQuestions(clamped);
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                  
                  <TouchableOpacity
                    style={[styles.numberButton, { backgroundColor: colors.primaryFill }]}
                    onPress={() => setNumberOfQuestions(Math.min(effectiveMaxQuestions, numberOfQuestions + 1))}
                    disabled={numberOfQuestions >= effectiveMaxQuestions}
                  >
                    <AppIcon name="add" size={20} color={numberOfQuestions >= effectiveMaxQuestions ? colors.textSecondary : '#ffffff'} />
                  </TouchableOpacity>
                </View>
                
                {/* Quick select buttons */}
                <View style={styles.quickSelectRow}>
                  {[5, 10, 15, 20].filter(n => n <= effectiveMaxQuestions).map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.quickSelectButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        numberOfQuestions === num && { backgroundColor: colors.primaryFill, borderColor: colors.primary },
                      ]}
                      onPress={() => setNumberOfQuestions(num)}
                    >
                      <Text style={[
                        styles.quickSelectText,
                        { color: colors.textSecondary },
                        numberOfQuestions === num && { color: '#fff' },
                      ]}>{num}</Text>
                    </TouchableOpacity>
                  ))}
                  {effectiveMaxQuestions > 20 && (
                    <TouchableOpacity
                      style={[
                        styles.quickSelectButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        numberOfQuestions === effectiveMaxQuestions && { backgroundColor: colors.primaryFill, borderColor: colors.primary },
                      ]}
                      onPress={() => setNumberOfQuestions(effectiveMaxQuestions)}
                    >
                      <Text style={[
                        styles.quickSelectText,
                        { color: colors.textSecondary },
                        numberOfQuestions === effectiveMaxQuestions && { color: '#fff' },
                      ]}>All</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Timer - Only for Test Mode */}
            {!isStudyMode && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <AppIcon name="time" size={20} color="#f97316" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Timer</Text>
                  <Text style={[styles.timerValue, { color: '#f97316' }]}>{formatTime(timerDuration)}</Text>
                </View>
                
                <View style={styles.timerPresets}>
                  {TIMER_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset.value}
                      style={[
                        styles.timerPresetButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        timerDuration === preset.value && { backgroundColor: '#f97316', borderColor: '#f97316' },
                      ]}
                      onPress={() => {
                        timerTouchedRef.current = true;
                        setTimerDuration(preset.value);
                        setTimerTouched(true);
                      }}
                    >
                      <Text style={[
                        styles.timerPresetText,
                        { color: colors.textSecondary },
                        timerDuration === preset.value && { color: '#fff' },
                      ]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Shuffle — every mode. The account setting is the default this
                opened on; the sheet is where one session may differ from it. */}
            <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
              <View style={styles.toggleInfo}>
                <View style={styles.toggleIcon}>
                  <AppIcon name="shuffle" size={20} color={colors.primaryText} />
                </View>
                <View style={styles.toggleContent}>
                  <Text style={[styles.toggleTitle, { color: colors.text }]}>Shuffle questions</Text>
                  <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                    A different order each time, so you learn the material rather than the sequence.
                  </Text>
                </View>
              </View>
              <Switch
                value={shuffleQuestions}
                onValueChange={setShuffleQuestions}
                trackColor={{ false: colors.border, true: colors.primaryFill }}
                thumbColor={shuffleQuestions ? colors.primaryFill : colors.textSecondary}
              />
            </View>

            {/* Lock answered questions - Test Mode only */}
            {!isStudyMode && (
              <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
                <View style={styles.toggleInfo}>
                  <View style={styles.toggleIcon}>
                    <AppIcon name="lock-closed" size={20} color="#f59e0b" />
                  </View>
                  <View style={styles.toggleContent}>
                    <Text style={[styles.toggleTitle, { color: colors.text }]}>Lock answered questions</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                      Once you answer and move on, you can't go back — like a real exam. Skipped questions stay open.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={lockAnswered}
                  onValueChange={setLockAnswered}
                  trackColor={{ false: colors.border, true: '#f59e0b40' }}
                  thumbColor={lockAnswered ? '#f59e0b' : colors.textSecondary}
                />
              </View>
            )}

            {/* Question Types */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AppIcon name="apps" size={20} color="#8b5cf6" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Question Types</Text>
                {selectedQuestionTypes.length > 0 && (
                  <Text style={[styles.selectedCount, { color: '#8b5cf6' }]}>
                    {selectedQuestionTypes.length} selected
                  </Text>
                )}
              </View>
              
              {(useSpacedRepetition || focusOnNew) ? (
                <View style={styles.disabledMessage}>
                  <AppIcon name="information-circle" size={16} color={colors.textSecondary} />
                  <Text style={[styles.disabledMessageText, { color: colors.textSecondary }]}>
                    All types included with {useSpacedRepetition ? 'Spaced Repetition' : 'Focus on New'}
                  </Text>
                </View>
              ) : (
                <View style={styles.questionTypes}>
                  {QUESTION_TYPE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.type}
                      style={[
                        styles.questionTypeButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        selectedQuestionTypes.includes(option.type) && { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
                      ]}
                      onPress={() => toggleQuestionType(option.type)}
                    >
                      <AppIcon 
                        name={option.icon} 
                        size={18} 
                        color={selectedQuestionTypes.includes(option.type) ? '#ffffff' : colors.textSecondary} 
                      />
                      <Text style={[
                        styles.questionTypeText,
                        { color: colors.textSecondary },
                        selectedQuestionTypes.includes(option.type) && { color: '#fff' },
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Presets */}
            {onSavePreset ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <AppIcon name="bookmark" size={20} color="#10b981" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Presets</Text>
                </View>
                {presets.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
                    {presets.map(preset => (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.presetChip,
                          { borderColor: colors.border, backgroundColor: colors.inputBackground },
                          selectedPresetId === preset.id && { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
                        ]}
                        onPress={() => applyPreset(preset.id)}
                      >
                        <Text style={[styles.presetChipText, { color: colors.text }]}>{preset.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.presetSaveRow}>
                  <TextInput
                    style={[styles.presetInput, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }]}
                    value={presetName}
                    onChangeText={setPresetName}
                    placeholder="Preset name"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <TouchableOpacity style={[styles.presetSaveButton, { backgroundColor: colors.primaryFill }]} onPress={handleSavePreset}>
                    <Text style={styles.presetSaveText}>Save</Text>
                  </TouchableOpacity>
                  {onDeletePreset && selectedPresetId ? (
                    <TouchableOpacity
                      style={styles.presetDeleteButton}
                      onPress={() => {
                        appAlert('Delete preset', 'Remove this preset?', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              onDeletePreset(selectedPresetId);
                              setSelectedPresetId('');
                            },
                          },
                        ]);
                      }}
                    >
                      <AppIcon name="trash" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Sub-groups */}
            {subgroups.length > 0 && !useSpacedRepetition && !focusOnNew ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <AppIcon name="git-network" size={20} color="#0ea5e9" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Include Sub-groups</Text>
                </View>
                <TouchableOpacity
                  style={styles.selectAllRow}
                  onPress={() => {
                    if (selectedSubgroupIds.length === subgroups.length) {
                      setSelectedSubgroupIds([]);
                    } else {
                      setSelectedSubgroupIds(subgroups.map(s => s.id));
                    }
                  }}
                >
                  <AppIcon
                    name={selectedSubgroupIds.length === subgroups.length ? 'checkbox' : 'square'}
                    size={18}
                    color="#0ea5e9"
                  />
                  <Text style={[styles.selectAllText, { color: colors.text }]}>Select all sub-groups</Text>
                </TouchableOpacity>
                {subgroups.map(sub => (
                  <TouchableOpacity
                    key={sub.id}
                    style={[styles.subgroupRow, { paddingLeft: 12 + sub.level * 16 }]}
                    onPress={() => toggleSubgroup(sub.id)}
                  >
                    <AppIcon
                      name={selectedSubgroupIds.includes(sub.id) ? 'checkbox' : 'square'}
                      size={18}
                      color="#0ea5e9"
                    />
                    <Text style={[styles.subgroupText, { color: colors.text }]}>{sub.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Course (academic archive) */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AppIcon name="school" size={20} color={colors.primaryText} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Course</Text>
              </View>
              <CoursePicker
                value={courseId}
                onChange={course => {
                  const nextCourseId = course?.id ?? null;
                  setTopicId(topicIdAfterCourseChange(topicId, courseId, nextCourseId));
                  setCourseId(nextCourseId);
                }}
                placeholder="File this session under a course (optional)"
                title="Course for this session"
              />
              <View style={{ marginTop: 8 }}>
                <TopicPicker
                  courseId={courseId}
                  value={topicId}
                  onChange={topic => setTopicId(topic?.id ?? null)}
                  placeholder="Which part of the syllabus? (optional)"
                  title="Topic for this session"
                />
              </View>
            </View>

            {/* Advanced Options */}
            <TouchableOpacity
              style={[styles.advancedToggle, { borderTopColor: colors.border }]}
              onPress={() => setShowAdvanced(!showAdvanced)}
            >
              <Text style={[styles.advancedToggleText, { color: colors.primaryText }]}>Advanced Options</Text>
              <AppIcon 
                name={showAdvanced ? 'chevron-up' : 'chevron-down'} 
                size={20} 
                color={colors.primaryText} 
              />
            </TouchableOpacity>

            {showAdvanced && (
              <>
                {/* Spaced Repetition */}
                <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleIcon}>
                      <AppIcon name="sync" size={20} color="#f59e0b" />
                    </View>
                    <View style={styles.toggleContent}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Spaced Repetition</Text>
                      <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                        Focus on questions you've gotten wrong more than right
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={useSpacedRepetition}
                    onValueChange={setUseSpacedRepetition}
                    trackColor={{ false: colors.border, true: '#f59e0b40' }}
                    thumbColor={useSpacedRepetition ? '#f59e0b' : colors.textSecondary}
                  />
                </View>

                {/* Focus on New */}
                <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleIcon}>
                      <AppIcon name="sparkles" size={20} color="#10b981" />
                    </View>
                    <View style={styles.toggleContent}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Focus on New</Text>
                      <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                        Prioritize questions added in the last 7 days or never attempted
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={focusOnNew}
                    onValueChange={setFocusOnNew}
                    trackColor={{ false: colors.border, true: '#10b98140' }}
                    thumbColor={focusOnNew ? '#10b981' : colors.textSecondary}
                  />
                </View>

                {/* Tags */}
                {availableTags.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <AppIcon name="pricetags" size={20} color="#ec4899" />
                      <Text style={[styles.sectionTitle, { color: colors.text }]}>Filter by Tags</Text>
                    </View>
                    
                    <View style={styles.tags}>
                      {availableTags.map((tag) => (
                        <TouchableOpacity
                          key={tag}
                          style={[
                            styles.tagButton,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            selectedTags.includes(tag) && { backgroundColor: '#ec4899', borderColor: '#ec4899' },
                          ]}
                          onPress={() => toggleTag(tag)}
                        >
                          <Text style={[
                            styles.tagText,
                            selectedTags.includes(tag) && styles.tagTextActive,
                          ]}>
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.card,
                // With the sheet lifted, the gesture bar is behind the keyboard:
                // paying its inset too would strand Start in a dead gap.
                paddingBottom: sheet.liftBy > 0 ? 16 : Math.max(32, insets.bottom + 16),
              },
            ]}
          >
            {/* What you are about to start, in one line.
                The sheet is long enough that the question count set at the top
                is off-screen by the time Start is in reach — which is how a
                student sits a 10-question test they thought was 30. Nothing
                here is computed for the first time; it reads back decisions
                made further up this same sheet, and the minutes come from the
                one time-limit rule the launch itself will use. */}
            <Text
              style={[styles.summaryLine, { color: colors.textSecondary }]}
              accessibilityLabel={`${isStudyMode ? 'This session' : 'This test'}: ${summaryLine}`}
            >
              {summaryLine}
            </Text>
            {!isValid && validationHint ? (
              <Text style={[styles.validationHint, { color: colors.textSecondary }]}>
                {validationHint}
              </Text>
            ) : null}
            {onDownload ? (
              <TouchableOpacity
                style={[
                  styles.downloadButton,
                  { borderColor: colors.primary },
                  (isDownloading || effectiveMaxQuestions === 0) && styles.submitButtonDisabled,
                ]}
                onPress={handleDownload}
                disabled={isDownloading || effectiveMaxQuestions === 0}
              >
                <AppIcon name="cloud-download" size={18} color={colors.primaryText} />
                <Text style={[styles.downloadButtonText, { color: colors.primaryText }]}>
                  {isDownloading ? 'Downloading…' : 'Download for offline'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.footerButtons}>
              <TouchableOpacity style={[styles.cancelButton, { backgroundColor: colors.inputBackground }]} onPress={handleClose}>
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  isStudyMode && styles.submitButtonStudy,
                  !isValid && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={!isValid}
              >
                <AppIcon
                  name={isStudyMode ? 'book' : 'play'}
                  size={20}
                  color="#ffffff"
                />
                <Text style={styles.submitButtonText}>
                  {isStudyMode ? 'Start Studying' : 'Start Test'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
