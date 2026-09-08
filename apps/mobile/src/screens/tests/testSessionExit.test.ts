import {
  planExitToTestsList,
  planSessionExitCopy,
  planRetakeFromResults,
  planTestExit,
  resolveRetakeTimeLimitMinutes,
} from './testSessionExit';

const STUDY_ROOT = 'StudyHub';

describe('planTestExit', () => {
  it('pops when the session was pushed onto a real Study stack', () => {
    // Study → Tests → TestTaking: back belongs on the tests list.
    const plan = planTestExit({
      state: {
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'TestsList' }, { name: 'TestTaking' }],
      },
      rootRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ action: 'pop' });
  });

  it('resets to the Study root when the session IS the bottom of the stack', () => {
    // `navigate('StudyTab', { screen: 'TestTaking' })` from Home. goBack()
    // here escapes to the tab navigator and lands on Home, leaving this
    // screen mounted as the Study root — the dead "session ended" screen.
    const plan = planTestExit({
      state: { index: 0, routes: [{ name: 'TestTaking' }] },
      rootRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ action: 'resetToRoot', routes: ['StudyHub'] });
  });

  it('resets when the results screen replaced a root-only session', () => {
    // submit → replace('TestResults') on a one-route stack keeps it one route.
    const plan = planTestExit({
      state: { index: 0, routes: [{ name: 'TestResults' }] },
      rootRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ action: 'resetToRoot', routes: ['StudyHub'] });
  });

  it('still pops from analysis pushed above a root-only results screen', () => {
    const plan = planTestExit({
      state: { index: 1, routes: [{ name: 'TestResults' }, { name: 'TestAnalysis' }] },
      rootRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ action: 'pop' });
  });

  it('falls back to the last route when the state carries no index', () => {
    expect(
      planTestExit({
        state: { routes: [{ name: 'StudyHub' }, { name: 'TestTaking' }] },
        rootRouteName: STUDY_ROOT,
      })
    ).toEqual({ action: 'pop' });
  });

  it('resets when there is no state to read at all', () => {
    expect(planTestExit({ state: undefined, rootRouteName: STUDY_ROOT })).toEqual({
      action: 'resetToRoot',
      routes: ['StudyHub'],
    });
  });
});

describe('planExitToTestsList', () => {
  const args = { rootRouteName: STUDY_ROOT, testsListRouteName: 'TestsList' };

  it('pops to the tests list when it is already in the stack (round 2)', () => {
    const plan = planExitToTestsList({
      state: {
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'TestsList' }, { name: 'TestResults' }],
      },
      ...args,
    });
    expect(plan).toEqual({ action: 'popTo', routeName: 'TestsList' });
  });

  it('still uses popTo on a rooted stack, where it replaces the results', () => {
    // [StudyHub, TestResults] → popTo leaves [StudyHub, TestsList]: the
    // results are gone and the Study root survives underneath.
    const plan = planExitToTestsList({
      state: { index: 1, routes: [{ name: 'StudyHub' }, { name: 'TestResults' }] },
      ...args,
    });
    expect(plan).toEqual({ action: 'popTo', routeName: 'TestsList' });
  });

  it('rebuilds the stack when the results screen is the only route', () => {
    // popTo would leave a bottomless [TestsList] whose back exits to Home.
    const plan = planExitToTestsList({
      state: { index: 0, routes: [{ name: 'TestResults' }] },
      ...args,
    });
    expect(plan).toEqual({ action: 'resetToRoot', routes: ['StudyHub', 'TestsList'] });
  });

  it('rebuilds when there is no state to read', () => {
    expect(planExitToTestsList({ state: undefined, ...args })).toEqual({
      action: 'resetToRoot',
      routes: ['StudyHub', 'TestsList'],
    });
  });
});

describe('resolveRetakeTimeLimitMinutes', () => {
  it('keeps an untimed attempt untimed even when the test has a limit', () => {
    // The round-3 rule: a recorded 0 is the reader's "None", not a gap.
    expect(
      resolveRetakeTimeLimitMinutes({ recordedMinutes: 0, fallbackMinutes: 30 })
    ).toBe(0);
  });

  it('replays the attempt’s own limit', () => {
    expect(resolveRetakeTimeLimitMinutes({ recordedMinutes: 17, fallbackMinutes: 30 })).toBe(17);
  });

  it('falls back on the test only when nothing was recorded', () => {
    expect(resolveRetakeTimeLimitMinutes({ recordedMinutes: undefined, fallbackMinutes: 30 })).toBe(30);
    expect(resolveRetakeTimeLimitMinutes({ recordedMinutes: null, fallbackMinutes: 30 })).toBe(30);
  });

  it('is untimed when neither side has a limit', () => {
    expect(resolveRetakeTimeLimitMinutes({})).toBe(0);
    expect(resolveRetakeTimeLimitMinutes({ fallbackMinutes: 0 })).toBe(0);
    expect(resolveRetakeTimeLimitMinutes({ fallbackMinutes: Number.NaN })).toBe(0);
  });
});

describe('planRetakeFromResults', () => {
  const attempt = {
    testId: 'custom-99',
    originalTestId: 'test-1',
    testName: 'Pharmacology Midterm',
    timeLimitMinutes: 20,
    groupId: 'g1',
    groupName: 'Pharm Crew',
    courseId: 'c1',
    topicId: 't1',
  };

  it('replays the attempt’s own question snapshots, replacing the results', () => {
    const plan = planRetakeFromResults({ attempt, snapshotCount: 12 });
    expect(plan).toEqual({
      action: 'retakeQuestionSet',
      sessionName: 'Pharmacology Midterm',
      timeLimitMinutes: 20,
      groupId: 'g1',
      groupName: 'Pharm Crew',
      courseId: 'c1',
      topicId: 't1',
      navigate: 'replace',
      params: {
        testId: 'custom',
        testName: 'Pharmacology Midterm',
        mode: 'test',
        groupId: 'g1',
        groupName: 'Pharm Crew',
      },
    });
  });

  it('never re-times an untimed attempt, even beside a timed source test', () => {
    const plan = planRetakeFromResults({
      attempt: { ...attempt, timeLimitMinutes: 0 },
      snapshotCount: 12,
      sourceTest: { id: 'test-1', name: 'Pharmacology Midterm', timeLimit: 45 },
    });
    expect(plan).toMatchObject({ action: 'retakeQuestionSet', timeLimitMinutes: 0 });
  });

  it('falls back to the source test when the snapshots are gone', () => {
    const plan = planRetakeFromResults({
      attempt: { ...attempt, timeLimitMinutes: undefined },
      snapshotCount: 0,
      sourceTest: { id: 'test-1', name: 'Pharmacology (v2)', timeLimit: 45 },
    });
    expect(plan).toEqual({
      action: 'retakeTest',
      testId: 'test-1',
      sessionName: 'Pharmacology (v2)',
      timeLimitMinutes: 45,
      groupId: 'g1',
      groupName: 'Pharm Crew',
      courseId: 'c1',
      topicId: 't1',
      navigate: 'replace',
      params: {
        testId: 'test-1',
        testName: 'Pharmacology (v2)',
        mode: 'test',
        groupId: 'g1',
        groupName: 'Pharm Crew',
      },
    });
  });

  it('prefers the snapshots over a source test that has since been edited', () => {
    const plan = planRetakeFromResults({
      attempt,
      snapshotCount: 12,
      sourceTest: { id: 'test-1', name: 'Pharmacology (v2)', timeLimit: 45 },
    });
    expect(plan).toMatchObject({ action: 'retakeQuestionSet', timeLimitMinutes: 20 });
  });

  it('refuses when the attempt kept no questions and its test is gone', () => {
    // A downloaded/lean result row: nothing to reconstruct a session from.
    const plan = planRetakeFromResults({ attempt, snapshotCount: 0, sourceTest: null });
    expect(plan).toEqual({
      action: 'unavailable',
      reason: 'noQuestions',
      message: 'Question data is no longer available for this test.',
    });
  });

  it('refuses when the results themselves never loaded', () => {
    expect(planRetakeFromResults({ attempt: null, snapshotCount: 0 })).toMatchObject({
      action: 'unavailable',
      reason: 'missingAttempt',
    });
  });

  it('refuses a one-shot session before looking at its questions', () => {
    expect(
      planRetakeFromResults({ attempt, snapshotCount: 12, retakeBlocked: true })
    ).toMatchObject({ action: 'unavailable', reason: 'notRetakeable' });
  });

  it('always names the relaunched session something', () => {
    const plan = planRetakeFromResults({
      attempt: { testName: '   ' },
      snapshotCount: 3,
    });
    expect(plan).toMatchObject({ sessionName: 'Retake', params: { testName: 'Retake' } });
  });
});

/* ------------------------------------------------------------------ *
 * `returnTo` — a session launched from OUTSIDE the Study tab.
 *
 * Chat → thread → ⋮ → Test mode → Start Test runs the session on the STUDY
 * stack, so every exit landed the reader on the Study hub instead of the
 * thread they pressed the button in. The launcher now carries its own
 * address along, and these are the two rules that come out of it:
 *   1. with `returnTo`, exiting resets Study to its root AND goes back there
 *      — never one without the other, or a dead session screen is left on a
 *      tab nobody is looking at (the round-4 invariant);
 *   2. without it, nothing above changes at all.
 * ------------------------------------------------------------------ */

const RETURN_TO_THREAD = {
  tab: 'ChatTab',
  screen: 'GroupChat',
  params: { groupId: 'g1', groupName: 'Pharm Crew' },
};

describe('planTestExit with returnTo', () => {
  it('resets Study and returns to the launching tab', () => {
    const plan = planTestExit({
      state: { index: 0, routes: [{ name: 'TestTaking' }] },
      rootRouteName: STUDY_ROOT,
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toEqual({
      action: 'returnToTab',
      routes: ['StudyHub'],
      returnTo: RETURN_TO_THREAD,
    });
  });

  it('returns even when this stack could have popped', () => {
    // [StudyHub, TestsList, TestTaking] pops to the tests list without a
    // returnTo. With one, popping would leave the reader on a tab they never
    // opened AND strand the session screen under it.
    const plan = planTestExit({
      state: {
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'TestsList' }, { name: 'TestTaking' }],
      },
      rootRouteName: STUDY_ROOT,
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toEqual({
      action: 'returnToTab',
      routes: ['StudyHub'],
      returnTo: RETURN_TO_THREAD,
    });
  });

  it('is unchanged when returnTo is absent, null or undefined', () => {
    const state = { index: 0, routes: [{ name: 'TestTaking' }] };
    const expected = { action: 'resetToRoot', routes: ['StudyHub'] };
    expect(planTestExit({ state, rootRouteName: STUDY_ROOT })).toEqual(expected);
    expect(planTestExit({ state, rootRouteName: STUDY_ROOT, returnTo: null })).toEqual(expected);
    expect(
      planTestExit({ state, rootRouteName: STUDY_ROOT, returnTo: undefined })
    ).toEqual(expected);
  });
});

describe('planExitToTestsList with returnTo', () => {
  const args = { rootRouteName: STUDY_ROOT, testsListRouteName: 'TestsList' };

  it('sends Done back to the thread instead of the tests list', () => {
    const plan = planExitToTestsList({
      state: { index: 1, routes: [{ name: 'StudyHub' }, { name: 'TestResults' }] },
      ...args,
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toEqual({
      action: 'returnToTab',
      routes: ['StudyHub'],
      returnTo: RETURN_TO_THREAD,
    });
  });

  it('returns even when the tests list is sitting in the stack', () => {
    const plan = planExitToTestsList({
      state: {
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'TestsList' }, { name: 'TestResults' }],
      },
      ...args,
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toMatchObject({ action: 'returnToTab', returnTo: RETURN_TO_THREAD });
  });

  it('is unchanged without one — Done still lands on the tests list', () => {
    const state = { index: 1, routes: [{ name: 'StudyHub' }, { name: 'TestResults' }] };
    expect(planExitToTestsList({ state, ...args })).toEqual({
      action: 'popTo',
      routeName: 'TestsList',
    });
    expect(planExitToTestsList({ state, ...args, returnTo: null })).toEqual({
      action: 'popTo',
      routeName: 'TestsList',
    });
  });
});

describe('planRetakeFromResults with returnTo', () => {
  const attempt = {
    testId: 'custom-99',
    originalTestId: 'test-1',
    testName: 'Pharmacology Midterm',
    timeLimitMinutes: 20,
    groupId: 'g1',
    groupName: 'Pharm Crew',
  };

  it('carries the origin into a snapshot retake', () => {
    const plan = planRetakeFromResults({
      attempt,
      snapshotCount: 12,
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toMatchObject({
      action: 'retakeQuestionSet',
      params: { testId: 'custom', returnTo: RETURN_TO_THREAD },
    });
  });

  it('carries the origin into a source-test retake', () => {
    const plan = planRetakeFromResults({
      attempt: { ...attempt, timeLimitMinutes: undefined },
      snapshotCount: 0,
      sourceTest: { id: 'test-1', name: 'Pharmacology (v2)', timeLimit: 45 },
      returnTo: RETURN_TO_THREAD,
    });
    expect(plan).toMatchObject({
      action: 'retakeTest',
      testId: 'test-1',
      params: { testId: 'test-1', returnTo: RETURN_TO_THREAD },
    });
  });

  it('adds no returnTo key at all when there is none to carry', () => {
    const plan = planRetakeFromResults({ attempt, snapshotCount: 12 });
    expect(plan.action).toBe('retakeQuestionSet');
    if (plan.action === 'unavailable') throw new Error('expected a launchable plan');
    expect('returnTo' in plan.params).toBe(false);
  });
});

describe('planSessionExitCopy: the exit says what actually happens', () => {
  it('tells a test-taker the attempt is discarded, not merely "lost"', () => {
    const copy = planSessionExitCopy({ mode: 'test', answeredCount: 3, totalQuestions: 15 });

    expect(copy.title).toBe('Exit test?');
    expect(copy.message).toBe(
      'You have answered 3 of 15. Leaving discards this attempt — it is not saved, not scored, and will not appear in History.'
    );
    expect(copy.confirmLabel).toBe('Discard attempt');
    expect(copy.destructive).toBe(true);
  });

  it('never tells a practice reader they can come back — the draft is abandoned', () => {
    const copy = planSessionExitCopy({ mode: 'study', answeredCount: 2, totalQuestions: 10 });

    expect(copy.message).toContain('is not saved');
    expect(copy.message).not.toMatch(/come back|resume|saved session/i);
    expect(copy.destructive).toBe(false);
  });

  it('leaves the progress sentence out when nothing has been answered', () => {
    const copy = planSessionExitCopy({ mode: 'test', answeredCount: 0, totalQuestions: 15 });

    expect(copy.message.startsWith('Leaving discards')).toBe(true);
  });

  it('promises no control the player does not have', () => {
    for (const mode of ['test', 'study'] as const) {
      const copy = planSessionExitCopy({ mode, answeredCount: 1, totalQuestions: 5 });
      expect(copy.message).not.toMatch(/pause|save (and|&) exit/i);
    }
  });
});
