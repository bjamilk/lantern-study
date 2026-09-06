import {
  resolveChatLoadOutcome,
  resolveChatMessagesState,
} from './chatLoadState';

describe('resolveChatLoadOutcome', () => {
  it('calls a load that wrote a fresh pagination slot a success', () => {
    const before = { page: 1, hasMore: true };
    const after = { page: 1, hasMore: true }; // same value, new object
    expect(
      resolveChatLoadOutcome({ paginationBefore: before, paginationAfter: after })
    ).toEqual({ failed: false, error: null });
  });

  it('calls a load that left the slot untouched a failure', () => {
    const slot = { page: 1, hasMore: true };
    expect(
      resolveChatLoadOutcome({
        paginationBefore: slot,
        paginationAfter: slot,
        storeError: 'Network request failed',
      })
    ).toEqual({ failed: true, error: 'Network request failed' });
  });

  it('still reports the failure when the store error has been cleared', () => {
    // The actual device defect: `fetchGroups` runs underneath the thread and
    // resets the store-wide `error` to null, so the message is gone by the
    // time we look. The pagination slot still says the load never landed.
    const outcome = resolveChatLoadOutcome({
      paginationBefore: undefined,
      paginationAfter: undefined,
      storeError: null,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.error).toBeTruthy();
  });

  it('treats a first-ever load that wrote nothing as a failure, not an empty chat', () => {
    expect(
      resolveChatLoadOutcome({ paginationBefore: undefined, paginationAfter: undefined })
        .failed
    ).toBe(true);
  });

  it('treats a first-ever load that wrote a slot as a success', () => {
    expect(
      resolveChatLoadOutcome({
        paginationBefore: undefined,
        paginationAfter: { page: 1, hasMore: false },
      })
    ).toEqual({ failed: false, error: null });
  });
});

describe('resolveChatMessagesState', () => {
  it('shows cached messages with a stale banner when a refresh fails', () => {
    expect(
      resolveChatMessagesState({
        loading: false,
        error: 'Network request failed',
        cachedMessageCount: 12,
      })
    ).toBe('stale');
  });

  it('never calls a failed load an empty chat', () => {
    // The screenshot: offline, nothing cached, and the thread said
    // "No messages yet. Say hello!".
    expect(
      resolveChatMessagesState({
        loading: false,
        error: 'Network request failed',
        cachedMessageCount: 0,
      })
    ).toBe('failed');
  });

  it('only says empty after a load that actually succeeded with zero messages', () => {
    expect(
      resolveChatMessagesState({ loading: false, error: null, cachedMessageCount: 0 })
    ).toBe('empty');
  });

  it('spins only while the first load is in flight with nothing to show', () => {
    expect(
      resolveChatMessagesState({ loading: true, error: null, cachedMessageCount: 0 })
    ).toBe('loading');
    // A refresh over cached messages keeps the messages, not a spinner.
    expect(
      resolveChatMessagesState({ loading: true, error: null, cachedMessageCount: 3 })
    ).toBe('ready');
  });

  it('counts the cached messages, so a starred filter with no hits is not a failure', () => {
    expect(
      resolveChatMessagesState({ loading: false, error: null, cachedMessageCount: 8 })
    ).toBe('ready');
  });
});
