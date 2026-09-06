// ===========================================
// Lantern Study Mobile - Test Results Screen
// ===========================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { useRoute, useNavigation, useIsFocused, RouteProp } from '@react-navigation/native';
import { useTestStore, type TestQuestion } from '../../stores/testStore';
import { formatCorrectAnswerDisplay, normalizeApiQuestions } from '../../utils/questionHelpers';
import { useAuthStore } from '../../stores/authStore';
import { useTheme, type ThemeColors } from '../../theme';
import AIExplainModal from '../../components/AIExplainModal';
import AIUsageBadge from '../../components/AIUsageBadge';
import {
  buildAnalysisFromAttempt,
  normalizeRecentTest,
} from '../../utils/testAnalysisHelpers';
import type { RecentTest } from '../../types/dashboardStats';
import { AppIcon } from '../../components/ui/AppIcon';
// Wave T: the six type steps replace this file's eleven ad-hoc sizes. The
// score numeral is `display` + tabular-nums so it does not reflow as it lands.
import { typeScale, tabularNums } from '../../design/typeScale';
import { TAB_STACK_ROOT_ROUTE } from '../../navigation/tabPressBehavior';
import { toTab } from '../../navigation/nestedTab';
import {
  planExitToTestsList,
  planRetakeFromResults,
  planTestExit,
  type ReturnToTabPlan,
  type ReturnToTarget,
} from './testSessionExit';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TestResultsRouteParams = {
  TestResults: {
    attemptId: string;
    /**
     * Threaded here by TestTaking when the session was launched from another
     * tab. Done, the header's back arrow and hardware BACK then return to
     * that thread instead of dropping the reader on the Study tab.
     */
    returnTo?: ReturnToTarget;
  };
};

export default function TestResultsScreen() {
  const route = useRoute<RouteProp<TestResultsRouteParams, 'TestResults'>>();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { attemptId, returnTo } = route.params;
  const { colors } = useTheme();
  // Styles were hardcoded dark, so results stayed dark in light mode.
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { attempts, tests, startQuestionSet, startTest, hydrateAttemptDetail } = useTestStore();
  const { user } = useAuthStore();
  // Guards a double-tap while the store is assembling the new session.
  const [startingRetake, setStartingRetake] = useState(false);
  // Called above the early return so hook order is stable. It reads the
  // app-root provider (this component's own SafeAreaProvider is inside the
  // returned tree), which reports 0 in a fullScreenModal window — the
  // primitive falls back to initialWindowMetrics there.
  const actionsPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 20 });

  // A lean results row carries no per-question detail, so pull the full session
  // when this attempt has no answers to show.
  useEffect(() => {
    void hydrateAttemptDetail(attemptId);
  }, [attemptId, hydrateAttemptDetail]);

  // AI Explain state
  const [showExplain, setShowExplain] = useState(false);
  const [explainData, setExplainData] = useState<{
    question: string;
    userAnswer: string;
    correctAnswer: string;
    options?: string[];
  } | null>(null);

  const attempt = useMemo(() => {
    return attempts.find(a => a.id === attemptId);
  }, [attempts, attemptId]);

  const failedQuestions = useMemo((): TestQuestion[] => {
    if (!attempt) return [];
    return attempt.answers
      .filter(a => !a.isCorrect && a.questionSnapshot)
      .map(a => a.questionSnapshot!);
  }, [attempt]);

  /**
   * "Try Again" relaunches the SAME session; these three memos are its inputs.
   *
   * The button used to call `exitToTestsList` — Done's handler — so it just
   * left the results. It now goes through the same two-step launch the tests
   * list's own Retake uses (snapshots first, source test second), which is
   * what keeps one time-limit rule across every launch path.
   */
  const retakeQuestions = useMemo((): TestQuestion[] => {
    if (!attempt) return [];
    return normalizeApiQuestions(
      attempt.answers
        .map(a => a.questionSnapshot)
        .filter((q): q is NonNullable<typeof q> => !!q)
    );
  }, [attempt]);

  const retakeSourceTest = useMemo(() => {
    if (!attempt) return null;
    const lookupId = attempt.originalTestId || attempt.testId;
    return tests.find(t => t.id === lookupId) ?? null;
  }, [attempt, tests]);

  const retakePlan = useMemo(() => planRetakeFromResults({
    attempt,
    snapshotCount: retakeQuestions.length,
    sourceTest: retakeSourceTest,
    // A retake is the same excursion out of the thread; the planner puts the
    // origin into the relaunched session's params so the fix survives it.
    returnTo,
  }), [attempt, retakeQuestions.length, retakeSourceTest, returnTo]);

  const analysisTest = useMemo((): RecentTest | null => {
    if (!attempt || attempt.answers.length === 0) return null;
    return normalizeRecentTest({
      id: attempt.id,
      groupName: attempt.groupName || attempt.testName,
      score: attempt.answers.filter(a => a.isCorrect).length,
      totalQuestions: attempt.answers.length,
      percentage: attempt.percentage,
      completedAt: attempt.completedAt || attempt.startedAt,
      timeSpent: attempt.timeSpent,
      analysis: buildAnalysisFromAttempt(attempt),
    });
  }, [attempt]);

  const openDetailedAnalysis = () => {
    if (!attempt) return;
    // Stack screen — never nest RN Modal inside this fullScreenModal.
    navigation.navigate('TestAnalysis', {
      test: analysisTest ?? {
        id: attempt.id,
        groupName: attempt.groupName || attempt.testName,
        score: attempt.score,
        totalQuestions: attempt.totalPoints || attempt.answers.length,
        percentage: attempt.percentage,
        completedAt: attempt.completedAt || attempt.startedAt,
        timeSpent: attempt.timeSpent,
        analysis: {
          correctCount: 0,
          incorrectCount: 0,
          unattemptedCount: 0,
          timePerQuestion: [],
          timePerTag: [],
          tagPerformance: [],
        },
      },
      sessionId: attempt.id,
      attemptId: attempt.id,
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const formatAnswer = (
    answer: string | string[] | Record<string, string> | undefined,
    snapshot?: TestQuestion
  ): string => {
    if (!answer) return '(No answer)';
    if (typeof answer === 'string') {
      if (snapshot?.diagramLabels) {
        const label = snapshot.diagramLabels.find(l => l.id === answer);
        if (label?.label) return label.label;
      }
      return answer;
    }
    if (Array.isArray(answer)) return answer.join(', ');
    if (snapshot?.diagramLabels) {
      return Object.values(answer)
        .map(value => snapshot.diagramLabels?.find(l => l.id === value)?.label || value)
        .join(', ');
    }
    if (snapshot?.matchingPairs?.length) {
      return Object.entries(answer)
        .map(([left, right]) => `${left} → ${right}`)
        .join('; ');
    }
    return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * Clear Study, then land in the tab this session was launched from.
   *
   * Order matters and so does capturing the parent first: the reset unmounts
   * this screen, and `getParent()` afterwards is not something to lean on.
   * Resetting BEFORE the tab switch is the round-4 invariant — a bare
   * `navigate('ChatTab', …)` would leave these results sitting on the Study
   * tab, alive long after their session is gone.
   */
  const performReturnToTab = useCallback(
    (plan: ReturnToTabPlan) => {
      const parent = navigation.getParent?.();
      navigation.reset({ index: 0, routes: plan.routes.map((name: string) => ({ name })) });
      parent?.navigate?.(plan.returnTo.tab, toTab(plan.returnTo.screen, plan.returnTo.params));
    },
    [navigation]
  );

  /**
   * Back out of the results without stranding them.
   *
   * Submitting from a session that was itself the Study stack's only route
   * (nested navigate from Home, a group chat or the offline screen) leaves
   * THIS screen as the only route — `replace` swaps one for one. A plain
   * `goBack()` there is unhandled by this stack, escapes to the tab navigator
   * and lands on Home with the results still mounted as the Study root. Pop
   * when something of ours is below; otherwise reset onto StudyHub.
   */
  const dismissResults = () => {
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
      performReturnToTab(plan);
      return;
    }
    navigation.reset({ index: 0, routes: plan.routes.map((name: string) => ({ name })) });
  };

  /**
   * Hardware BACK, when this session came out of a chat thread.
   *
   * Without this it pops the Study stack — landing on whatever the launcher
   * left underneath (the Study hub), which is the tab the reader never chose.
   * Same handler as Done: with a `returnTo` both planners agree on the one
   * answer, so the two buttons and the gesture cannot drift apart.
   *
   * Focus-scoped: TestAnalysis is PUSHED above these results, and BACK there
   * belongs to that screen.
   */
  useEffect(() => {
    if (!returnTo || !isFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissResults();
      return true;
    });
    return () => sub.remove();
    // dismissResults is re-made every render and reads only `navigation` and
    // the route param; re-subscribing on either of those is enough.
  }, [returnTo, isFocused, navigation]);

  if (!attempt) {
    return (
      // This branch used to render OUTSIDE the local SafeAreaProvider below,
      // so it got 0 on every edge in the modal's own window. `Screen` falls
      // back to initialWindowMetrics, so it no longer needs the provider.
      <Screen edges={['top']} bottom="safe" className="flex-1" style={{ backgroundColor: colors.background }}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Results not found</Text>
          <TouchableOpacity onPress={dismissResults}>
            <Text style={[styles.errorLink, { color: colors.primaryText }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const retakeBlocked = retakePlan.action === 'unavailable';

  const correctCount = attempt.answers.filter(a => a.isCorrect).length;
  const incorrectCount = attempt.answers.length - correctCount;

  /**
   * Leave the results behind, never on top of the tests list.
   *
   * `navigate('TestsList')` only pops when TestsList is ALREADY below this
   * screen. Arriving here from a group chat the stack is [StudyHub,
   * TestResults], so `navigate` PUSHED a second screen — [StudyHub,
   * TestResults, TestsList] — and back from the tests list walked FORWARD into
   * the results the reader had just dismissed, over and over.
   *
   * `popTo` is the action that means what this button means: pop back to
   * TestsList when it is in the stack, and otherwise replace this screen with
   * it (@react-navigation/routers StackRouter, POP_TO). Either way the results
   * screen is gone.
   */
  const exitToTestsList = () => {
    const plan = planExitToTestsList({
      state: navigation.getState?.(),
      rootRouteName: TAB_STACK_ROOT_ROUTE.StudyTab,
      testsListRouteName: 'TestsList',
      returnTo,
    });
    if (plan.action === 'returnToTab') {
      // Launched from a chat thread: "Done" means back to the thread, not a
      // tests list on a tab the reader never opened.
      performReturnToTab(plan);
      return;
    }
    if (plan.action === 'popTo') {
      navigation.popTo(plan.routeName);
      return;
    }
    // The one case popTo cannot serve: this screen is the bottom of the
    // stack, so popTo would leave a bottomless [TestsList] whose own back
    // exits to Home. Rebuild with the Study root underneath instead.
    navigation.reset({
      index: plan.routes.length - 1,
      routes: plan.routes.map((name: string) => ({ name })),
    });
  };

  /**
   * Retake this test: start the same session again and REPLACE the results.
   *
   * Replace, not push: the score on screen stops describing anything the
   * moment the new attempt begins, so leaving it underneath would let
   * hardware BACK walk into a stale result.
   */
  const handleTryAgain = async () => {
    if (retakePlan.action === 'unavailable') {
      Alert.alert('Cannot retake', retakePlan.message);
      return;
    }
    if (startingRetake) return;
    setStartingRetake(true);
    try {
      if (retakePlan.action === 'retakeQuestionSet') {
        // The exact question set that was sat, with the timer it was sat under.
        await startQuestionSet(retakePlan.sessionName, retakeQuestions, 'test', {
          timeLimitMinutes: retakePlan.timeLimitMinutes,
          groupId: retakePlan.groupId,
          groupName: retakePlan.groupName,
          courseId: retakePlan.courseId,
          topicId: retakePlan.topicId,
        });
      } else {
        // The store's own start path, so the reader's shuffle settings and any
        // refetch of the questions apply exactly as they do from the list.
        await startTest(retakePlan.testId, 'test', {
          timeLimit: retakePlan.timeLimitMinutes,
          userId: user?.id,
          groupId: retakePlan.groupId,
          groupName: retakePlan.groupName,
          courseId: retakePlan.courseId,
          topicId: retakePlan.topicId,
        });
      }
      navigation.replace('TestTaking', retakePlan.params);
    } catch {
      Alert.alert('Error', 'Failed to start test');
    } finally {
      setStartingRetake(false);
    }
  };

  const handlePracticeFailed = async () => {
    if (!failedQuestions.length) return;
    const sessionName = `${attempt.testName} - Practice Failed`;
    await startQuestionSet(sessionName, failedQuestions, 'study');
    // `replace`, not `navigate`: the practice session ends by REPLACING itself
    // with its own results, so pushing it would leave this results screen
    // buried under a second one for hardware BACK to walk into.
    navigation.replace('TestTaking', {
      testId: 'custom',
      testName: sessionName,
      mode: 'study',
      // Same excursion, same way home.
      ...(returnTo ? { returnTo } : {}),
    });
  };

  return (
    // Presented as a fullScreenModal, which is its own window — the app-root
    // provider never measures it, so edges={['top']} resolved to 0 and the back
    // button sat under the status bar.
    <SafeAreaProvider>
    <Screen edges={['top']} bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={dismissResults} style={styles.backButton}>
          <AppIcon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Test Results</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Result Card */}
        <View style={[
          styles.resultCard,
          { borderColor: attempt.passed ? colors.success : colors.error }
        ]}>
          <View style={[
            styles.resultIcon,
            { backgroundColor: attempt.passed ? '#10b98120' : '#ef444420' }
          ]}>
            <AppIcon 
              name={attempt.passed ? 'trophy' : 'close-circle'} 
              size={48} 
              color={attempt.passed ? colors.success : colors.error} 
            />
          </View>
          
          <Text style={styles.testName}>{attempt.testName}</Text>
          
          <Text style={[
            styles.resultStatus,
            { color: attempt.passed ? colors.success : colors.error }
          ]}>
            {attempt.passed ? 'PASSED!' : 'NOT PASSED'}
          </Text>
          
          <View style={styles.scoreCircle}>
            <Text style={styles.scorePercentage}>{attempt.percentage}%</Text>
            <Text style={styles.scoreLabel}>Score</Text>
          </View>
          
          <Text style={styles.dateText}>
            Completed {formatDate(attempt.completedAt || attempt.startedAt)}
          </Text>
        </View>

        {/* Directly under the result, ABOVE the four stat cards.
            It used to sit below them, which put it off the bottom of the
            first screenful on a NOT-PASSED result: that layout's action row
            grows a full-width "Practice Failed (N)" band, the row is in flow
            below the scroll view, and every point it gains the scroll
            viewport loses. The button was then reachable only by scrolling,
            and its window position landed inside the action row — clipped,
            not covered. The stats read as well in either order; a primary
            action that needs a scroll to be discovered does not. */}
        <TouchableOpacity
          style={[styles.analysisButton, { backgroundColor: colors.primaryFill }]}
          onPress={openDetailedAnalysis}
          accessibilityRole="button"
          accessibilityLabel="View detailed analysis of this test"
        >
          <AppIcon name="bar-chart" size={18} color="#fff" />
          <Text style={styles.analysisButtonText}>Detailed Analysis</Text>
        </TouchableOpacity>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <AppIcon name="checkmark-circle" size={24} color="#10b981" />
            <Text style={styles.statValue}>{correctCount}</Text>
            <Text style={styles.statLabel}>Correct</Text>
          </View>
          <View style={styles.statCard}>
            <AppIcon name="close-circle" size={24} color="#ef4444" />
            <Text style={styles.statValue}>{incorrectCount}</Text>
            <Text style={styles.statLabel}>Incorrect</Text>
          </View>
          <View style={styles.statCard}>
            <AppIcon name="star" size={24} color="#fbbf24" />
            <Text style={styles.statValue}>{attempt.score}/{attempt.totalPoints}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
          <View style={styles.statCard}>
            <AppIcon name="time" size={24} color={colors.primaryText} />
            <Text style={styles.statValue}>{formatTime(attempt.timeSpent)}</Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressSection}>
          <Text style={styles.sectionTitle}>Performance</Text>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFillCorrect, 
                  { width: `${(correctCount / attempt.answers.length) * 100}%` }
                ]} 
              />
              <View 
                style={[
                  styles.progressFillIncorrect, 
                  { width: `${(incorrectCount / attempt.answers.length) * 100}%` }
                ]} 
              />
            </View>
            <View style={styles.progressLabels}>
              <View style={styles.progressLabel}>
                <View style={[styles.progressDot, { backgroundColor: colors.success }]} />
                <Text style={styles.progressLabelText}>Correct ({correctCount})</Text>
              </View>
              <View style={styles.progressLabel}>
                <View style={[styles.progressDot, { backgroundColor: colors.error }]} />
                <Text style={styles.progressLabelText}>Incorrect ({incorrectCount})</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Question Review */}
        <View style={styles.reviewSection}>
          <Text style={styles.sectionTitle}>Question Review</Text>
          {attempt.answers.map((answer, index) => (
            <View key={answer.questionId} style={styles.questionReview}>
              <View style={[
                styles.questionStatus,
                { backgroundColor: answer.isCorrect ? '#10b98120' : '#ef444420' }
              ]}>
                <AppIcon 
                  name={answer.isCorrect ? 'checkmark' : 'close'} 
                  size={16} 
                  color={answer.isCorrect ? colors.success : colors.error} 
                />
              </View>
              <View style={styles.questionInfo}>
                <Text style={styles.questionNumber}>Question {index + 1}</Text>
                {(answer as any).questionText ? (
                  <Text style={styles.questionStem}>{(answer as any).questionText}</Text>
                ) : null}
                <Text style={[
                  styles.questionAnswer,
                  !answer.isCorrect && styles.questionAnswerWrong,
                ]}>
                  Your answer: {formatAnswer(answer.userAnswer, answer.questionSnapshot)}
                </Text>
                {!answer.isCorrect && answer.correctAnswer !== undefined && (
                  <Text style={styles.questionCorrectAnswer}>
                    Correct answer: {formatAnswer(
                      answer.correctAnswer,
                      answer.questionSnapshot
                    ) || (answer.questionSnapshot ? formatCorrectAnswerDisplay(answer.questionSnapshot) : '')}
                  </Text>
                )}
                {!answer.isCorrect && (answer as any).explanation ? (
                  <Text style={styles.questionExplanation}>{(answer as any).explanation}</Text>
                ) : null}
              </View>
              {!answer.isCorrect && (
                <TouchableOpacity
                  style={styles.explainButton}
                  onPress={() => {
                    setExplainData({
                      question: (answer as any).questionText || `Question ${index + 1}`,
                      userAnswer: formatAnswer(answer.userAnswer, answer.questionSnapshot),
                      correctAnswer: formatAnswer(answer.correctAnswer, answer.questionSnapshot)
                        || (answer.questionSnapshot ? formatCorrectAnswerDisplay(answer.questionSnapshot) : ''),
                      options: (answer as any).options,
                    });
                    setShowExplain(true);
                  }}
                >
                  <AppIcon name="sparkles" size={14} color={colors.primaryText} />
                  <Text style={styles.explainButtonText}>Explain</Text>
                </TouchableOpacity>
              )}
              <Text style={[
                styles.questionPoints,
                { color: answer.isCorrect ? colors.success : colors.error }
              ]}>
                {answer.isCorrect ? `+${answer.points}` : '0'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* AI Explain Modal */}
      {explainData && (
        <AIExplainModal
          visible={showExplain}
          onClose={() => {
            setShowExplain(false);
            setExplainData(null);
          }}
          question={explainData.question}
          userAnswer={explainData.userAnswer}
          correctAnswer={explainData.correctAnswer}
          options={explainData.options}
        />
      )}

      {/* Bottom Actions */}
      {/* The pinned action row hard-coded `paddingBottom: 32` and never read
          an inset, so under edge-to-edge Done / Try Again sat inside the
          Android navigation-bar band with a sub-44px effective target. */}
      <View style={[styles.bottomActions, { paddingBottom: actionsPadding }]}>
        {retakePlan.action === 'unavailable' ? (
          <Text style={[styles.retakeNotice, { color: colors.textSecondary }]}>
            {retakePlan.message}
          </Text>
        ) : null}
        {failedQuestions.length > 0 ? (
          <TouchableOpacity
            style={styles.practiceFailedButton}
            onPress={() => void handlePracticeFailed()}
          >
            <AppIcon name="school" size={20} color="#10b981" />
            <Text style={styles.practiceFailedButtonText}>
              Practice Failed ({failedQuestions.length})
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.retryButton, retakeBlocked && styles.retryButtonDisabled]}
          onPress={() => void handleTryAgain()}
          disabled={retakeBlocked || startingRetake}
          accessibilityRole="button"
          accessibilityState={{ disabled: retakeBlocked || startingRetake, busy: startingRetake }}
          accessibilityLabel={
            retakeBlocked
              ? `Retake unavailable. ${retakePlan.action === 'unavailable' ? retakePlan.message : ''}`
              : 'Try again'
          }
        >
          <AppIcon
            name="refresh"
            size={20}
            color={retakeBlocked ? colors.textSecondary : colors.primaryText}
          />
          {/* The label carries the state too — never colour alone. */}
          <Text
            style={[styles.retryButtonText, retakeBlocked && { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {retakeBlocked ? 'Cannot retake' : startingRetake ? 'Starting…' : 'Try Again'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={exitToTestsList}
        >
          <Text style={styles.doneButtonText} numberOfLines={1}>Done</Text>
        </TouchableOpacity>
      </View>
    </Screen>
    </SafeAreaProvider>
  );
}

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
  backButton: {
    padding: 4,
  },
  headerTitle: {
    ...typeScale.heading,
    fontWeight: '600',
    color: c.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 100,
  },
  resultCard: {
    backgroundColor: c.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 20,
  },
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  testName: {
    ...typeScale.title,
    fontWeight: '600',
    color: c.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  resultStatus: {
    ...typeScale.title,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: c.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  scorePercentage: {
    ...typeScale.display,
    ...tabularNums,
    fontWeight: 'bold',
    color: c.text,
  },
  scoreLabel: {
    ...typeScale.caption,
    color: c.textSecondary,
  },
  dateText: {
    ...typeScale.caption,
    color: '#6b7280',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - 52) / 2,
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    ...typeScale.title,
    ...tabularNums,
    fontWeight: 'bold',
    color: c.text,
    marginTop: 8,
  },
  statLabel: {
    ...typeScale.caption,
    color: c.textSecondary,
    marginTop: 4,
  },
  analysisButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  analysisButtonText: {
    color: '#fff',
    ...typeScale.body,
    fontWeight: '700',
  },
  progressSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    ...typeScale.heading,
    fontWeight: '600',
    color: c.text,
    marginBottom: 16,
  },
  progressBarContainer: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
  },
  progressBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: c.backgroundSecondary,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFillCorrect: {
    height: '100%',
    backgroundColor: c.success,
  },
  progressFillIncorrect: {
    height: '100%',
    backgroundColor: c.error,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  progressLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  progressLabelText: {
    ...typeScale.caption,
    color: c.textSecondary,
  },
  reviewSection: {
    marginBottom: 24,
  },
  questionReview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  questionStatus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  questionInfo: {
    flex: 1,
  },
  questionNumber: {
    ...typeScale.body,
    fontWeight: '600',
    color: c.text,
    marginBottom: 2,
  },
  questionAnswer: {
    ...typeScale.caption,
    color: c.textSecondary,
  },
  questionStem: {
    ...typeScale.body,
    color: c.text,
    marginBottom: 4,
  },
  questionAnswerWrong: {
    color: '#fca5a5',
  },
  questionCorrectAnswer: {
    ...typeScale.caption,
    color: '#86efac',
    marginTop: 2,
  },
  questionExplanation: {
    ...typeScale.caption,
    color: c.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  questionPoints: {
    ...typeScale.body,
    ...tabularNums,
    fontWeight: '700',
  },
  explainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: c.primaryBackground,
    marginRight: 8,
  },
  explainButtonText: {
    ...typeScale.caption,
    fontWeight: '600',
    color: c.primaryText,
  },
  bottomActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 20,
    backgroundColor: c.card,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  practiceFailedButton: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#10b98120',
    marginBottom: 4,
  },
  practiceFailedButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: c.success,
  },
  retryButton: {
    // `flexBasis: 0` with `flexGrow: 1` — NOT the shorthand `flex: 1` inside a
    // wrapping row, where the basis stays `auto` and each button is sized by
    // its own label first. Three of them no longer fitted, so every label
    // spilled outside the box it was supposed to be inside.
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 120,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: c.primaryBackground,
  },
  retryButtonDisabled: {
    // Muted fill AND a changed label ("Cannot retake") — the state never rests
    // on colour alone. The reason itself is spelled out above the row.
    backgroundColor: c.backgroundSecondary,
  },
  retryButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: c.primaryText,
  },
  retakeNotice: {
    width: '100%',
    ...typeScale.caption,
  },
  doneButton: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 120,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    // Build 153: this was a hardcoded #6366f1 and the white label sat at
    // 4.45:1. `primaryFill` is the token whose contract is "white reads on me".
    backgroundColor: c.primaryFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    ...typeScale.body,
    fontWeight: '600',
    color: '#ffffff',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...typeScale.heading,
    color: c.textSecondary,
    marginBottom: 16,
  },
  errorLink: {
    ...typeScale.body,
    color: c.primaryText,
    fontWeight: '600',
  },
});
