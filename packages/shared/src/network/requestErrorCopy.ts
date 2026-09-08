// ===========================================
// Lantern Study - One failure vocabulary
// ===========================================
/**
 * The single copy set for "a request did not give us what we asked for".
 *
 * The audit found six different vocabularies for the same event — raw
 * "Network request failed" from React Native, "Request timed out" from the
 * client's abort path, bare red text with no retry, blank spinners with no way
 * back, "Couldn't refresh" — plus empty states that blamed the student ("Add
 * your university and courses…") when the real cause was a failed fetch.
 *
 * Everything here is pure and platform-free so web and mobile cannot drift.
 * The rendering lives in the two `RequestError` components (one per client);
 * this module owns the WORDS and the CLASSIFICATION, nothing else.
 *
 * THE HARD RULE, encoded in `resolveListState` below:
 *
 *   A failed load NEVER renders as an empty state or a "no results" message.
 *   Searching over a list that failed to load says "we couldn't load it",
 *   never "no match" — because "no match" is a claim about the data, and a
 *   request that failed told us nothing about the data.
 */

/** What went wrong, at the only granularity the copy actually distinguishes. */
export type RequestFailureKind =
  | 'offline'
  | 'timeout'
  | 'server'
  | 'notFound'
  | 'forbidden'
  | 'rateLimited'
  | 'unknown';

export interface RequestFailureCopy {
  /** Sentence one. Never ends in punctuation — callers join it themselves. */
  title: string;
  /** Sentence two: what to do, or why it is not the student's fault. */
  body: string;
  /**
   * Label for the recovery button, or null when retrying cannot help (a 404
   * will still be a 404). A null here means the UI offers "Go back" instead.
   */
  retryLabel: string | null;
}

/**
 * The whole vocabulary. Six kinds, one voice: name the failure, say it is not
 * about the student, offer the one action that can help.
 */
export const REQUEST_FAILURE_COPY: Record<RequestFailureKind, RequestFailureCopy> = {
  offline: {
    title: 'We couldn’t reach Lantern',
    body: 'Check your connection and try again.',
    retryLabel: 'Try again',
  },
  timeout: {
    title: 'Lantern took too long to answer',
    body: 'The connection may be slow right now. Try again.',
    retryLabel: 'Try again',
  },
  server: {
    title: 'Lantern is having a problem',
    body: 'This one is on our side, not yours. Try again in a moment.',
    retryLabel: 'Try again',
  },
  notFound: {
    title: 'We couldn’t find this',
    body: 'It may have been removed, or the link is out of date.',
    retryLabel: null,
  },
  forbidden: {
    title: 'You don’t have access to this',
    body: 'Sign in again, or ask whoever owns it to let you in.',
    retryLabel: 'Try again',
  },
  rateLimited: {
    title: 'That was a lot of tries at once',
    body: 'Wait a moment, then try again.',
    retryLabel: 'Try again',
  },
  unknown: {
    title: 'We couldn’t load this',
    body: 'Something went wrong on the way to Lantern. Try again.',
    retryLabel: 'Try again',
  },
};

const OFFLINE_MESSAGE_MARKERS = [
  'network request failed',
  'failed to fetch',
  'networkerror',
  'load failed',
  'network error',
  'you appear to be offline',
  'no internet',
  'err_internet_disconnected',
  'err_network',
  'err_name_not_resolved',
];

const TIMEOUT_MESSAGE_MARKERS = ['request timed out', 'timed out', 'timeout', 'aborted'];

const readString = (value: unknown, key: string): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : undefined;
};

const readNumber = (value: unknown, key: string): number | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
};

/**
 * Classify anything a `catch` block can hand us.
 *
 * Order matters. An explicit `offline` flag (the client's offline 401) beats
 * its own 401 status, because "we could not tell whether your session is
 * alive" is a connection story, not an access story.
 */
export function classifyRequestFailure(error: unknown): RequestFailureKind {
  if (error == null) return 'unknown';

  // The shared client's OfflineAuthError, and anything else that says so.
  if (error && typeof error === 'object' && (error as { offline?: unknown }).offline === true) {
    return 'offline';
  }

  const name = readString(error, 'name') ?? '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';

  const status = readNumber(error, 'status') ?? readNumber(error, 'statusCode');
  if (status != null) {
    if (status === 408 || status === 504) return 'timeout';
    if (status === 404 || status === 410) return 'notFound';
    if (status === 429) return 'rateLimited';
    if (status === 401 || status === 403) return 'forbidden';
    if (status >= 500) return 'server';
    // Any other 4xx is a request we cannot fix by retrying differently here;
    // the honest generic is "we couldn't load this".
    if (status >= 400) return 'unknown';
  }

  const message = (
    typeof error === 'string' ? error : (readString(error, 'message') ?? '')
  ).toLowerCase();
  if (!message) return 'unknown';

  if (OFFLINE_MESSAGE_MARKERS.some((marker) => message.includes(marker))) return 'offline';
  if (TIMEOUT_MESSAGE_MARKERS.some((marker) => message.includes(marker))) return 'timeout';
  if (message.includes('not found')) return 'notFound';

  return 'unknown';
}

/** The copy for whatever this error turns out to be. Never returns null. */
export function requestFailureCopy(error: unknown): RequestFailureCopy {
  return REQUEST_FAILURE_COPY[classifyRequestFailure(error)];
}

/**
 * One sentence, for inline banners that have no room for a title and a body:
 * "We couldn’t reach Lantern. Check your connection and try again."
 */
export function requestFailureSentence(error: unknown): string {
  const copy = requestFailureCopy(error);
  return `${copy.title}. ${copy.body}`;
}

/**
 * Messages that are a stack trace wearing a sentence: nothing in them was
 * written for a student, so none of them may reach one verbatim.
 */
const MACHINE_MESSAGE_PATTERNS = [
  /^[A-Za-z]*Error\b/,
  /json parse error/i,
  /unexpected token/i,
  /undefined is not (a|an) /i,
  /cannot read propert/i,
  /\bat https?:\/\//i,
];

/**
 * A message a screen already holds as a string, made safe to render.
 *
 * Screens that keep their failure as `e.message` in state — Library's course
 * tree, the notes list, the deck list — printed React Native's raw
 * "Network request failed" straight at students, on screens that were
 * meanwhile drawing a correct offline icon and serving cached content. This is
 * the narrow fix for those: a message that classifies as a real transport or
 * HTTP failure is replaced by the shared sentence for that kind, and a message
 * that is machine noise is replaced by the generic one. Anything the app
 * itself wrote ("Could not delete note") is passed through untouched, because
 * that sentence knows something this module does not.
 */
export function humanizeFailureMessage(error: unknown): string {
  const raw =
    typeof error === 'string' ? error : ((readString(error, 'message') ?? '') as string);
  const message = raw.trim();
  if (!message) return requestFailureSentence(error);

  if (classifyRequestFailure(error) !== 'unknown') return requestFailureSentence(error);
  if (MACHINE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return requestFailureSentence(null);
  }
  return message;
}

/** Whether offering a retry button can plausibly change the outcome. */
export function isRequestFailureRetryable(error: unknown): boolean {
  return requestFailureCopy(error).retryLabel != null;
}

/**
 * The two things a screen may say about numbers it cannot refresh.
 *
 * `stale` is for figures we still hold and know to be true, just not current —
 * show them, date them. `unavailable` is for the case with nothing real in
 * hand: say we cannot show it. The one thing neither may do is render a zero,
 * because "0 tests · 0 pts · Level 1" is not an absence, it is a claim that
 * the student's work is gone.
 */
export const STALE_PROGRESS_COPY: { title: string; body: string } = {
  title: 'Showing your last synced progress',
  body: 'We couldn’t reach Lantern just now. Nothing has been lost.',
};

export const UNAVAILABLE_PROGRESS_COPY: { title: string; body: string } = {
  title: 'Your progress will show when you reconnect',
  body: 'We couldn’t reach Lantern, so we’re not guessing at your numbers.',
};

/**
 * "Last synced 5m ago" — the date stamp that turns a stale figure from a lie
 * into a fact. Returns the honest vaguer form when we never recorded a time.
 */
export function lastSyncedLabel(
  syncedAt: number | null | undefined,
  now: number = Date.now(),
): string {
  if (syncedAt == null || !Number.isFinite(syncedAt)) return 'Last synced a while ago';
  const seconds = Math.floor((now - syncedAt) / 1000);
  if (seconds < 60) return 'Last synced just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Last synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last synced ${days}d ago`;
}

/**
 * What a data-backed list should render right now.
 *
 * `failed` outranks `noMatch` and `empty` on purpose — that precedence IS the
 * hard rule. A screen that has an error and zero rows knows nothing about the
 * data, so it must not claim the data is empty or that a search found nothing.
 *
 * `stale` is the fourth state everyone forgets: the request failed but we
 * still hold rows from before. Keep showing them, flag them, never blank them.
 */
export type RequestListState = 'loading' | 'failed' | 'stale' | 'noMatch' | 'empty' | 'ready';

export function resolveListState(input: {
  loading: boolean;
  /** Whatever the last load threw, or null/undefined when it succeeded. */
  error: unknown;
  /** How many rows we can actually render right now. */
  itemCount: number;
  /** The active search text, if the list is searchable. */
  query?: string | null;
}): RequestListState {
  const hasError = input.error != null;
  const hasItems = input.itemCount > 0;

  // A failure with rows already on screen: show them, banner the failure.
  if (hasError && hasItems) return 'stale';
  // A failure with nothing to show: the one thing we must never call "empty".
  if (hasError) return 'failed';
  if (input.loading && !hasItems) return 'loading';
  if (hasItems) return 'ready';
  return (input.query ?? '').trim().length > 0 ? 'noMatch' : 'empty';
}
