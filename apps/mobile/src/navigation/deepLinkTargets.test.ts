import { resolveDeepLinkNavigation } from './deepLinkTargets';

describe('resolveDeepLinkNavigation', () => {
  it('opens a generated test as the test itself, under the Study tab root', () => {
    const target = resolveDeepLinkNavigation(
      'lanternstudy://test/abc-123?name=Quiz%20%C2%B7%20SDOH'
    );
    expect(target).toEqual({
      screen: 'StudyTab',
      params: {
        screen: 'TestTaking',
        params: { testId: 'abc-123', testName: 'Quiz · SDOH' },
        // Load-bearing: without it TestTaking becomes the stack's only route
        // and Back leaves the tab (navigation/nestedTab.ts).
        initial: false,
      },
    });
  });

  it('falls back to a title rather than opening a screen with none', () => {
    const target = resolveDeepLinkNavigation('lanternstudy://test/abc-123');
    expect((target?.params as any)?.params).toEqual({
      testId: 'abc-123',
      testName: 'Your test',
    });
  });

  it('has no target for a test link with no test in it', () => {
    // `parseDeepLink` needs `<type>/<id>`, so a bare `test` link never becomes
    // a target at all; the caller falls back to Home rather than opening an
    // empty session.
    expect(resolveDeepLinkNavigation('lanternstudy://test')).toBeNull();
  });

  it('still lands the legacy daily-quiz reference on the dashboard', () => {
    // Job records persisted by the build that filed note quizzes under
    // `quiz/daily` are still on devices; their link must resolve to something.
    expect(resolveDeepLinkNavigation('lanternstudy://quiz/daily')).toEqual({
      screen: 'HomeTab',
    });
  });

  it('opens a deck at the deck, with the Study root beneath it', () => {
    expect(resolveDeepLinkNavigation('lanternstudy://deck/deck-9')).toEqual({
      screen: 'StudyTab',
      params: { screen: 'DeckDetail', params: { deckId: 'deck-9' }, initial: false },
    });
  });

  it('refuses to invent a target for a link it does not know', () => {
    expect(resolveDeepLinkNavigation('lanternstudy://sausages/3')).toBeNull();
    expect(resolveDeepLinkNavigation('not a url')).toBeNull();
  });
});
