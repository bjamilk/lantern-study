/**
 * What a student is told when a document has no pages to walk through.
 *
 * This file exists because the two clients said different things about the
 * same event. Mobile had already been taught to translate the server's answer
 * into a sentence; web still carried its own older wording AND, when the
 * request was refused outright, printed the server's raw reply — which on a
 * server without the pages route reads
 * "Not found - /api/v1/notes/<uuid>/attachments/<uuid>/pages?images=1" in red
 * under a Try again button that could never work. A student cannot act on an
 * endpoint path, and a UUID is not a fact about their document.
 *
 * So the rules live here, once, platform-free:
 *
 *   - Every branch is an answer, not an error code. "Not split into pages yet"
 *     is a normal state of the app, not a fault.
 *   - `retryable` is honest. A 404 on this route means the server has not got
 *     the route at all: that is the same fact as `schema_missing` (a server
 *     that has the route but not the table), it reads as the same sentence,
 *     and neither offers a retry, because retrying is guaranteed to fail.
 *   - Nothing the server wrote survives the trip. The raw message is used only
 *     to classify, never to display.
 */
import { classifyRequestFailure, REQUEST_FAILURE_COPY } from '../network';

/** Why the route says there is nothing to walk through. Server's vocabulary. */
export type WalkthroughReason =
  | 'ok'
  | 'schema_missing'
  | 'unsupported'
  | 'source_missing'
  | 'preview_pending'
  | 'unreadable';

/** One honest empty state: what happened, and whether another look can help. */
export interface PagesUnavailableCopy {
  title: string;
  detail: string;
  retryable: boolean;
  /** The button's words, or null when there is no button to press. */
  retryLabel: string | null;
}

/**
 * What to tell the student when `available` is false, or when it is true and
 * there is still nothing to show.
 *
 * Written as answers, not error codes. `retryable` is the honest half: two of
 * these are worth another look in a moment and three are not, and a screen
 * that retries `source_missing` in a loop is how a dead document becomes a
 * spinner that never stops.
 */
export function walkthroughUnavailableCopy(reason: WalkthroughReason): PagesUnavailableCopy {
  switch (reason) {
    case 'schema_missing':
      return {
        title: 'Not split into pages yet',
        detail: 'This document has not been split into pages on the server yet.',
        retryable: false,
        retryLabel: null,
      };
    case 'preview_pending':
      return {
        title: 'Still converting',
        detail: 'Still converting this deck — try again in a minute.',
        retryable: true,
        retryLabel: 'Check again',
      };
    case 'unsupported':
      return {
        title: 'No walk-through for this note',
        detail: 'Only PDFs and slide decks have pages.',
        retryable: false,
        retryLabel: null,
      };
    case 'source_missing':
    case 'unreadable':
      return {
        title: 'Could not read this document',
        detail: 'We could not read this document.',
        retryable: false,
        retryLabel: null,
      };
    case 'ok':
    default:
      return {
        title: 'No pages',
        detail: 'This document came back with no pages in it.',
        retryable: false,
        retryLabel: null,
      };
  }
}

/** The reasons the server may name. Anything else is not a reason we trust. */
const KNOWN_REASONS: readonly WalkthroughReason[] = [
  'ok',
  'schema_missing',
  'unsupported',
  'source_missing',
  'preview_pending',
  'unreadable',
];

function readReason(value: unknown): WalkthroughReason | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const direct = record.reason;
  if (typeof direct === 'string' && (KNOWN_REASONS as readonly string[]).includes(direct)) {
    return direct as WalkthroughReason;
  }
  // A thrown error may still carry the payload the server sent with it.
  for (const key of ['body', 'data', 'payload', 'response']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const inner = (nested as Record<string, unknown>).reason;
      if (typeof inner === 'string' && (KNOWN_REASONS as readonly string[]).includes(inner)) {
        return inner as WalkthroughReason;
      }
    }
  }
  return null;
}

function isNotFoundOnThisRoute(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
    if (code === 'NOT_FOUND') return true;
  }
  return classifyRequestFailure(error) === 'notFound';
}

/**
 * What to put on the screen when there are no pages to walk — whatever the
 * reason, and whatever shape it arrived in.
 *
 * ONE door for two very different inputs, because the student cannot tell them
 * apart and should not have to. A payload (`{ available: false, reason }`) is
 * the server answering the question; a thrown error is the server refusing to.
 * Both end as the same three fields, and the raw message never survives.
 */
export function pagesUnavailableCopy(errorOrPayload: unknown): PagesUnavailableCopy {
  const reason = readReason(errorOrPayload);
  if (reason) return walkthroughUnavailableCopy(reason);

  // Nothing thrown and nothing named: the plain "it came back with no pages".
  if (errorOrPayload == null) return walkthroughUnavailableCopy('ok');

  if (isNotFoundOnThisRoute(errorOrPayload)) {
    // Same fact as schema_missing, told by a server that has not got the
    // route at all. Same sentence, and the same absence of a retry.
    return walkthroughUnavailableCopy('schema_missing');
  }

  if (classifyRequestFailure(errorOrPayload) === 'offline') {
    return {
      title: REQUEST_FAILURE_COPY.offline.title,
      detail: REQUEST_FAILURE_COPY.offline.body,
      retryable: true,
      retryLabel: REQUEST_FAILURE_COPY.offline.retryLabel ?? 'Try again',
    };
  }

  return {
    title: 'We couldn’t load the pages',
    detail: 'Something went wrong loading the pages.',
    retryable: true,
    retryLabel: 'Try again',
  };
}

/**
 * Should the screen keep asking on its own?
 *
 * Only the deck that is mid-conversion resolves without anyone doing anything,
 * so it is the only reason worth a timer. Polling any other reason is a
 * spinner that never stops.
 */
export function shouldRetryPages(reason: WalkthroughReason): boolean {
  return reason === 'preview_pending';
}
