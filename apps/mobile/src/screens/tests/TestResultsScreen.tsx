// ===========================================
// Lantern Study Mobile - Test Results Screen
// ===========================================
/**
 * The `TestResults` route, presented as a fullScreenModal: the score card for
 * one attempt, an honest correct/incorrect/unanswered tally, per-question
 * review with confidence badges and provenance chips, and the exits — Done,
 * Try Again, Practice wrong answers, Detailed Analysis.
 *
 * Main exports: the default `TestResultsScreen`.
 * Touches: testStore (`hydrateAttemptDetail`, `startTest`, `startQuestionSet`),
 * authStore, AIExplainModal (POST /ai/explain-answer, one credit per tap). The
 * exit planners live in ./testSessionExit and the review rules in
 * ./confidenceReveal. No native modules beyond RN's BackHandler.
 *
 * Gotchas: leaving this screen is never a plain `goBack()` — a session reached
 * by nested navigate makes these results the Study stack's only route, so the
 * planners decide between pop, popTo, a tab return, or a reset, and the Study
 * stack is always reset BEFORE any tab switch or the results outlive their
 * session as the tab's root. Unanswered is not incorrect: `tallyAttempt` keeps
 * the three counts apart and a practice sitting shows no pass/fail at all.
 * Retake follows the same two-step launch as the tests list (snapshot set
 * first, source test second) and `replace`s this screen so BACK cannot reach a
 * stale score.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  BackHandler,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
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
import {
  REVIEW_OUTCOMES,
  classifyReviewOutcome,
  describeTally,
  displayedScorePercentage,
  isAnswerProvided,
  questionSourceTarget,
  resolveQuestionSource,
  tallyAttempt,
  type ConfidenceLevel,
} from './confidenceReveal';
import { deriveTestSource } from './testAuthoring';
import { useFeatureAccent } from '../../components/ui/FeatureDisc';
import { T } from '../../components/ui';

/** One AI credit; the same rate limiter POST /ai/explain-answer charges. */
const EXPLAIN_ANSWER_CREDIT_COST = 1;

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
    /**
     * What the reader committed to before each answer was revealed, keyed by
     * question id. Present only on a practice attempt that collected them
     * (spec §9 #5) — a timed exam attempt never sends this, and review then
     * reads exactly as it always did.
     */
    confidenceByQuestion?: Record<string, ConfidenceLevel>;
  };
};

export default function TestResultsScreen() {
  const route = useRoute<RouteProp<TestResultsRouteParams, 'TestResults'>>();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { attemptId, returnTo, confidenceByQuestion } = route.params;
  const { colors } = useTheme();
  const testsAccent = useFeatureAccent('tests');
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

  /**
   * The questions to practise again: ANSWERED and wrong.
   *
   * `!a.isCorrect` alone swept in every blank, so a session with three
   * untouched questions offered "Practice Failed (3)" for three questions the
   * reader had never seen — the same "unanswered = missed" reading the stats
   * grid above already refuses (device finding T5, build 162). A blank is not
   * a mistake to drill; it is a question still to be attempted.
   */
  const failedQuestions = useMemo((): TestQuestion[] => {
    if (!attempt) return [];
    return attempt.answers
      .filter(a => !a.isCorrect && isAnswerProvided(a.userAnswer) && a.questionSnapshot)
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

  /**
   * The attempt's own provenance, for questions that carry none of their own.
   *
   * A mobile question snapshot has no note or deck id on it, so for most
   * sessions the honest answer to "where did this come from?" is the study
   * group whose board the questions were drawn from, or the deck behind the
   * source test. Question-level provenance still wins when a snapshot happens
   * to carry it (`resolveQuestionSource`), so this is a fallback, not a
   * blanket label.
   */
  const attemptProvenance = useMemo(
    () => ({
      groupId: attempt?.groupId,
      groupName: attempt?.groupName,
      deckId: retakeSourceTest?.deckId,
      deckName: retakeSourceTest?.deckName,
    }),
    [attempt?.groupId, attempt?.groupName, retakeSourceTest?.deckId, retakeSourceTest?.deckName]
  );

  /** The whole session's source — every row shares it when no row has its own. */
  const analysisSource = useMemo(
    () => resolveQuestionSource({ attempt: attemptProvenance }),
    [attemptProvenance]
  );

  /**
   * The chip under the test's name: where this test came from.
   *
   * `resolveQuestionSource` answers only from provenance the SERVER put on the
   * row, and refuses anything it cannot link to — so a test made from a note
   * had no chip at all on build 163 (F1), even though the screen was showing
   * the note's name in the title the whole time. This derives it from what is
   * already here, and settles for a NAME when there is no id to open.
   */
  const heroSource = useMemo(
    () =>
      deriveTestSource({
        noteId: retakeSourceTest?.sourceNoteId,
        noteTitle: retakeSourceTest?.sourceNoteTitle,
        deckId: retakeSourceTest?.deckId,
        deckName: retakeSourceTest?.deckName,
        groupId: attempt?.groupId,
        groupName: attempt?.groupName,
        testTitle: attempt?.testName,
      }),
    [
      retakeSourceTest?.sourceNoteId,
      retakeSourceTest?.sourceNoteTitle,
      retakeSourceTest?.deckId,
      retakeSourceTest?.deckName,
      attempt?.groupId,
      attempt?.groupName,
      attempt?.testName,
    ]
  );

  const analysisTest = useMemo((): RecentTest | null => {
    if (!attempt || attempt.answers.length === 0) return null;
    return normalizeRecentTest({
      id: attempt.id,
      groupName: attempt.groupName || attempt.testName,
      // The honest count: a blank the grader stamped `isCorrect: false` is not
      // a wrong answer, and it is certainly not a right one.
      score: tallyAttempt(attempt.answers).correct,
      totalQuestions: attempt.answers.length,
      percentage: displayedScorePercentage(tallyAttempt(attempt.answers), attempt.percentage),
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
      // Provenance travels with the analysis so its source chip is the same
      // chip the review rows show, resolved once from the same attempt.
      ...(analysisSource ? { source: analysisSource } : {}),
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
   * Open the note, deck or thread a question came from.
   *
   * Round-4 invariants, both halves: the Study stack is RESET first so these
   * results cannot outlive their session as the tab's root, and the target is
   * named through `toTab(..., initial: false)` so the destination tab keeps
   * its own root underneath. A note or deck is on the Study tab, so its reset
   * puts the target straight onto StudyHub in one dispatch; a group thread is
   * on Chat, which is the existing `performReturnToTab` move exactly.
   */
  const openQuestionSource = useCallback(
    (source: ReturnType<typeof resolveQuestionSource>) => {
      if (!source) return;
      const target = questionSourceTarget(source);
      if (target.tab === 'StudyTab') {
        navigation.reset({
          index: 1,
          routes: [
            { name: TAB_STACK_ROOT_ROUTE.StudyTab },
            { name: target.screen, params: target.params },
          ],
        });
        return;
      }
      performReturnToTab({
        action: 'returnToTab',
        routes: [TAB_STACK_ROOT_ROUTE.StudyTab],
        returnTo: { tab: target.tab, screen: target.screen, params: target.params },
      });
    },
    [navigation, performReturnToTab]
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

  /**
   * Unanswered ≠ missed (spec §5.7, and the v3 comparison's `qz-15-stats`
   * finding: 17 blanks reported as "Missed" and the attempt called 10%).
   *
   * `incorrectCount` used to be `answers.length - correctCount`, which folded
   * every blank into "Incorrect" — so walking away from a test read exactly
   * like getting it wrong, and an abandoned session showed a failing score
   * with no hint that most of it was never attempted. The tally keeps the
   * three counts apart and `describeTally` says so in words.
   */
  /**
   * A practice sitting — the kind that ends in this screen since build 163.
   *
   * Read from the attempt's own recorded mode, never guessed from the timer:
   * an attempt written before the mode was stored says nothing, and "nothing"
   * must not be read as "practice".
   */
  const isPracticeSitting = attempt.mode === 'study';

  const tally = tallyAttempt(attempt.answers);
  const correctCount = tally.correct;
  const incorrectCount = tally.incorrect;
  const unansweredCount = tally.unanswered;
  const tallyNote = describeTally(tally);

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
      appAlert('Cannot retake', retakePlan.message);
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
      appAlert('Error', 'Failed to start test');
    } finally {
      setStartingRetake(false);
    }
  };

  const handlePracticeFailed = async () => {
    if (!failedQuestions.length) return;
    const sessionName = `${attempt.testName} - Practice wrong answers`;
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
        {/* NEUTRAL for a practice sitting, in all three places the verdict
            was painted: the border, the disc behind the glyph, and the glyph
            itself. A red border and a ✗ around an untimed run with feedback
            is a verdict the sitting never earned (T2) — and the word below
            already says "PRACTICE COMPLETE", so leaving the frame red was two
            surfaces disagreeing on the same card. */}
        <View style={[
          styles.resultCard,
          {
            borderColor:
              isPracticeSitting || tally.isAbandoned
                ? colors.border
                : attempt.passed ? colors.success : colors.error,
          }
        ]}>
          <View style={[
            styles.resultIcon,
            {
              backgroundColor: tally.isAbandoned || isPracticeSitting
                ? testsAccent.tint
                : attempt.passed ? '#10b98120' : '#ef444420',
            }
          ]}>
            <AppIcon
              name={
                tally.isAbandoned
                  ? 'remove-circle'
                  : isPracticeSitting
                    ? 'book'
                    : attempt.passed ? 'trophy' : 'close-circle'
              }
              size={48}
              color={
                tally.isAbandoned || isPracticeSitting
                  ? testsAccent.ink
                  : attempt.passed ? colors.success : colors.error
              }
            />
          </View>

          <Text style={styles.testName}>{attempt.testName}</Text>

          {/* Where these questions came from. A link when something here knows
              the id; plain text when all we have is the name — which is still
              worth saying, and better than a link with nowhere to go. */}
          {heroSource ? (
            heroSource.id ? (
              <TouchableOpacity
                style={[styles.sourceChip, styles.heroSourceChip, { borderColor: testsAccent.ink }]}
                onPress={() => openQuestionSource({
                  kind: heroSource.kind,
                  id: heroSource.id ?? '',
                  title: heroSource.title,
                  label: heroSource.label,
                })}
                accessibilityRole="link"
                accessibilityLabel={`${heroSource.label}. Opens the source.`}
              >
                <AppIcon name="arrow-forward" size={12} color={testsAccent.ink} />
                <T.Label style={{ color: testsAccent.ink }} numberOfLines={1}>
                  {heroSource.label}
                </T.Label>
              </TouchableOpacity>
            ) : (
              <T.Caption tone="secondary" style={styles.heroSourceText} numberOfLines={1}>
                {heroSource.label}
              </T.Caption>
            )
          ) : null}

          {/* An attempt where nothing was answered has no result to report.
              Calling it "NOT PASSED · 0%" is the dishonest reading the spec's
              "unanswered ≠ missed" rule exists to stop.

              Nor does a PRACTICE session pass or fail. Pass marks belong to
              the exam it is practice for; stamping a red NOT PASSED on an
              untimed run with feedback turns the low-stakes surface into a
              verdict, which is the reason to practise at all. */}
          <Text style={[
            styles.resultStatus,
            {
              color: tally.isAbandoned || isPracticeSitting
                ? testsAccent.ink
                : attempt.passed ? colors.success : colors.error,
            }
          ]}>
            {tally.isAbandoned
              ? 'NOT ATTEMPTED'
              : isPracticeSitting
                ? 'PRACTICE COMPLETE'
                : attempt.passed ? 'PASSED!' : 'NOT PASSED'}
          </Text>
          {isPracticeSitting ? (
            <T.Caption tone="secondary" style={styles.tallyNote}>
              Practice — untimed, with feedback as you went. No pass mark applies.
            </T.Caption>
          ) : null}

          <View style={styles.scoreCircle}>
            {tally.isAbandoned ? (
              <>
                <Text style={styles.scoreLabel}>No score</Text>
                <Text style={styles.scoreLabel}>0 of {tally.total} answered</Text>
              </>
            ) : (
              <>
                <Text style={styles.scorePercentage}>
                  {displayedScorePercentage(tally, attempt.percentage)}%
                </Text>
                <Text style={styles.scoreLabel}>
                  {tally.isPartial ? `Of all ${tally.total}` : 'Score'}
                </Text>
              </>
            )}
          </View>

          {/* The one line that keeps a partial or abandoned attempt honest. */}
          {tallyNote ? (
            <T.Caption tone="secondary" style={styles.tallyNote}>{tallyNote}</T.Caption>
          ) : null}

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
          {/* Its own card, never folded into Incorrect. A blank is a question
              the reader never got to, not a question they got wrong. */}
          <View style={styles.statCard}>
            <AppIcon name="remove-circle" size={24} color={testsAccent.ink} />
            <Text style={styles.statValue}>{unansweredCount}</Text>
            <Text style={styles.statLabel}>Unanswered</Text>
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
                  { width: `${tally.total > 0 ? (correctCount / tally.total) * 100 : 0}%` }
                ]} 
              />
              <View 
                style={[
                  styles.progressFillIncorrect, 
                  { width: `${tally.total > 0 ? (incorrectCount / tally.total) * 100 : 0}%` }
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
              {unansweredCount > 0 && (
                <View style={styles.progressLabel}>
                  <View style={[styles.progressDot, { backgroundColor: colors.border }]} />
                  <Text style={styles.progressLabelText}>Unanswered ({unansweredCount})</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Question Review */}
        <View style={styles.reviewSection}>
          <Text style={styles.sectionTitle}>Question Review</Text>
          {attempt.answers.map((answer, index) => {
            const answered = isAnswerProvided(answer.userAnswer);
            const outcome = classifyReviewOutcome({
              isCorrect: answer.isCorrect,
              answered,
              // The route param is this run's copy; the attempt's own field
              // is what a result reopened from History carries.
              confidence: confidenceByQuestion?.[answer.questionId] ?? answer.confidence,
            });
            const presentation = REVIEW_OUTCOMES[outcome];
            // A plain correct/incorrect is already said by the status disc and
            // the points column; only the confidence pairs and the blank add
            // something a badge is needed for.
            const showOutcomeBadge = outcome !== 'correct' && outcome !== 'incorrect';
            // Every reviewed question shows its rationale, not only the ones
            // that were got wrong: "why is this the answer" is the point of a
            // review, and a right answer for the wrong reason is exactly what
            // the Lucky badge above is pointing at.
            const rationale =
              (answer as any).explanation || answer.questionSnapshot?.explanation || '';
            const correctAnswerText =
              formatAnswer(answer.correctAnswer, answer.questionSnapshot) ||
              (answer.questionSnapshot ? formatCorrectAnswerDisplay(answer.questionSnapshot) : '');
            const source = resolveQuestionSource({
              question: answer.questionSnapshot as never,
              attempt: attemptProvenance,
            });
            return (
              <View key={answer.questionId} style={styles.questionReview}>
                <View style={[
                  styles.questionStatus,
                  {
                    backgroundColor: !answered
                      ? testsAccent.tint
                      : answer.isCorrect ? '#10b98120' : '#ef444420',
                  },
                ]}>
                  <AppIcon
                    name={!answered ? 'remove' : answer.isCorrect ? 'checkmark' : 'close'}
                    size={16}
                    color={!answered ? testsAccent.ink : answer.isCorrect ? colors.success : colors.error}
                  />
                </View>
                <View style={styles.questionInfo}>
                  <Text style={styles.questionNumber}>Question {index + 1}</Text>

                  {/* The confidence pair, as a word and a glyph — colour is
                      never the only signal (spec §5.6 honesty rule). The badge
                      is drawn in the tests pair for every outcome precisely so
                      that reading it means reading it.

                      A plain correct/incorrect — a timed exam attempt, which
                      never collects confidence — draws NO badge: the status
                      disc and the points column already say that, and a
                      redundant pill is how "stays plain" gets broken. */}
                  {showOutcomeBadge || source ? (
                  <View style={styles.outcomeRow}>
                    {!showOutcomeBadge ? null : (
                      <View style={[styles.outcomeBadge, { backgroundColor: testsAccent.tint }]}>
                        <AppIcon name={presentation.icon as never} size={12} color={testsAccent.ink} />
                        <T.Label style={{ color: testsAccent.ink }}>{presentation.label}</T.Label>
                      </View>
                    )}
                    {source ? (
                      <TouchableOpacity
                        style={[styles.sourceChip, { borderColor: testsAccent.ink }]}
                        onPress={() => openQuestionSource(source)}
                        accessibilityRole="link"
                        accessibilityLabel={`${source.label}. Opens the source.`}
                      >
                        <AppIcon name="arrow-forward" size={12} color={testsAccent.ink} />
                        <T.Label style={{ color: testsAccent.ink }} numberOfLines={1}>
                          {source.label}
                        </T.Label>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  ) : null}
                  {presentation.detail ? (
                    <T.Caption tone="secondary" style={styles.outcomeDetail}>
                      {presentation.detail}
                    </T.Caption>
                  ) : null}

                  {(answer as any).questionText ? (
                    <Text style={styles.questionStem}>{(answer as any).questionText}</Text>
                  ) : null}
                  <Text style={[
                    styles.questionAnswer,
                    answered && !answer.isCorrect && styles.questionAnswerWrong,
                  ]}>
                    Your answer: {answered
                      ? formatAnswer(answer.userAnswer, answer.questionSnapshot)
                      : 'Left blank'}
                  </Text>
                  {/* The correct answer belongs on a blank too: an unanswered
                      question is the one the reader learned least from. */}
                  {(!answer.isCorrect || !answered) && correctAnswerText ? (
                    <Text style={styles.questionCorrectAnswer}>
                      Correct answer: {correctAnswerText}
                    </Text>
                  ) : null}
                  {rationale ? (
                    <Text style={styles.questionExplanation}>{rationale}</Text>
                  ) : null}
                </View>
                {/* Only when the question carries no rationale of its own —
                    and never spent without this tap. The cost is printed
                    beside the button, before the reader commits to it. */}
                {!rationale && (
                  <View style={styles.explainColumn}>
                    <TouchableOpacity
                      style={styles.explainButton}
                      onPress={() => {
                        setExplainData({
                          question: (answer as any).questionText || `Question ${index + 1}`,
                          userAnswer: answered
                            ? formatAnswer(answer.userAnswer, answer.questionSnapshot)
                            : '(left blank)',
                          correctAnswer: correctAnswerText,
                          options: (answer as any).options,
                        });
                        setShowExplain(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Explain question ${index + 1} with Lantern AI, costs ${EXPLAIN_ANSWER_CREDIT_COST} credit`}
                    >
                      <AppIcon name="sparkles" size={14} color={colors.primaryText} />
                      <Text style={styles.explainButtonText}>Explain</Text>
                    </TouchableOpacity>
                    <AIUsageBadge variant="inline" cost={EXPLAIN_ANSWER_CREDIT_COST} />
                  </View>
                )}
                <Text style={[
                  styles.questionPoints,
                  { color: !answered ? colors.textTertiary : answer.isCorrect ? colors.success : colors.error }
                ]}>
                  {answer.isCorrect && answered ? `+${answer.points}` : answered ? '0' : '—'}
                </Text>
              </View>
            );
          })}
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
              Practice wrong answers ({failedQuestions.length})
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
  tallyNote: {
    marginTop: 8,
    textAlign: 'center',
  },
  outcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  outcomeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroSourceChip: {
    alignSelf: 'center',
    marginTop: 8,
  },
  heroSourceText: {
    marginTop: 8,
    textAlign: 'center',
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '70%',
  },
  outcomeDetail: {
    marginBottom: 4,
  },
  explainColumn: {
    alignItems: 'center',
    gap: 4,
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
