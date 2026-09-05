import {
  REQUEST_FAILURE_COPY,
  classifyRequestFailure,
  isRequestFailureRetryable,
  requestFailureCopy,
  requestFailureSentence,
  resolveListState,
} from './requestErrorCopy';

describe('classifyRequestFailure', () => {
  it('reads the React Native offline message', () => {
    expect(classifyRequestFailure(new Error('Network request failed'))).toBe('offline');
  });

  it('reads the browser offline message', () => {
    expect(classifyRequestFailure(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classifyRequestFailure(new TypeError('Load failed'))).toBe('offline');
  });

  it('treats the offline 401 as offline, not as an access problem', () => {
    const offline401 = Object.assign(new Error('You appear to be offline.'), {
      status: 401,
      offline: true,
    });
    expect(classifyRequestFailure(offline401)).toBe('offline');
  });

  it('reads the shared client timeout and AbortError', () => {
    expect(classifyRequestFailure(new Error('Request timed out'))).toBe('timeout');
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(classifyRequestFailure(aborted)).toBe('timeout');
  });

  it('maps status codes to kinds', () => {
    const withStatus = (status: number) =>
      classifyRequestFailure(Object.assign(new Error('HTTP error'), { status }));
    expect(withStatus(408)).toBe('timeout');
    expect(withStatus(504)).toBe('timeout');
    expect(withStatus(404)).toBe('notFound');
    expect(withStatus(410)).toBe('notFound');
    expect(withStatus(429)).toBe('rateLimited');
    expect(withStatus(401)).toBe('forbidden');
    expect(withStatus(403)).toBe('forbidden');
    expect(withStatus(500)).toBe('server');
    expect(withStatus(503)).toBe('server');
    expect(withStatus(422)).toBe('unknown');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyRequestFailure(null)).toBe('unknown');
    expect(classifyRequestFailure(undefined)).toBe('unknown');
    expect(classifyRequestFailure({})).toBe('unknown');
    expect(classifyRequestFailure(new Error('Something odd'))).toBe('unknown');
  });

  it('accepts a bare string', () => {
    expect(classifyRequestFailure('Network request failed')).toBe('offline');
  });
});

describe('copy', () => {
  it('gives the headline offline sentence', () => {
    expect(requestFailureSentence(new Error('Network request failed'))).toBe(
      'We couldn’t reach Lantern. Check your connection and try again.',
    );
  });

  it('says something different for each kind', () => {
    const sentences = Object.values(REQUEST_FAILURE_COPY).map((c) => `${c.title}. ${c.body}`);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('never blames the student for a server fault', () => {
    expect(REQUEST_FAILURE_COPY.server.body).toContain('our side');
  });

  it('offers a retry everywhere retrying can help, and not on not-found', () => {
    expect(isRequestFailureRetryable(new Error('Network request failed'))).toBe(true);
    expect(isRequestFailureRetryable(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
    expect(isRequestFailureRetryable(Object.assign(new Error('x'), { status: 404 }))).toBe(false);
    expect(requestFailureCopy(Object.assign(new Error('x'), { status: 404 })).retryLabel).toBeNull();
  });
});

describe('resolveListState — a failed load is never an empty state', () => {
  it('calls a failed load with no rows "failed", not "empty"', () => {
    expect(
      resolveListState({ loading: false, error: new Error('Network request failed'), itemCount: 0 }),
    ).toBe('failed');
  });

  it('calls a failed SEARCH "failed", never "no match"', () => {
    expect(
      resolveListState({
        loading: false,
        error: new Error('Network request failed'),
        itemCount: 0,
        query: 'pharmacology',
      }),
    ).toBe('failed');
  });

  it('keeps rows we already have and flags them as stale', () => {
    expect(
      resolveListState({ loading: false, error: new Error('Request timed out'), itemCount: 4 }),
    ).toBe('stale');
  });

  it('only says "no match" when the load actually succeeded', () => {
    expect(resolveListState({ loading: false, error: null, itemCount: 0, query: 'x' })).toBe(
      'noMatch',
    );
    expect(resolveListState({ loading: false, error: null, itemCount: 0, query: '   ' })).toBe(
      'empty',
    );
    expect(resolveListState({ loading: false, error: null, itemCount: 0 })).toBe('empty');
  });

  it('shows the spinner only while a first load is in flight', () => {
    expect(resolveListState({ loading: true, error: null, itemCount: 0 })).toBe('loading');
    expect(resolveListState({ loading: true, error: null, itemCount: 3 })).toBe('ready');
  });

  it('prefers the failure over the spinner on a refresh that failed', () => {
    expect(
      resolveListState({ loading: true, error: new Error('Request timed out'), itemCount: 0 }),
    ).toBe('failed');
  });
});
