import {
  planTabPress,
  planTabRootReset,
  TAB_STACK_ROOT_ROUTE,
  type TabRouteLike,
} from './tabPressBehavior';

const routes: TabRouteLike[] = [
  { key: 'HomeTab-1', name: 'HomeTab' },
  { key: 'StudyTab-1', name: 'StudyTab' },
  { key: 'ChatTab-1', name: 'ChatTab' },
  { key: 'CampusTab-1', name: 'CampusTab' },
  { key: 'MeTab-1', name: 'MeTab' },
];

describe('planTabPress', () => {
  it('emits tabPress on the active tab and does NOT re-navigate', () => {
    // Study → Tests, pressing Study: the emit is the whole point, because the
    // nested stack's own listener is what pops it back to the tab root.
    const plan = planTabPress({ routes, index: 1, routeName: 'StudyTab' });
    expect(plan.alreadyFocused).toBe(true);
    expect(plan.emitTarget).toBe('StudyTab-1');
    expect(plan.navigateTo).toBeNull();
  });

  it('navigates to an inactive tab, which keeps its remembered stack', () => {
    const plan = planTabPress({ routes, index: 1, routeName: 'ChatTab' });
    expect(plan.alreadyFocused).toBe(false);
    expect(plan.navigateTo).toBe('ChatTab');
  });

  it('still emits for an inactive tab, as the stock bar does', () => {
    // Harmless: the nested listener pops only when its own stack is focused,
    // so an inactive tab's remembered screens survive the press.
    const plan = planTabPress({ routes, index: 1, routeName: 'ChatTab' });
    expect(plan.emitTarget).toBe('ChatTab-1');
  });

  it('emits on the pressed tab, never on the focused one', () => {
    const plan = planTabPress({ routes, index: 0, routeName: 'MeTab' });
    expect(plan.emitTarget).toBe('MeTab-1');
  });

  it('has nothing to emit on for a route this navigator does not hold, and just navigates', () => {
    const plan = planTabPress({ routes, index: 1, routeName: 'NotesTab' });
    expect(plan).toEqual({
      emitTarget: null,
      navigateTo: 'NotesTab',
      alreadyFocused: false,
      resetToRoot: false,
    });
  });

  it('treats an out-of-range index as no tab focused', () => {
    const plan = planTabPress({ routes, index: 99, routeName: 'StudyTab' });
    expect(plan.alreadyFocused).toBe(false);
    expect(plan.navigateTo).toBe('StudyTab');
  });

  it('matches on key, not name, when the navigator has been remounted', () => {
    const remounted: TabRouteLike[] = [
      { key: 'StudyTab-7', name: 'StudyTab' },
      { key: 'HomeTab-7', name: 'HomeTab' },
    ];
    expect(planTabPress({ routes: remounted, index: 0, routeName: 'StudyTab' }).emitTarget).toBe(
      'StudyTab-7'
    );
  });
});

describe('the Study tab always opens on its hub (SF2 §6 #10)', () => {
  it('asks for a root reset on Study, whichever tab the press came from', () => {
    const fromHome = planTabPress({ routes, index: 0, routeName: 'StudyTab' });
    const reTap = planTabPress({ routes, index: 1, routeName: 'StudyTab' });
    expect(fromHome.resetToRoot).toBe(true);
    expect(reTap.resetToRoot).toBe(true);
    // Still an ordinary tab switch otherwise: the remembered stack is reset,
    // not the navigate skipped.
    expect(fromHome.navigateTo).toBe('StudyTab');
  });

  it('leaves every other tab remembering where it was', () => {
    for (const routeName of ['HomeTab', 'ChatTab', 'CampusTab', 'MeTab']) {
      expect(planTabPress({ routes, index: 1, routeName }).resetToRoot).toBe(false);
    }
  });

  it('resets a Study stack that is sitting ON its root but two deep', () => {
    // The §6 #10 shape exactly: StudyHub → CourseRoom → LectureStudio, with the
    // press arriving from another tab, where native-stack pops nothing.
    const plan = planTabRootReset({
      childState: {
        key: 'study-1',
        routes: [{ name: 'StudyHub' }, { name: 'CourseRoom' }, { name: 'LectureStudio' }],
      },
      initialRouteName: 'StudyHub',
      always: true,
    });
    expect(plan).toEqual({ resetTo: 'StudyHub', target: 'study-1' });
  });

  it('does nothing when the stack is already the hub alone', () => {
    expect(
      planTabRootReset({
        childState: { key: 'study-1', routes: [{ name: 'StudyHub' }] },
        initialRouteName: 'StudyHub',
        always: true,
      })
    ).toEqual({ resetTo: null, target: null });
  });

  it('without `always`, a rooted stack is still left to popToTop', () => {
    expect(
      planTabRootReset({
        childState: { key: 'study-1', routes: [{ name: 'StudyHub' }, { name: 'CourseRoom' }] },
        initialRouteName: 'StudyHub',
      })
    ).toEqual({ resetTo: null, target: null });
  });
});

describe('planTabRootReset', () => {
  const STUDY_ROOT = TAB_STACK_ROOT_ROUTE.StudyTab;

  it('leaves a stack entered through its root to popToTop', () => {
    // Study → Library → Tests, the ordinary way in. routes[0] IS StudyHub, so
    // native-stack's own tabPress listener already lands on the Study root.
    const plan = planTabRootReset({
      childState: {
        key: 'stack-study',
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'Library' }, { name: 'TestsList' }],
      },
      initialRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ resetTo: null, target: null });
  });

  it('resets when a nested navigate made a deep screen the stack ROOT', () => {
    // `navigate('StudyTab', { screen: 'TestTaking' })` with no `initial: false`
    // gives the Study stack exactly one route. index is 0, so popToTop is a
    // no-op and the dead "session ended" screen is unreachable-from.
    const plan = planTabRootReset({
      childState: { key: 'stack-study', index: 0, routes: [{ name: 'TestTaking' }] },
      initialRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ resetTo: 'StudyHub', target: 'stack-study' });
  });

  it('resets a stack rooted at Library that popToTop only pops ONE level of', () => {
    // The reported Form 2: Home → Library, then Library → Tests. popToTop
    // stops at Library, whose own back button exits to Home.
    const plan = planTabRootReset({
      childState: {
        key: 'stack-study',
        index: 1,
        routes: [{ name: 'Library' }, { name: 'TestsList' }],
      },
      initialRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ resetTo: 'StudyHub', target: 'stack-study' });
  });

  it('leaves Campus alone — its stack is rooted at Campus', () => {
    const plan = planTabRootReset({
      childState: {
        key: 'stack-campus',
        index: 1,
        routes: [{ name: 'Campus' }, { name: 'ListingDetail' }],
      },
      initialRouteName: TAB_STACK_ROOT_ROUTE.CampusTab,
    });
    expect(plan.resetTo).toBeNull();
  });

  it('does nothing for a lazy tab that has never mounted', () => {
    expect(planTabRootReset({ childState: undefined, initialRouteName: STUDY_ROOT })).toEqual({
      resetTo: null,
      target: null,
    });
    expect(planTabRootReset({ childState: { routes: [] }, initialRouteName: STUDY_ROOT })).toEqual({
      resetTo: null,
      target: null,
    });
  });

  it('waits for rehydration when the state carries no key', () => {
    // The partial state built from params has no key, so a targeted dispatch
    // would go nowhere. The next press sees the rehydrated state.
    const plan = planTabRootReset({
      childState: { routes: [{ name: 'TestTaking' }] },
      initialRouteName: STUDY_ROOT,
    });
    expect(plan).toEqual({ resetTo: null, target: null });
  });

  it('does nothing when the tab declares no root route', () => {
    const plan = planTabRootReset({
      childState: { key: 'stack-x', index: 0, routes: [{ name: 'Whatever' }] },
      initialRouteName: undefined,
    });
    expect(plan).toEqual({ resetTo: null, target: null });
  });
});
