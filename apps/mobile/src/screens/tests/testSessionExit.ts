/**
 * How a test session screen gets OFF the stack it was pushed on.
 *
 * `navigation.goBack()` was never enough. Several entry points reach a
 * session by NESTED navigate — Home's "continue"/"start" cards, a group
 * chat's shared test, the offline screen, a deep link — and React Navigation
 * initialises the child navigator from `getStateFromParams`
 * (@react-navigation/core's useNavigationBuilder), which builds
 * `{ routes: [{ name: params.screen }] }`: the target becomes the stack's
 * ONLY route and the initial route is dropped, unless the caller passed
 * `initial: false`.
 *
 * On such a stack GO_BACK is unhandled here, bubbles to the TAB navigator and
 * merely switches tabs — so the session screen is never removed. It stays
 * mounted as the Study tab's root, and once the session is gone it renders
 * "This test session has ended." forever: `popToTop` cannot clear it (index
 * is already 0) and its own Go Back lands on Home.
 *
 * These planners answer "can this stack pop, or must it be reset onto the
 * Study root?" Pure — no native import anywhere in the module — so mobile
 * jest (node env, `*.test.ts`) can exercise them without a navigator.
 */

import {
  hasStoredTimerChoice,
  resolveAttemptTimeLimitMinutes,
} from '../../utils/resolveAttemptTimeLimitMinutes';

/** As much of a navigator's state as the planners need. */
export interface StackStateLike {
  index?: number;
  routes?: readonly { name: string }[];
}

/** Reset the stack onto these routes, bottom first. */
export interface ResetToRootPlan {
  action: 'resetToRoot';
  routes: readonly string[];
}

/**
 * Where a session launched from OUTSIDE the Study tab has to go back to.
 *
 * A test started from a group chat thread (Chat → thread → ⋮ → Test mode)
 * runs on the STUDY stack, so every exit above landed the reader on the Study
 * hub — a different tab from the one they pressed the button in. Carrying the
 * origin along as a route param is what lets the exit undo the launch.
 */
export interface ReturnToTarget {
  /** Tab route name in the root tab navigator, e.g. 'ChatTab'. */
  tab: string;
  /** Route inside that tab's own stack, e.g. 'GroupChat'. */
  screen: string;
  /** That route's params, e.g. `{ groupId, groupName }`. */
  params?: Record<string, unknown>;
}

/**
 * Go back to the tab this session was launched from.
 *
 * Two moves, in this order and never one without the other:
 *   1. RESET the Study stack onto `routes` — the round-4 invariant. Switching
 *      tabs alone would leave the finished session (or its results) mounted as
 *      the Study tab's route, which is exactly the dead screen the earlier
 *      rounds were about: it outlives its store session and renders "This test
 *      session has ended." forever.
 *   2. NAVIGATE to `returnTo` through `navigation/nestedTab`'s `toTab`, so the
 *      target tab's own root stays underneath the thread.
 */
export interface ReturnToTabPlan {
  action: 'returnToTab';
  /** Reset the Study stack onto these first, bottom first. */
  routes: readonly string[];
  returnTo: ReturnToTarget;
}

export type TestExitPlan =
  /** Something of this stack's own sits below — an ordinary pop is right. */
  | { action: 'pop' }
  /** This screen IS the bottom: reset the stack onto the tab's root. */
  | ResetToRootPlan
  /** Launched from another tab: clear Study, then go back there. */
  | ReturnToTabPlan;

export type TestsListExitPlan =
  | { action: 'popTo'; routeName: string }
  | ResetToRootPlan
  | ReturnToTabPlan;

function focusedIndex(state?: StackStateLike | null): number {
  if (!state) return 0;
  if (typeof state.index === 'number') return state.index;
  return state.routes && state.routes.length > 0 ? state.routes.length - 1 : 0;
}

/**
 * Leaving a session screen (exit, end-of-study-session, or the dead-session
 * guard's Go Back).
 *
 * Popping is correct whenever this stack has a screen underneath — that is
 * the round-1/round-2 behaviour and it is left exactly as it was. Only the
 * bottom-of-stack case changes: instead of letting GO_BACK escape to the tab
 * navigator (which strands this screen and lands the reader on Home), the
 * stack is reset onto its root, which both removes the session screen and
 * puts the Study root back where a re-tap can reach it.
 *
 * `returnTo` overrides both: a session launched from a chat thread belongs
 * back in that thread, and the Study stack has to be emptied down to its root
 * on the way out — popping to whatever the launcher happened to leave under
 * this screen would strand a dead session on a tab nobody is looking at.
 */
export function planTestExit({
  state,
  rootRouteName,
  returnTo,
}: {
  state?: StackStateLike | null;
  rootRouteName: string;
  /** Absent for every in-Study launch, which keeps the behaviour below. */
  returnTo?: ReturnToTarget | null;
}): TestExitPlan {
  if (returnTo) {
    return { action: 'returnToTab', routes: [rootRouteName], returnTo };
  }

  return focusedIndex(state) > 0
    ? { action: 'pop' }
    : { action: 'resetToRoot', routes: [rootRouteName] };
}

/**
 * The results screen's "Done" — leave the results behind, land on the tests
 * list, never stack a second copy of anything.
 *
 * `popTo` remains the answer whenever the stack is sound: it pops back to
 * TestsList when it is below, and otherwise REPLACES the results with it, so
 * the results screen is gone either way and whatever was under it survives.
 *
 * The one case it cannot serve is a stack whose bottom is the results screen
 * itself (arrived by nested navigate). `popTo` would then leave `[TestsList]`
 * — a tests list with nothing beneath it, whose own back button exits to
 * Home and which a re-tap of Study can never pop past. Rebuild the stack
 * instead, with the Study root underneath.
 */
export function planExitToTestsList({
  state,
  rootRouteName,
  testsListRouteName,
  returnTo,
}: {
  state?: StackStateLike | null;
  rootRouteName: string;
  testsListRouteName: string;
  /**
   * Set only when the session was launched from another tab. "Done" then
   * means "I am finished here" in the reader's sense — back to the thread —
   * not "show me the Study tab's tests list", which is a place they never
   * asked for and cannot get back from.
   */
  returnTo?: ReturnToTarget | null;
}): TestsListExitPlan {
  if (returnTo) {
    return { action: 'returnToTab', routes: [rootRouteName], returnTo };
  }

  const routes = state?.routes ?? [];
  const rooted = routes[0]?.name === rootRouteName;
  const hasTestsList = routes.some(route => route.name === testsListRouteName);

  if (rooted || hasTestsList) return { action: 'popTo', routeName: testsListRouteName };

  return { action: 'resetToRoot', routes: [rootRouteName, testsListRouteName] };
}

/* ------------------------------------------------------------------ *
 * "Try Again" on the results screen.
 *
 * The button existed since round 1 and called `exitToTestsList` — the
 * same handler as Done — so retaking a test silently meant leaving it.
 * A retake has to (a) relaunch the SAME session the reader just sat, and
 * (b) go through the SAME launch path as the tests list's own Retake, so
 * the round-3 rule holds: one time-limit rule, every launch path.
 *
 * The planner below is the decision; the screen only performs it. It is
 * pure so mobile jest can exercise every branch without a navigator, a
 * store, or a native module.
 * ------------------------------------------------------------------ */

/** The parts of a finished attempt a retake needs. */
export interface RetakeAttemptLike {
  testId?: string;
  /** Template/deck id when the attempt itself was a one-off session. */
  originalTestId?: string;
  testName?: string;
  groupId?: string;
  groupName?: string;
  /**
   * Minutes recorded for the attempt. 0 is a real answer ("None") and must
   * stay untimed; `undefined` means the attempt never recorded a timer, and
   * only THEN may the source test's own limit stand in.
   */
  timeLimitMinutes?: number | null;
  courseId?: string | null;
  topicId?: string | null;
}

/** The library test the attempt came from, when it is still around. */
export interface RetakeSourceTestLike {
  id: string;
  name?: string;
  /** Minutes; the fallback for an attempt with no recorded timer. */
  timeLimit?: number | null;
}

export interface RetakeFromResultsInput {
  /** The attempt being viewed; absent when the route's attemptId resolved to nothing. */
  attempt?: RetakeAttemptLike | null;
  /** Question snapshots recoverable from the attempt's own answers. */
  snapshotCount: number;
  /** The still-installed source test, when one was found. */
  sourceTest?: RetakeSourceTestLike | null;
  /**
   * The origin the results carry, when they carry one. A retake is still the
   * same excursion out of the chat thread, so the fresh session has to inherit
   * it — otherwise finishing the second attempt drops the reader on the Study
   * hub and the fix only survives one round.
   */
  returnTo?: ReturnToTarget | null;
  /**
   * A session the reader may sit only once (a proctored/group exam).
   * Nothing writes this today; the flag keeps the refusal in ONE place for
   * when something does, instead of a second rule beside this one.
   */
  retakeBlocked?: boolean;
}

/** Params the fresh TestTaking screen is launched with. */
export interface RetakeLaunchParams {
  testId: string;
  testName: string;
  mode: 'test';
  groupId?: string;
  groupName?: string;
  /** Carried straight through to the relaunched session's route params. */
  returnTo?: ReturnToTarget;
}

export type RetakeUnavailableReason = 'missingAttempt' | 'noQuestions' | 'notRetakeable';

interface RetakeLaunchPlanBase {
  /** Name the relaunched session is filed under. */
  sessionName: string;
  /** Minutes, 0 = untimed. */
  timeLimitMinutes: number;
  groupId?: string;
  groupName?: string;
  courseId?: string | null;
  topicId?: string | null;
  /**
   * Always REPLACE: the results being retaken are stale the moment the new
   * session starts, so leaving them under the stack would let hardware BACK
   * walk into a score that no longer describes anything.
   */
  navigate: 'replace';
  params: RetakeLaunchParams;
}

export type RetakeFromResultsPlan =
  /** Relaunch from the attempt's own question snapshots. */
  | (RetakeLaunchPlanBase & { action: 'retakeQuestionSet' })
  /** Relaunch the source test through the store's normal start path. */
  | (RetakeLaunchPlanBase & { action: 'retakeTest'; testId: string })
  | { action: 'unavailable'; reason: RetakeUnavailableReason; message: string };

const UNAVAILABLE_MESSAGES: Record<RetakeUnavailableReason, string> = {
  missingAttempt: 'These results could not be loaded, so there is nothing to retake.',
  noQuestions: 'Question data is no longer available for this test.',
  notRetakeable: 'This test can only be taken once.',
};

function unavailable(reason: RetakeUnavailableReason): RetakeFromResultsPlan {
  return { action: 'unavailable', reason, message: UNAVAILABLE_MESSAGES[reason] };
}

/**
 * Minutes a retake runs for — the ONE rule, reached from this launch path too.
 *
 * A recorded limit wins outright, 0 included: an attempt taken untimed retakes
 * untimed, which is exactly the substitution round 3 removed elsewhere. Only an
 * attempt with no recorded timer at all falls back on the source test's limit.
 */
export function resolveRetakeTimeLimitMinutes(input: {
  recordedMinutes?: number | null;
  fallbackMinutes?: number | null;
}): number {
  const recorded = { timerDurationMinutes: input.recordedMinutes ?? undefined };
  if (hasStoredTimerChoice(recorded)) return resolveAttemptTimeLimitMinutes(recorded);

  const fallback = input.fallbackMinutes;
  if (typeof fallback !== 'number' || !Number.isFinite(fallback) || fallback <= 0) return 0;
  return Math.round(fallback);
}

/**
 * What "Try Again" should do for the attempt on screen.
 *
 * Preference order matches the tests list's Retake (screens/tests/TestScreen
 * `handleRetake`) so both buttons launch the same way:
 *   1. the attempt's own question snapshots — the exact question set sat,
 *      even when the source test has since been edited or deleted;
 *   2. the source test, started through the store (which re-applies the
 *      reader's shuffle settings and can refetch questions);
 *   3. nothing — a downloaded attempt whose snapshots were dropped and whose
 *      test is gone cannot be reconstructed, so the button says so instead of
 *      launching an empty session.
 */
export function planRetakeFromResults(input: RetakeFromResultsInput): RetakeFromResultsPlan {
  const { attempt, snapshotCount, sourceTest, retakeBlocked, returnTo } = input;
  if (!attempt) return unavailable('missingAttempt');
  if (retakeBlocked) return unavailable('notRetakeable');

  const sessionName = attempt.testName?.trim() || sourceTest?.name?.trim() || 'Retake';
  // Spread, not a `returnTo: undefined` key: params go into route params and
  // an explicit undefined would overwrite nothing but reads as a decision.
  const carriedReturn = returnTo ? { returnTo } : {};
  const shared = {
    sessionName,
    groupId: attempt.groupId,
    groupName: attempt.groupName,
    courseId: attempt.courseId ?? null,
    topicId: attempt.topicId ?? null,
    navigate: 'replace' as const,
  };

  if (snapshotCount > 0) {
    return {
      ...shared,
      action: 'retakeQuestionSet',
      timeLimitMinutes: resolveRetakeTimeLimitMinutes({
        // No source test is consulted here: the questions ARE the attempt's,
        // so the attempt's timer is the only honest answer.
        recordedMinutes: attempt.timeLimitMinutes,
      }),
      params: {
        testId: 'custom',
        testName: sessionName,
        mode: 'test',
        groupId: attempt.groupId,
        groupName: attempt.groupName,
        ...carriedReturn,
      },
    };
  }

  if (sourceTest?.id) {
    const name = sourceTest.name?.trim() || sessionName;
    return {
      ...shared,
      sessionName: name,
      action: 'retakeTest',
      testId: sourceTest.id,
      timeLimitMinutes: resolveRetakeTimeLimitMinutes({
        recordedMinutes: attempt.timeLimitMinutes,
        fallbackMinutes: sourceTest.timeLimit,
      }),
      params: {
        testId: sourceTest.id,
        testName: name,
        mode: 'test',
        groupId: attempt.groupId,
        groupName: attempt.groupName,
        ...carriedReturn,
      },
    };
  }

  return unavailable('noQuestions');
}
