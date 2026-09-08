import {
  REQUEST_FAILURE_COPY,
  STALE_PROGRESS_COPY,
  UNAVAILABLE_PROGRESS_COPY,
  classifyRequestFailure,
  humanizeFailureMessage,
  isRequestFailureRetryable,
  lastSyncedLabel,
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

describe('lastSyncedLabel', () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);
  const minutes = (n: number) => now - n * 60_000;

  it('dates a figure we are showing from cache', () => {
    expect(lastSyncedLabel(minutes(0), now)).toBe('Last synced just now');
    expect(lastSyncedLabel(minutes(5), now)).toBe('Last synced 5m ago');
    expect(lastSyncedLabel(minutes(90), now)).toBe('Last synced 1h ago');
    expect(lastSyncedLabel(minutes(60 * 26), now)).toBe('Last synced 1d ago');
  });

  // Never invent a time: a stamp we do not have is said vaguely, not as "now".
  it('stays honest when no sync time was recorded', () => {
    expect(lastSyncedLabel(null, now)).toBe('Last synced a while ago');
    expect(lastSyncedLabel(undefined, now)).toBe('Last synced a while ago');
    expect(lastSyncedLabel(Number.NaN, now)).toBe('Last synced a while ago');
  });

  it('does not go backwards when the device clock is ahead', () => {
    expect(lastSyncedLabel(now + 5_000, now)).toBe('Last synced just now');
  });
});

describe('progress copy', () => {
  it('never offers a number in place of one it could not fetch', () => {
    for (const copy of [STALE_PROGRESS_COPY, UNAVAILABLE_PROGRESS_COPY]) {
      expect(copy.title).not.toMatch(/\b0\b/);
      expect(copy.body).not.toMatch(/\b0\b/);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });
});

describe('humanizeFailureMessage', () => {
  it('replaces the raw React Native message the audit found on Library and Flashcards', () => {
    expect(humanizeFailureMessage('Network request failed')).toBe(
      'We couldn’t reach Lantern. Check your connection and try again.',
    );
    expect(humanizeFailureMessage(new Error('Network request failed'))).toBe(
      'We couldn’t reach Lantern. Check your connection and try again.',
    );
  });

  it('replaces the browser wording for the same event with the same sentence', () => {
    expect(humanizeFailureMessage('TypeError: Failed to fetch')).toBe(
      humanizeFailureMessage('Network request failed'),
    );
  });

  it('keeps a sentence the app wrote for this exact situation', () => {
    expect(humanizeFailureMessage('Could not delete this note')).toBe('Could not delete this note');
  });

  it('never prints a stack trace at a student', () => {
    expect(humanizeFailureMessage('JSON Parse error: Unexpected EOF')).toBe(
      'We couldn’t load this. Something went wrong on the way to Lantern. Try again.',
    );
    expect(humanizeFailureMessage("undefined is not an object (evaluating 'x.y')")).toBe(
      'We couldn’t load this. Something went wrong on the way to Lantern. Try again.',
    );
  });

  it('says something rather than nothing when the failure carried no message', () => {
    expect(humanizeFailureMessage('')).toBe(
      'We couldn’t load this. Something went wrong on the way to Lantern. Try again.',
    );
    expect(humanizeFailureMessage({ status: 503 })).toBe(
      'Lantern is having a problem. This one is on our side, not yours. Try again in a moment.',
    );
  });
});

describe('a raw server phrase never reaches a student verbatim', () => {
  // 2026-09-08: an ambiguous PostgREST embed answered PGRST201, the API mapped
  // it to a 400 "Invalid reference or relationship", and the community roster
  // rendered that string in red. The roster now speaks the shared vocabulary
  // for every non-forbidden failure instead of echoing err.message; this pins
  // that an unrecognised (400/unknown) server error becomes app copy.
  const rawEmbedError = { status: 400, message: 'Invalid reference or relationship' };

  it('classifies an unrecognised 4xx as unknown, not as a specific kind', () => {
    expect(classifyRequestFailure(rawEmbedError)).toBe('unknown');
  });

  it('renders the shared unknown sentence, not the raw phrase', () => {
    const sentence = requestFailureSentence(rawEmbedError);
    expect(sentence).toBe('We couldn’t load this. Something went wrong on the way to Lantern. Try again.');
    expect(sentence).not.toContain('Invalid reference or relationship');
  });
});
