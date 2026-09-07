/**
 * Which queued writes are worth trying again, and which never were.
 *
 * The offline queue had exactly two answers for a handler: "done" and "not
 * done". "Not done" meant retry, five times, then park in `failedOperations`
 * — which every reconnect and every account switch revives. A write the
 * server had REFUSED therefore came back forever: the device run that
 * prompted this file logged 240 consecutive
 * `[SyncHandler:flashcard] Error: Validation Error status 400` lines from one
 * rejected card, at no point moving any closer to succeeding.
 *
 * A 4xx is the server saying the request is wrong. Repeating it verbatim
 * cannot make it right, so it is classified as permanent: the operation is
 * dropped and the student is told what the server said, once, instead of the
 * app burning battery on it in a loop.
 *
 * The exceptions are the 4xx codes that describe the MOMENT rather than the
 * request — 408, 425, 429 (try later) and 401/403 (this session, until it is
 * refreshed or the account comes back). Those stay retryable.
 *
 * Pure and import-free, so mobile jest can test it in node.
 */

/** The fields these rules read off an error, whatever threw it. */
export interface SyncErrorView {
  status?: unknown;
  message?: unknown;
}

/** HTTP status carried by the shared API client's errors, when there is one. */
export const syncErrorStatus = (error: unknown): number | undefined => {
  const status = (error as SyncErrorView | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
};

/** 4xx codes that describe the moment, not the request. Still worth retrying. */
const RETRYABLE_4XX = new Set([401, 403, 408, 425, 429]);

/**
 * Will this operation be refused however many times it is replayed?
 *
 * Only a definite 4xx answers yes. No status at all means the request never
 * reached a verdict (a dead socket, an aborted fetch), which is transient and
 * is handled before this by `isTransientSyncError`.
 */
export const isPermanentSyncError = (error: unknown): boolean => {
  const status = syncErrorStatus(error);
  if (status === undefined) return false;
  if (RETRYABLE_4XX.has(status)) return false;
  return status >= 400 && status < 500;
};

/**
 * What to show the student, in the server's own words where it gave any.
 *
 * A bare "Validation Error" is not one: it names no field and suggests no fix,
 * so it is replaced rather than shown. Anything more specific is kept verbatim
 * — the server knows why it refused and this app does not.
 */
export const syncErrorMessage = (error: unknown, fallback: string): string => {
  const message = (error as SyncErrorView | null | undefined)?.message;
  if (typeof message !== 'string') return fallback;
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  if (/^(validation error|bad request|error|request failed)$/i.test(trimmed)) return fallback;
  return trimmed;
};

/** The fields of a queued operation these rules read. */
export interface QueuedOpView {
  entityType: string;
  entityId: string;
  operation: string;
  data?: Record<string, unknown> | null;
}

/** An id the server never issued (the optimistic-write placeholder). */
const isTempId = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('temp_');

/**
 * A queued card write aimed at a deck the server has never heard of.
 *
 * `POST /decks/:deckId/flashcards` against `temp_deck_1756…` is refused every
 * single time: that id exists only in this device's memory. Such operations
 * were minted by the old optimistic generate-and-save path (a deck created
 * offline, then cards written into it), and any still sitting in a queue are
 * pure loop fuel — they can never succeed, and nothing rebinds their deck id.
 * They are purged once, on the next launch.
 */
export const isDoomedTempDeckOp = (op: QueuedOpView): boolean => {
  if (op.entityType !== 'flashcard') return false;
  if (isTempId(op.data?.deckId)) return true;
  // A card whose own id is temporary can only be updated/deleted server-side
  // once its create has landed; an update or delete against it is aimed at a
  // row that does not exist.
  return op.operation !== 'create' && isTempId(op.entityId);
};
