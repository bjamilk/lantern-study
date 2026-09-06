import { planExitToTestsList, planTestExit } from './testSessionExit';

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
