// ===========================================
// Lantern Study Mobile - Test Screen
// ===========================================
/**
 * The tests home (`TestsList`): two tabs — Available Tests, which launches a
 * saved test through the mode sheet or the config sheet, and History, which
 * lists past sittings with retake, review and delete.
 *
 * Main exports: the default `TestScreen`.
 * Touches: testStore (`fetchTests`/`fetchAttempts`/`startTest`/
 * `startQuestionSet`/`hydrateTestFromServer`/`deleteAttempt`/`clearTestHistory`),
 * authStore, settingsStore (the default mode); services/academic
 * `getMyActiveCourses` for the History course chips and productAnalytics. The
 * decisions live in ./testConfigRules and ./testAuthoring. No native modules.
 *
 * Gotchas: there are two start paths, and they are not interchangeable —
 * `startTest` (a saved test, honours the config sheet including `lockAnswered`)
 * and `startQuestionSet` (a snapshot retake, which carries only the timer and
 * the group). Any new per-test option has to be threaded through both.
 * `defaultMinutesFor` is the single source of the minutes printed on the card,
 * shown in the mode sheet and passed to the launch; reading `test.timeLimit`
 * directly reports "No limit" for a test that merely never recorded one. A
 * timer of 0 from the config sheet means "None" and must not fall back.
 * Retake asks the server before refusing: the tests list is served lean, so
 * "no local questions" is not "gone".
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { Screen, useScreenBottomPadding, useScreenInsets, useScrollToTopRequest } from '../../components/layout';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTestStore, type Test, type TestAttempt, type TestMode } from '../../stores/testStore';
import { matchesCourseFilter, matchesTopicFilter, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import { getMyActiveCourses } from '../../services/academic';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import { pluralize } from '@lantern/shared/utils/plural';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { BRAND_INK, BRAND_TINT, brand, serifDisplayStyle, useTheme } from '../../theme';
import TestConfigModal, { type TestConfigOptions } from '../../components/TestConfigModal';
import { BackButton, Button, CourseChip, EmptyState, FeatureDisc, useFeatureAccent } from '../../components/ui';
import { normalizeApiQuestions } from '../../utils/questionHelpers';
import { trackTestStarted } from '../../services/productAnalytics';
import { AppIcon } from '../../components/ui/AppIcon';
import { formatSessionDuration } from '../../utils/testAttemptMapping';
import {
  describeStudyModeCard,
  describeTestModeCard,
  resolveTestTimeLimitMinutes,
  resolveDefaultSessionMinutes,
} from './testConfigRules';
import { planRetake, planAttemptRow, deriveTestSource } from './testAuthoring';
// Wave T: the six type steps replace this file's eleven ad-hoc sizes.
import { typeScale, tabularNums } from '../../design/typeScale';

type TabType = 'tests' | 'history';

/** The Library scope History is pinned to. A topic only ever narrows its own course. */
type HistoryFilter = {
  id: string;
  label: string;
  /** uuid, the literal 'null' (no topic in this course), or null (whole course). */
  topicId?: string | null;
  topicLabel?: string;
};

/**
 * The minutes THIS test starts with — one call, used by the mode sheet's
 * stats strip, by the launch behind Start Test, and as the config sheet's
 * opening timer. See `resolveDefaultSessionMinutes` for why all three had to
 * be the same number.
 */
const defaultMinutesFor = (test: Test): number =>
  resolveDefaultSessionMinutes({
    timerChosen: !!test.timerChosen,
    storedMinutes: test.timeLimit,
    questionCount: test.questionCount,
  });

const historyTopicLabel = (filter: HistoryFilter) =>
  filter.topicId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : filter.topicLabel || COURSE_TOPIC_COPY.filterLabel;

export default function TestScreen() {
  const navigation = useNavigation<any>();
  // Library tree deep link: { tab: 'history', courseId, courseLabel, topicId,
  // topicLabel } — courseId is a uuid or the literal 'null' (unfiled sessions),
  // topicId a uuid or 'null' (in the course, under no topic). The topic rides on
  // the course object so the pair can never drift.
  const route = useRoute<any>();
  const routeTab: TabType | undefined = route.params?.tab;
  const routeCourseId: string | null | undefined = route.params?.courseId;
  const routeCourseLabel: string | undefined = route.params?.courseLabel;
  const routeTopicId: string | null | undefined = route.params?.topicId;
  const routeTopicLabel: string | undefined = route.params?.topicLabel;
  const [activeTab, setActiveTab] = useState<TabType>(routeTab === 'history' ? 'history' : 'tests');
  /**
   * `courseId` -> the printed code ("BIO 201") for the History row chips.
   *
   * The same lookup the Library uses (`getMyActiveCourses`, already cached for
   * a minute behind every course picker), so a student can scan a mixed
   * history for one course without reading titles. A saved TEST carries no
   * course — only the sitting does — so the chip appears on History rows and
   * nowhere else.
   *
   * A failed lookup is silent: the chip is decoration on a row that reads
   * correctly without it, and History must never banner because an enrolment
   * list did not load.
   */
  const [courseCodes, setCourseCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    getMyActiveCourses()
      .then((rows) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const row of rows) {
          if (row.course?.id && row.course.code) map[row.course.id] = row.course.code;
        }
        setCourseCodes(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [historyCourse, setHistoryCourse] = useState<HistoryFilter | null>(
    routeCourseId
      ? {
          id: routeCourseId,
          label: routeCourseLabel || 'Course',
          topicId: routeTopicId || null,
          topicLabel: routeTopicLabel,
        }
      : null
  );

  useEffect(() => {
    if (routeTab === 'history' || routeTab === 'tests') setActiveTab(routeTab);
    if (routeCourseId) {
      setHistoryCourse({
        id: routeCourseId,
        label: routeCourseLabel || 'Course',
        topicId: routeTopicId || null,
        topicLabel: routeTopicLabel,
      });
    }
  }, [routeTab, routeCourseId, routeCourseLabel, routeTopicId, routeTopicLabel]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [configTest, setConfigTest] = useState<Test | null>(null);
  const [selectedMode, setSelectedMode] = useState<TestMode>('test');
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  const { user } = useAuthStore();
  const defaultTestMode = useSettingsStore(s => s.settings.study.defaultTestMode);
  const { colors } = useTheme();
  // Sky is the Tests family (spec v3 §5.6). Every hue on this screen comes
  // from this one pair — discs, the current segment, the empty panel — so
  // "which world am I in" is answered by colour and nothing else is.
  const testsAccent = useFeatureAccent('tests');
  const insets = useScreenInsets();
  // `paddingBottom: 100` was a guess at the absolutely positioned bottom tab
  // bar, which is 102px at minimum and ~118px with Android 3-button nav — so
  // the last test card was 2-18px short of clearing it.
  const listPadding = useScreenBottomPadding();
  // The contextual row's re-tap (spec v3 §7.2): pressing Tests while on Tests
  // sends whichever list is showing back to the top. One ref serves both
  // FlatLists because only one is mounted at a time (they are keyed).
  const listRef = useRef<FlatList>(null);
  useScrollToTopRequest(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  const { tests, attempts, isLoading, fetchTests, fetchAttempts, startTest, startQuestionSet, testQuestionsById, hydrateTestFromServer, deleteAttempt, clearTestHistory, recordTestTimerChoice } = useTestStore();

  const visibleAttempts = useMemo(() => {
    if (!historyCourse) return attempts;
    return attempts.filter(
      a =>
        matchesCourseFilter(a.courseId, historyCourse.id) &&
        matchesTopicFilter(a.topicId, historyCourse.topicId)
    );
  }, [attempts, historyCourse]);

  useEffect(() => {
    setSelectedMode(defaultTestMode === 'exam' ? 'test' : 'study');
  }, [defaultTestMode]);

  useEffect(() => {
    if (user?.id) {
      fetchTests(user.id);
      fetchAttempts(user.id);
    }
  }, [user?.id, fetchTests, fetchAttempts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await Promise.all([fetchTests(user.id), fetchAttempts(user.id)]);
    }
    setRefreshing(false);
  }, [user?.id, fetchTests, fetchAttempts]);

  const handleStartTest = useCallback(async (test: Test, mode: TestMode) => {
    try {
      // The SAME minutes the mode sheet printed and the config sheet opens on
      // (T4). Passing nothing let the store fall back on `test.timeLimit`,
      // which is 0 for any test saved without a timer key — so a sheet that
      // said "5 min" started a session with no countdown at all.
      await startTest(test.id, mode, {
        timeLimit: mode === 'test' ? defaultMinutesFor(test) : 0,
      });
      trackTestStarted({
        mode: mode === 'test' ? 'test' : 'study',
        questionCount: useTestStore.getState().activeTest?.questions.length ?? 0,
      });
      navigation.navigate('TestTaking', { 
        testId: test.id, 
        testName: test.name,
        mode: mode 
      });
    } catch (error) {
      appAlert('Error', 'Failed to start test');
    }
  }, [startTest, navigation]);

  // Handle advanced configuration submission
  const handleConfigSubmit = useCallback((config: TestConfigOptions, mode: TestMode) => {
    if (!configTest || !user?.id) return;
    const test = configTest;
    setShowConfigModal(false);
    setConfigTest(null);
    void startTest(test.id, mode, {
      // 0 seconds is the "None" chip, not a missing value: honour it as an
      // untimed test instead of quietly reinstating the test's own limit.
      timeLimit: resolveTestTimeLimitMinutes({
        timerDurationSeconds: config.timerDuration,
        sessionMode: mode === 'test' ? 'test' : 'study',
        fallbackMinutes: test.timeLimit,
      }),
      questionCount: config.numberOfQuestions,
      userId: user.id,
      questionTypes: config.selectedQuestionTypes.length ? config.selectedQuestionTypes : undefined,
      tags: config.selectedTags.length ? config.selectedTags : undefined,
      spacedRepetition: config.useSpacedRepetition,
      focusOnNew: config.focusOnNew,
      lockAnswered: config.lockAnswered,
      // The sheet's own answer, not the account default the store would
      // otherwise reach for: the summary line above Start said "shuffled".
      shuffleQuestions: config.shuffleQuestions,
      courseId: config.courseId ?? null,
      topicId: config.topicId ?? null,
    }).then(() => {
      trackTestStarted({
        mode: mode === 'test' ? 'test' : 'study',
        questionCount: useTestStore.getState().activeTest?.questions.length ?? 0,
      });
      navigation.navigate('TestTaking', {
        testId: test.id,
        testName: test.name,
        mode,
      });
    }).catch(() => {
      appAlert('Error', 'Failed to start test');
    });
  }, [configTest, user?.id, startTest, navigation]);

  const configTags = useMemo(() => {
    if (!configTest) return [] as string[];
    const tags = new Set<string>();
    (testQuestionsById[configTest.id] || []).forEach(q => q.tags?.forEach(t => tags.add(t)));
    return Array.from(tags);
  }, [configTest, testQuestionsById]);

  /**
   * Retake, through the planner in `testAuthoring.ts`.
   *
   * The middle step is the whole fix. `GET /tests` is served lean, so a row in
   * History has a source test with NO questions cached against it, and the old
   * handler read that as "gone" — every retake on build 161 refused, including
   * a result from the day before. The plan asks the server first
   * (`hydrateTestFromServer` → `GET /tests/:id`) and only refuses when that
   * comes back empty, with a different sentence when the fetch itself failed.
   */
  const handleRetake = useCallback(async (attempt: TestAttempt) => {
    const questions = normalizeApiQuestions(
      attempt.answers
        .map(a => a.questionSnapshot)
        .filter((q): q is NonNullable<typeof q> => !!q)
    );

    const sessionName = attempt.testName || 'Retake';
    const sourceTestId = attempt.originalTestId || attempt.testId || null;

    const launchSnapshot = async () => {
      await startQuestionSet(sessionName, questions, 'test', {
        // An attempt that recorded "None" (0) retakes untimed.
        timeLimitMinutes: attempt.timeLimitMinutes ?? 0,
        groupId: attempt.groupId,
        groupName: attempt.groupName,
      });
      navigation.navigate('TestTaking', {
        testId: 'custom',
        testName: sessionName,
        mode: 'test',
        groupName: attempt.groupName,
        groupId: attempt.groupId,
      });
    };

    const launchTest = async (testId: string) => {
      const sourceTest = useTestStore.getState().tests.find(t => t.id === testId);
      try {
        await startTest(testId, 'test', {
          // Only an attempt with NO recorded timer falls back on the test's.
          timeLimit: attempt.timeLimitMinutes ?? sourceTest?.timeLimit,
          userId: user?.id,
          groupId: attempt.groupId,
          groupName: attempt.groupName,
        });
        navigation.navigate('TestTaking', {
          testId,
          testName: sourceTest?.name || sessionName,
          mode: 'test',
          groupName: attempt.groupName,
          groupId: attempt.groupId,
        });
      } catch {
        appAlert('Error', 'Failed to start test');
      }
    };

    const localCount = (testId: string) =>
      (useTestStore.getState().testQuestionsById[testId] || []).length;

    let plan = planRetake({
      snapshotCount: questions.length,
      sourceTestId,
      localQuestionCount: sourceTestId ? localCount(sourceTestId) : 0,
    });

    if (plan.action === 'fetchTest') {
      let fetchFailed = false;
      try {
        await hydrateTestFromServer(plan.testId);
      } catch {
        fetchFailed = true;
      }
      plan = planRetake({
        snapshotCount: questions.length,
        sourceTestId,
        localQuestionCount: localCount(plan.testId),
        fetchAttempted: true,
        fetchFailed,
      });
    }

    if (plan.action === 'launchSnapshot') return launchSnapshot();
    if (plan.action === 'launchTest') return launchTest(plan.testId);
    if (plan.action === 'refuse') appAlert(plan.title, plan.message);
  }, [startQuestionSet, startTest, hydrateTestFromServer, navigation, user?.id]);

  const handleViewAttempt = useCallback((attempt: TestAttempt) => {
    navigation.navigate('TestResults', { attemptId: attempt.id });
  }, [navigation]);

  const handleDeleteAttempt = useCallback((attempt: TestAttempt) => {
    if (!user?.id) return;
    appAlert(
      'Delete test result?',
      `Remove "${attempt.testName}" from your history? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAttempt(user.id, attempt.id).catch(() => {
              appAlert('Error', 'Failed to delete test result.');
            });
          },
        },
      ]
    );
  }, [user?.id, deleteAttempt]);

  /**
   * The New test door.
   *
   * It used to switch the GLOBAL tab to Chat — the temporary group-quiz
   * wiring — so pressing a button on the Study tab silently moved the student
   * to another destination with no way to tell why. It now pushes a real
   * screen onto the Study stack, which offers the group as one of three
   * sources and says out loud that choosing it opens the chat.
   */
  const handleNewTest = useCallback(() => {
    navigation.navigate('TestBuilder');
  }, [navigation]);

  const handleClearHistory = useCallback(() => {
    if (!user?.id || attempts.length === 0) return;
    appAlert(
      'Clear test history?',
      'Delete all completed test history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            void clearTestHistory(user.id)
              .then(() => fetchAttempts(user.id))
              .catch(() => {
                appAlert('Error', 'Failed to clear test history.');
              });
          },
        },
      ]
    );
  }, [user?.id, attempts.length, clearTestHistory, fetchAttempts]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };


  /**
   * "From SDOH" under a saved test, and in the mode sheet's subtitle.
   *
   * Read from EVERY source the row records, not `deckName` alone: a test
   * generated from a note has no deck, so the line was omitted entirely and
   * the sheet fell through to the bare "Saved test" for a quiz that plainly
   * came from a note. `sourceNoteId` rides only when a title rides with it —
   * a linkable source with no name resolves to "From this note", which is
   * worse than the note's own name read off the test's title.
   */
  const testSourceLabel = useCallback(
    (test: Test): string | null =>
      deriveTestSource({
        noteId: test.sourceNoteTitle ? test.sourceNoteId : undefined,
        noteTitle: test.sourceNoteTitle,
        deckId: test.deckId,
        deckName: test.deckName,
        testTitle: test.name,
      })?.label ?? null,
    []
  );

  const renderTestItem = useCallback(({ item }: { item: Test }) => (
    <TouchableOpacity
      style={[styles.testCard, { backgroundColor: colors.card }]}
      onPress={() => setSelectedTest(item)}
      activeOpacity={0.7}
    >
      {/* The sky disc says "this is a test" in one shape; the row itself
          stays neutral, which is what keeps a long list inside the 4-6%
          chromatic budget for a list. */}
      <FeatureDisc feature="tests" icon="document-text" size={40} />
      <View style={{ width: 12 }} />
      
      <View style={styles.testInfo}>
        <Text style={[styles.testName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
        {/* Never "From undefined": a note quiz has no deck and no group, and
            the row said so out loud (D3). `testSourceLabel` omits the line
            when there is no source to name. */}
        {/* "From Quiz · SDOH" attributed the test to a note that does not
            exist — the "Quiz · " belongs to the test's own old title, not to
            its source (T3). Display-time only. */}
        {item.description || testSourceLabel(item) ? (
          <Text style={[styles.testDescription, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.description || testSourceLabel(item)}
          </Text>
        ) : null}
        
        <View style={styles.testMeta}>
          <View style={styles.metaItem}>
            <AppIcon name="help-circle" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{pluralize(item.questionCount, 'question')}</Text>
          </View>
          <View style={styles.metaItem}>
            <AppIcon name="time" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {/* The SAME number the mode sheet's strip and the launch use.
                  Reading `timeLimit` straight said "No limit" for a test that
                  had merely never recorded one, and which the config sheet
                  then opened at a minute per question (T4). */}
              {defaultMinutesFor(item) > 0 ? `${defaultMinutesFor(item)} min` : 'No limit'}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <AppIcon name="checkmark-circle" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.passingScore}% to pass</Text>
          </View>
        </View>
      </View>
      
      <AppIcon name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  ), [colors, testSourceLabel]);

  const renderAttemptItem = useCallback(({ item }: { item: TestAttempt }) => {
    const rowPlan = planAttemptRow({ mode: item.mode, passed: item.passed });
    // Where it came from, said as text. A group names itself; everything else
    // is read out of the test's own title, which is the only place a note
    // test records its note — and the prefix is stripped, so this reads
    // "From SDOH" and never "From Test · SDOH" (T3).
    const rowSource = deriveTestSource({
      groupId: item.groupId,
      groupName: item.groupName,
      testTitle: item.testName,
    });
    return (
    <View style={[styles.attemptCard, { backgroundColor: colors.card }]}>
      <TouchableOpacity
        style={styles.attemptMain}
        onPress={() => handleViewAttempt(item)}
        activeOpacity={0.7}
      >
        {/* The disc says WHAT this is (a test), not how it went: a row that
            paints itself green or red at 40px reads as a verdict on the
            student. Pass/fail is said below, in a word, with its own glyph. */}
        <FeatureDisc feature="tests" icon="document-text" size={40} />
        <View style={{ width: 12 }} />
        
        <View style={styles.attemptInfo}>
          {/* What it is ABOUT, printed once at the right edge. Neutral by
              design: the sky disc already spends this row's hue on what the
              thing IS (spec v3 §5.6). No course, no chip. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text
              style={[styles.attemptName, { color: colors.text, flex: 1 }]}
              numberOfLines={1}
            >
              {item.testName}
            </Text>
            <CourseChip code={item.courseId ? courseCodes[item.courseId] : undefined} />
          </View>
          {rowSource ? (
            <Text style={[styles.attemptSource, { color: colors.textSecondary }]} numberOfLines={1}>
              {rowSource.label}
            </Text>
          ) : null}
          <Text style={[styles.attemptDate, { color: colors.textSecondary }]}>{formatDate(item.completedAt || item.startedAt)}</Text>
          
          {/* Score as TEXT plus a 4px rail (spec v3 §5.7). The tinted pill it
              replaced spent a saturated fill on every row of the list; the
              rail carries the same figure as a length, which is the thing a
              student actually compares between attempts. */}
          <View style={styles.attemptStats}>
            <Text style={[styles.scoreText, { color: colors.text }]}>
              {item.percentage}%
            </Text>
            {/* Practice and exam are different sittings and the row says which
                (T2): practice is untimed and gives feedback as you go, so its
                percentage does not mean what an exam's does. */}
            {/* One planner decides both, so the chip and the verdict cannot
                disagree: a practice row shows the chip and NO pass/fail — it
                has no pass mark to miss, and a red ✗ on an untimed run with
                feedback is a verdict on the reason to practise at all (T2). */}
            {rowPlan.showPracticeChip ? (
              <View style={[styles.attemptPracticeChip, { backgroundColor: colors.backgroundSecondary }]}>
                <AppIcon name="book" size={12} color={colors.textSecondary} importantForAccessibility="no" />
                <Text style={[styles.attemptMeta, { color: colors.textSecondary }]}>Practice</Text>
              </View>
            ) : null}
            {rowPlan.verdict ? (
              <View style={styles.attemptVerdict}>
                <AppIcon
                  name={rowPlan.verdict === 'passed' ? 'checkmark-circle' : 'close-circle'}
                  size={14}
                  color={rowPlan.verdict === 'passed' ? colors.success : colors.error}
                  importantForAccessibility="no"
                />
                <Text
                  style={[
                    styles.attemptMeta,
                    { color: rowPlan.verdict === 'passed' ? colors.success : colors.error },
                  ]}
                >
                  {rowPlan.verdict === 'passed' ? 'Passed' : 'Not passed'}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.attemptMeta, { color: colors.textSecondary }]}>
              {/* A sitting with no recorded time reads "—", not "0:00": the
                  row used to claim every attempt took no time at all until
                  its result was opened. */}
              {item.score}/{item.totalPoints} pts • {formatSessionDuration(item.timeSpent || null)}
            </Text>
          </View>
          <View
            style={[styles.scoreRailTrack, { backgroundColor: colors.border }]}
            importantForAccessibility="no-hide-descendants"
          >
            <View
              style={[
                styles.scoreRailFill,
                {
                  width: `${Math.max(0, Math.min(100, item.percentage))}%`,
                  backgroundColor: testsAccent.ink,
                },
              ]}
            />
          </View>
        </View>
        
        <AppIcon name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.attemptActions}>
        <TouchableOpacity
          style={[styles.retakeButton, { borderColor: colors.border, flex: 1 }]}
          onPress={() => void handleRetake(item)}
          activeOpacity={0.7}
        >
          <AppIcon name="refresh" size={16} color={colors.primaryText} />
          <Text style={[styles.retakeButtonText, { color: colors.primaryText }]}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteHistoryButton, { borderColor: colors.border }]}
          onPress={() => handleDeleteAttempt(item)}
          activeOpacity={0.7}
        >
          <AppIcon name="trash" size={16} color="#ef4444" />
          <Text style={styles.deleteHistoryButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
    );
  }, [handleViewAttempt, handleRetake, handleDeleteAttempt, colors, courseCodes, testsAccent.ink]);

  /**
   * The empty state: the shared `EmptyState` card — a neutral panel with ONE
   * sky-tint band across its top (spec v3 §5.6 "Empty state"), a benefit
   * rather than a restatement of the emptiness, one sentence, and — on the
   * Available tab — one action. It replaced a full-tint panel that painted
   * roughly 40% of the viewport in sky; the band is about 6%.
   *
   * That action now opens a real door: TestBuilder, on this same stack, with
   * the three sources a test can come from. It used to be a button that
   * switched the global tab to Chat, because a group was the only place a
   * test was authored — which is exactly what this wave replaced.
   */
  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <EmptyState
        feature="tests"
        icon={activeTab === 'tests' ? 'document-text' : 'time'}
        // Only the Available tab gets the picture. History's emptiness is
        // usually a FILTER result ("nothing under this topic yet"), and a
        // hero illustration on a filtered list reads as if the whole feature
        // were empty.
        illustration={activeTab === 'tests' ? 'test-sheet' : undefined}
        title={activeTab === 'tests' ? 'Practise before it counts' : 'Every score you have earned'}
        description={
          activeTab === 'tests'
            ? 'Timed, scored and repeatable — the closest thing to sitting the real one.'
            : historyCourse
              ? historyCourse.topicId
                ? `Nothing under ${historyTopicLabel(historyCourse)} in ${historyCourse.label} yet — pick the topic when you start a test.`
                : `Nothing filed under ${historyCourse.label} yet — pick the course when you start a test.`
              : 'Completed tests land here. Tap a result to review answers or retake.'
        }
        action={
          activeTab === 'tests' ? (
            <TouchableOpacity
              onPress={handleNewTest}
              activeOpacity={0.8}
              style={[styles.emptyAction, { backgroundColor: testsAccent.ink }]}
              accessibilityRole="button"
              accessibilityLabel="New test. Choose a deck, a note, or your group."
            >
              <AppIcon name="add" size={16} color={colors.card} importantForAccessibility="no" />
              <Text style={[styles.emptyActionText, { color: colors.card }]}>New test</Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  ), [activeTab, colors, historyCourse, testsAccent, handleNewTest]);

  return (
    <Screen edges={['top']} bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: -9, marginRight: 4 }} />
          <Text style={[styles.headerTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>Tests</Text>
          {activeTab === 'history' && attempts.length > 0 ? (
            <TouchableOpacity onPress={handleClearHistory} style={styles.clearHistoryButton}>
              <Text style={[styles.clearHistoryText, { color: '#ef4444' }]}>Clear History</Text>
            </TouchableOpacity>
          ) : null}
          {/* The New test door, in the header and UNCONDITIONAL.
              It previously existed only inside the empty state, and only on
              the Available tab — so the moment a student had one test, or was
              looking at History, TestBuilder had no entrance anywhere in the
              app (device finding T1, build 162). A door that disappears as
              soon as the shelf is non-empty is not a door. */}
          {/* The shared primary pill, not a hand-rolled `primaryFill` one: the
              direction's primary is the page's INK under its ground (black in
              light, white in dark) and this was the last indigo fill on the
              Tests root. `Button` renders non-string children as given, so the
              glyph and the word are painted in the same `background` the
              primitive's own label uses. */}
          <Button
            variant="primary"
            size="sm"
            onPress={handleNewTest}
            accessibilityLabel="New test. Choose a deck, a note, or your group."
            testID="tests-new-test"
          >
            <AppIcon
              name="add"
              size={16}
              color={colors.background}
              importantForAccessibility="no"
            />
            <Text style={[styles.newTestButtonText, { color: colors.background }]}>New test</Text>
          </Button>
        </View>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          Review scores in History · Launch saved tests under Available Tests
        </Text>
      </View>

      {/* Tabs */}
      {/* Available / History: a segmented control whose current segment is a
          sky TINT with its label in sky ink — the feature's own hue, not the
          app's indigo, and a filled shape rather than a colour swap alone.
          `+ '20'` on a hex was an 8-digit RGBA the theme never defined. */}
      <View
        style={[styles.tabContainer, { backgroundColor: colors.card }]}
        accessibilityRole="tablist"
      >
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tests' && { backgroundColor: testsAccent.tint }]}
          onPress={() => setActiveTab('tests')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'tests' }}
        >
          <Text
            style={[
              styles.tabText,
              { color: colors.textSecondary },
              activeTab === 'tests' && { color: testsAccent.ink, fontWeight: '700' },
            ]}
          >
            Available Tests
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && { backgroundColor: testsAccent.tint }]}
          onPress={() => setActiveTab('history')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'history' }}
        >
          <Text
            style={[
              styles.tabText,
              { color: colors.textSecondary },
              activeTab === 'history' && { color: testsAccent.ink, fontWeight: '700' },
            ]}
          >
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* Library course filter (deep link from the Library tree) */}
      {activeTab === 'history' && historyCourse ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: colors.primaryFill + '20',
              maxWidth: historyCourse.topicId ? '50%' : '70%',
            }}
          >
            <AppIcon name="school" size={14} color={colors.primaryText} />
            <Text style={{ ...typeScale.caption, fontWeight: '600', color: colors.primaryText, flexShrink: 1 }} numberOfLines={1}>
              {historyCourse.label}
            </Text>
            <TouchableOpacity
              onPress={() => setHistoryCourse(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Clear course filter ${historyCourse.label}`}
            >
              <AppIcon name="close-circle" size={16} color={colors.primaryText} />
            </TouchableOpacity>
          </View>
          {/* The topic narrows the list further, so it gets its own chip: a
              scope the student cannot see reads as missing results. */}
          {historyCourse.topicId ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: colors.backgroundSecondary,
                maxWidth: '40%',
              }}
            >
              <AppIcon name="bookmark" size={13} color={colors.textSecondary} />
              <Text style={{ ...typeScale.caption, color: colors.textSecondary, flexShrink: 1 }} numberOfLines={1}>
                {historyTopicLabel(historyCourse)}
              </Text>
              <TouchableOpacity
                // Clear the topic, keep the course.
                onPress={() => setHistoryCourse({ id: historyCourse.id, label: historyCourse.label })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Clear topic filter ${historyTopicLabel(historyCourse)}`}
              >
                <AppIcon name="close-circle" size={15} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={{ ...typeScale.caption, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
            {visibleAttempts.length} of {attempts.length} results
          </Text>
        </View>
      ) : null}

      {/* List */}
      {activeTab === 'tests' ? (
        <FlatList
          key="tests-list"
          ref={listRef}
          data={tests}
          keyExtractor={(item) => item.id}
          renderItem={renderTestItem}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={[styles.listContent, { paddingBottom: listPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={brand.text}
              colors={[brand.text]}
            />
          }
        />
      ) : (
        <FlatList
          key="history-list"
          ref={listRef}
          data={visibleAttempts}
          keyExtractor={(item) => item.id}
          renderItem={renderAttemptItem}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={[styles.listContent, { paddingBottom: listPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={brand.text}
              colors={[brand.text]}
            />
          }
        />
      )}

      {/* Test Detail Modal */}
      <Modal
        visible={!!selectedTest}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedTest(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 40 }, { backgroundColor: colors.card }]}>
            {selectedTest && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIcon, { backgroundColor: colors.primaryBackground }]}>
                    <AppIcon name="document-text" size={32} color={colors.primaryText} />
                  </View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>{selectedTest.name}</Text>
                  <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
                    {selectedTest.description || testSourceLabel(selectedTest) || 'Saved test'}
                  </Text>
                </View>

                {/* Mode Selection */}
                <View style={styles.modeSection}>
                  <Text style={[styles.modeSectionTitle, { color: colors.textSecondary }]}>Choose Mode</Text>
                  <View style={styles.modeOptions}>
                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        { backgroundColor: colors.background, borderColor: colors.border },
                        selectedMode === 'test' && { borderColor: colors.primary, backgroundColor: colors.primaryBackground }
                      ]}
                      onPress={() => setSelectedMode('test')}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.modeIconContainer,
                        { backgroundColor: colors.card },
                        selectedMode === 'test' && { backgroundColor: colors.primaryFill }
                      ]}>
                        <AppIcon 
                          name="timer" 
                          size={28} 
                          color={selectedMode === 'test' ? '#ffffff' : colors.primary} 
                        />
                      </View>
                      <Text style={[
                        styles.modeTitle,
                        { color: colors.text },
                        selectedMode === 'test' && { color: colors.primaryText }
                      ]}>Test Mode</Text>
                      {/* The SAME minutes the strip below and the launch use:
                          the card used to promise "Timed" beside a strip that
                          said "No limit" for the same test. */}
                      <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                        {describeTestModeCard(defaultMinutesFor(selectedTest))}
                      </Text>
                      {selectedMode === 'test' && (
                        <View style={styles.modeCheck}>
                          <AppIcon name="checkmark-circle" size={20} color={colors.primaryText} />
                        </View>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        { backgroundColor: colors.background, borderColor: colors.border },
                        selectedMode === 'study' && { borderColor: '#10b981', backgroundColor: '#10b98110' }
                      ]}
                      onPress={() => setSelectedMode('study')}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.modeIconContainer,
                        { backgroundColor: colors.card },
                        selectedMode === 'study' && { backgroundColor: '#10b981' }
                      ]}>
                        <AppIcon 
                          name="book" 
                          size={28} 
                          color={selectedMode === 'study' ? '#ffffff' : '#10b981'} 
                        />
                      </View>
                      <Text style={[
                        styles.modeTitle,
                        { color: colors.text },
                        selectedMode === 'study' && { color: '#10b981' }
                      ]}>Study Mode</Text>
                      <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                        {describeStudyModeCard()}
                      </Text>
                      {selectedMode === 'study' && (
                        <View style={styles.modeCheck}>
                          <AppIcon name="checkmark-circle" size={20} color="#10b981" />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* The stats strip.
                    It used to paint itself #000000 and then have its figures
                    overridden to `colors.text` — dark navy on black in light
                    mode, effectively unreadable (T4). The panel is a theme
                    surface now, and every glyph on it a text token. */}
                <View style={[styles.modalStats, { backgroundColor: colors.backgroundSecondary }]}>
                  <View style={styles.modalStatItem}>
                    <AppIcon name="help-circle" size={24} color={colors.primaryText} />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>{selectedTest.questionCount}</Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Questions</Text>
                  </View>
                  <View style={styles.modalStatItem}>
                    <AppIcon
                      name={selectedMode === 'test' && defaultMinutesFor(selectedTest) > 0 ? 'time' : 'infinite'}
                      size={24}
                      color="#f97316"
                    />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      {selectedMode === 'test' && defaultMinutesFor(selectedTest) > 0
                        ? defaultMinutesFor(selectedTest)
                        : '∞'
                      }
                    </Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>
                      {selectedMode === 'test' && defaultMinutesFor(selectedTest) > 0 ? 'Minutes' : 'No limit'}
                    </Text>
                  </View>
                  <View style={styles.modalStatItem}>
                    <AppIcon 
                      name={selectedMode === 'test' ? 'trophy' : 'bulb'} 
                      size={24} 
                      color="#10b981" 
                    />
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      {selectedMode === 'test' ? `${selectedTest.passingScore}%` : 'Learn'}
                    </Text>
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>
                      {selectedMode === 'test' ? 'To Pass' : 'Focus'}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => {
                      setSelectedTest(null);
                      setSelectedMode('test'); // Reset to default
                    }}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.startButton,
                      { backgroundColor: colors.primaryFill },
                      selectedMode === 'study' && styles.startButtonStudy
                    ]}
                    onPress={() => {
                      const test = selectedTest;
                      const mode = selectedMode;
                      setSelectedTest(null);
                      setSelectedMode('test'); // Reset to default
                      handleStartTest(test, mode);
                    }}
                  >
                    <AppIcon 
                      name={selectedMode === 'test' ? 'play' : 'book'} 
                      size={20} 
                      color="#ffffff" 
                    />
                    <Text style={styles.startButtonText}>
                      {selectedMode === 'test' ? 'Start Test' : 'Start Study'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Advanced Configuration Link */}
                <TouchableOpacity 
                  style={styles.advancedLink}
                  onPress={() => {
                    if (!selectedTest) return;
                    setConfigTest(selectedTest);
                    setShowConfigModal(true);
                    setSelectedTest(null);
                  }}
                >
                  <AppIcon name="settings" size={16} color={brand.text} />
                  <Text style={styles.advancedLinkText}>Configure test</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Advanced Test Configuration Modal */}
      {configTest && (
        <TestConfigModal
          visible={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            setConfigTest(null);
          }}
          // Both exits, Start and Cancel/×: the sheet reports the timer and it
          // is written onto this test, so reopening shows the last choice
          // rather than the auto rule (T4).
          onTimerChoice={minutes => void recordTestTimerChoice(configTest.id, minutes)}
          onSubmit={handleConfigSubmit}
          mode={selectedMode}
          maxQuestions={configTest.questionCount || 10}
          availableTags={configTags}
          testName={configTest.name || ''}
          // One answer for "how long does this run", shared with the mode
          // sheet's strip and with Start Test itself (T4).
          defaultTimerMinutes={configTest.timerChosen ? defaultMinutesFor(configTest) : undefined}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  clearHistoryButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  attemptPracticeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  // The pill itself is `Button`'s now (height, radius and padding included);
  // only the word's step survives here, and its colour is passed at the call
  // site because it is the theme's ground, not a fixed white.
  newTestButtonText: {
    ...typeScale.body,
    fontWeight: '700',
  },
  clearHistoryText: {
    ...typeScale.body,
    fontWeight: '600',
  },
  headerTitle: {
    ...typeScale.display,
    // The screen's h1 is a DISPLAY role, so it is the serif (theme/fonts.ts).
    // It rendered sans here while the headings inside the page were Bitter —
    // the "serif one level too deep" finding. `serifDisplayStyle` also resets
    // the weight, which the face itself carries.
    ...serifDisplayStyle(),
    color: '#ffffff',
  },
  headerSubtitle: {
    ...typeScale.body,
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#1a1d21',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabText: {
    ...typeScale.body,
    fontWeight: '600',
    color: '#9ca3af',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  testCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1d21',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  testInfo: {
    flex: 1,
  },
  testName: {
    ...typeScale.heading,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  testDescription: {
    ...typeScale.body,
    color: '#9ca3af',
    marginBottom: 8,
  },
  testMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    ...typeScale.caption,
    color: '#6b7280',
  },
  attemptCard: {
    backgroundColor: '#1a1d21',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  attemptMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attemptInfo: {
    flex: 1,
  },
  attemptName: {
    ...typeScale.heading,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  attemptSource: {
    ...typeScale.caption,
    marginBottom: 2,
  },
  attemptDate: {
    ...typeScale.caption,
    color: '#6b7280',
    marginBottom: 8,
  },
  attemptStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attemptVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  /** 4px is the rail everywhere in this app: a measure, never a fill. */
  scoreRailTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  scoreRailFill: {
    height: 4,
    borderRadius: 2,
  },
  scoreText: {
    ...typeScale.body,
    ...tabularNums,
    fontWeight: '700',
  },
  attemptMeta: {
    ...typeScale.caption,
    color: '#9ca3af',
  },
  attemptActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  retakeButtonText: {
    ...typeScale.body,
    fontWeight: '600',
  },
  deleteHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  deleteHistoryButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: '#ef4444',
  },
  emptyContainer: {
    paddingTop: 24,
  },
  /** The one saturated fill on the screen, and it is a 44 dp control. */
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    minHeight: 44,
  },
  emptyActionText: {
    ...typeScale.body,
    fontWeight: '700',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1d21',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: BRAND_TINT,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    ...typeScale.title,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalDescription: {
    ...typeScale.body,
    color: '#9ca3af',
    textAlign: 'center',
  },
  modalStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 16,
  },
  modalStatItem: {
    alignItems: 'center',
  },
  modalStatValue: {
    ...typeScale.title,
    ...tabularNums,
    fontWeight: 'bold',
    marginTop: 8,
  },
  modalStatLabel: {
    ...typeScale.caption,
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  cancelButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: '#ffffff',
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    backgroundColor: BRAND_INK,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonStudy: {
    backgroundColor: '#10b981',
  },
  startButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Mode selection styles
  modeSection: {
    marginBottom: 20,
  },
  modeSectionTitle: {
    ...typeScale.heading,
    fontWeight: '600',
    marginBottom: 12,
  },
  modeOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  modeOption: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  modeOptionActive: {
    borderColor: BRAND_INK,
    backgroundColor: '#1a1d21',
  },
  modeIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a1d21',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modeIconContainerActive: {
    backgroundColor: BRAND_INK,
  },
  modeTitle: {
    ...typeScale.body,
    fontWeight: '700',
    color: '#9ca3af',
    marginBottom: 6,
  },
  modeTitleActive: {
    color: '#ffffff',
  },
  modeDescription: {
    ...typeScale.caption,
    color: '#6b7280',
    textAlign: 'center',
  },
  modeCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  advancedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  advancedLinkText: {
    ...typeScale.body,
    color: BRAND_INK,
    fontWeight: '500',
  },
});
