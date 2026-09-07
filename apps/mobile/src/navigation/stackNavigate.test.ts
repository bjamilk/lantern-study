import { planStackNavigate } from './stackNavigate';

describe('reaching a screen inside the focused stack', () => {
  it('aims a plain navigate at the child navigator when its key is known', () => {
    expect(
      planStackNavigate({
        childState: { key: 'stack-7' },
        tabRouteName: 'StudyTab',
        route: 'TestsList',
      }),
    ).toEqual({ kind: 'dispatch', target: 'stack-7', route: 'TestsList' });
  });

  it('carries params on the dispatch, and invents none', () => {
    expect(
      planStackNavigate({
        childState: { key: 'stack-7' },
        tabRouteName: 'StudyTab',
        route: 'Library',
        params: { tab: 'notes' },
      }),
    ).toEqual({ kind: 'dispatch', target: 'stack-7', route: 'Library', params: { tab: 'notes' } });

    const plan = planStackNavigate({
      childState: { key: 'stack-7' },
      tabRouteName: 'StudyTab',
      route: 'Library',
    });
    expect(Object.prototype.hasOwnProperty.call(plan, 'params')).toBe(false);
  });

  it('still navigates from the stack ROOT, where there is no key yet', () => {
    // A nested navigator's state does not reach its parent until something
    // inside it has navigated. On the Study hub — the stack's own root, freshly
    // opened — there was no key, the dispatch was skipped, and pressing Tests
    // in the row did nothing at all.
    for (const childState of [undefined, null, {}, { key: '' }]) {
      expect(planStackNavigate({ childState, tabRouteName: 'StudyTab', route: 'TestsList' })).toEqual(
        {
          kind: 'nested',
          tabRouteName: 'StudyTab',
          params: { screen: 'TestsList', initial: false },
        },
      );
    }
  });

  it('never drops the tab’s own root on that fallback', () => {
    // `initial: false` is the whole point: without it the stack is built as
    // [TestsList] and Back leaves the tab instead of reaching StudyHub.
    const plan = planStackNavigate({
      childState: undefined,
      tabRouteName: 'StudyTab',
      route: 'TestsList',
      params: { filter: 'available' },
    });
    expect(plan).toEqual({
      kind: 'nested',
      tabRouteName: 'StudyTab',
      params: { screen: 'TestsList', params: { filter: 'available' }, initial: false },
    });
  });

  it('sends the same route either way', () => {
    // The two forms differ only in how they are addressed. A press from the
    // hub root and the same press from Library must land on one screen.
    const fromRoot = planStackNavigate({
      childState: undefined,
      tabRouteName: 'StudyTab',
      route: 'TestsList',
    });
    const fromPushed = planStackNavigate({
      childState: { key: 'stack-7' },
      tabRouteName: 'StudyTab',
      route: 'TestsList',
    });
    expect(fromRoot.kind === 'nested' ? fromRoot.params.screen : null).toBe('TestsList');
    expect(fromPushed.kind === 'dispatch' ? fromPushed.route : null).toBe('TestsList');
  });
});
