/**
 * Merge chat message lists by id so realtime inserts are not wiped by a
 * slightly-stale fetch, and optimistic temp ids can be reconciled.
 */

// No index signature: it would stop callers' interface types (which lack
// implicit index signatures) from satisfying the generic constraint. The merge
// only reads the declared keys.
export type MergeableChatMessage = {
  id: string;
  clientMessageId?: string | null;
  timestamp?: Date | string | number | null;
};

function messageTimeMs(message: MergeableChatMessage): number {
  if (message.timestamp == null) return 0;
  const ms = new Date(message.timestamp as Date | string | number).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** In-flight optimistic / local-only chat message ids (web + mobile). */
export function isTempMessageId(id: string): boolean {
  return (
    id.startsWith('msg-') ||
    id.startsWith('temp-') ||
    id.startsWith('optimistic-') ||
    id.startsWith('local-')
  );
}

/** Prefer a temp-prefixed client id so merge/realtime can recognize in-flight sends. */
export function createOptimisticClientMessageId(createId: () => string = () => crypto.randomUUID()): string {
  const raw = createId();
  return isTempMessageId(raw) ? raw : `temp-${raw}`;
}

/**
 * The value to put ON THE WIRE as `clientMessageId`.
 *
 * FIXED: `createOptimisticClientMessageId` returns `temp-<uuid>` so every local
 * merge path can recognise an in-flight row by `isTempMessageId`. That same
 * value was also being POSTed as `clientMessageId`, which the API validates as
 * a STRICT UUID (`body('clientMessageId').optional().isUUID()` in
 * apps/api-server/src/middleware/validation.ts) — so every group send returned
 * 400 INVALID_CLIENT_MESSAGE_ID. The local id keeps its prefix; only the wire
 * value is stripped back to the bare UUID the server dedupes on.
 *
 * Idempotent: a bare id passes through unchanged, so calling it twice (or on an
 * id that was never prefixed) is safe, and a `retryUncertainDelivery` replay
 * still sends byte-identical bytes.
 */
export function toWireClientMessageId(localId: string): string {
  if (!localId.startsWith('temp-')) return localId;
  const bare = localId.slice('temp-'.length);
  // `temp-` with nothing after it is not an id; never collapse it to ''.
  return bare || localId;
}

/**
 * True when a server row's `client_message_id` echo identifies the local row
 * `localId`.
 *
 * The echo is the WIRE id (bare UUID) while the optimistic row still carries
 * the local `temp-` id, so a plain `===` misses and the optimistic bubble
 * duplicates. Compares both sides normalised.
 */
export function matchesClientMessageId(
  localId: string,
  clientMessageId: string | null | undefined
): boolean {
  if (!localId || typeof clientMessageId !== 'string' || !clientMessageId) return false;
  if (localId === clientMessageId) return true;
  return toWireClientMessageId(localId) === toWireClientMessageId(clientMessageId);
}

/**
 * Merge `incoming` into `existing` by id.
 * - Same id: prefer incoming fields, keep richer existing question/sender fields when incoming is sparse
 * - Incoming with clientMessageId matching an existing temp id: replace that temp row
 * - Temp-only local rows not present in incoming are kept (in-flight optimistic sends)
 */
export function mergeChatMessagesById<T extends MergeableChatMessage>(
  existing: T[],
  incoming: T[]
): T[] {
  if (!existing.length) return incoming.slice();
  if (!incoming.length) return existing.slice();

  const byId = new Map<string, T>();
  // Local temp rows indexed by their WIRE id, so a server echo carrying the bare
  // UUID still finds the `temp-<uuid>` row it belongs to.
  const tempKeyByWireId = new Map<string, string>();
  for (const message of existing) {
    byId.set(message.id, message);
    if (isTempMessageId(message.id)) {
      tempKeyByWireId.set(toWireClientMessageId(message.id), message.id);
    }
  }

  for (const next of incoming) {
    const clientMessageId =
      typeof next.clientMessageId === 'string' && next.clientMessageId
        ? next.clientMessageId
        : undefined;

    const optimisticKey = clientMessageId
      ? byId.has(clientMessageId)
        ? clientMessageId
        : tempKeyByWireId.get(toWireClientMessageId(clientMessageId))
      : undefined;

    if (optimisticKey && optimisticKey !== next.id) {
      const prev = byId.get(optimisticKey)!;
      byId.delete(optimisticKey);
      tempKeyByWireId.delete(toWireClientMessageId(optimisticKey));
      byId.set(next.id, { ...prev, ...next, id: next.id });
      continue;
    }

    const prev = byId.get(next.id);
    byId.set(next.id, prev ? ({ ...prev, ...next, id: next.id } as T) : next);
  }

  // Drop temp rows once a server message with the same clientMessageId exists.
  for (const [id, message] of [...byId.entries()]) {
    if (!isTempMessageId(id)) continue;
    const matched = incoming.some(
      (item) => matchesClientMessageId(id, item.clientMessageId) || item.id === id
    );
    if (matched) byId.delete(id);
    else {
      // Keep unmatched optimistic rows.
      void message;
    }
  }

  return [...byId.values()].sort((a, b) => messageTimeMs(a) - messageTimeMs(b));
}

/** A cached chat row can also carry local-only outbox state (mobile). */
export type MergeableCachedChatMessage = MergeableChatMessage & {
  deliveryState?: 'pending' | 'failed' | null;
};

/**
 * Merge a FRESH SERVER PAGE with a persisted/local cache for the same
 * conversation, with the server authoritative.
 *
 * `mergeChatMessagesById(cache, server)` is the right call when the cache is
 * the base and the server rows are the update. It is the WRONG call when a
 * caller wants "keep my optimistic rows" and reaches for
 * `merge(serverRows, cache)` — that makes the cache the incoming (winning)
 * side, so every stale cached field (reactions, edits, removals, votes, pins)
 * overwrites the fresh server row. That is the hole this helper closes.
 *
 * Rules:
 * - Id present on both sides: the server row wins field-by-field. Cached-only
 *   keys the server never returns (viewer-specific extras) are preserved, and
 *   local outbox state is cleared, because a row the server returned is
 *   delivered by definition.
 * - A server row whose `clientMessageId` matches a cached temp row replaces
 *   that temp row (optimistic reconciliation).
 * - A cached row the server did not return is kept ONLY if it is either
 *   local-only (deliveryState 'pending' | 'failed', or an unreconciled
 *   optimistic temp id) or outside the fetched page's time window — i.e.
 *   older than the oldest or newer than the newest server row. Older keeps
 *   pagination working (page 1 is the newest N; earlier pages live only in
 *   the cache); newer keeps a realtime insert that landed while the fetch was
 *   in flight. A cached row INSIDE the window that the server no longer
 *   returns was deleted, and is dropped rather than resurrected.
 * - An empty server page is treated as "no information" and leaves the cache
 *   untouched: an empty page and a transient/filtered empty response are
 *   indistinguishable here, and wiping a conversation is not recoverable.
 *
 * Ordering matches `mergeChatMessagesById`: ascending by timestamp.
 */
export function mergeServerRefresh<T extends MergeableCachedChatMessage>(
  serverRows: T[],
  cachedRows: T[]
): T[] {
  if (!cachedRows.length) return serverRows.slice();
  if (!serverRows.length) return cachedRows.slice();

  const clientIdOf = (message: T): string | undefined =>
    typeof message.clientMessageId === 'string' && message.clientMessageId
      ? message.clientMessageId
      : undefined;

  const serverIds = new Set<string>();
  const reconciledClientIds = new Set<string>();
  let oldestServerMs = Number.POSITIVE_INFINITY;
  let newestServerMs = Number.NEGATIVE_INFINITY;
  for (const row of serverRows) {
    serverIds.add(row.id);
    const clientMessageId = clientIdOf(row);
    // Normalised: the server echoes the WIRE id (bare UUID) while the cached
    // optimistic row still carries `temp-<uuid>`.
    if (clientMessageId) reconciledClientIds.add(toWireClientMessageId(clientMessageId));
    const ms = messageTimeMs(row);
    if (ms < oldestServerMs) oldestServerMs = ms;
    if (ms > newestServerMs) newestServerMs = ms;
  }

  const cachedById = new Map<string, T>();
  const cachedTempByWireId = new Map<string, T>();
  for (const row of cachedRows) {
    cachedById.set(row.id, row);
    if (isTempMessageId(row.id)) cachedTempByWireId.set(toWireClientMessageId(row.id), row);
  }

  const byId = new Map<string, T>();
  for (const row of serverRows) {
    const clientMessageId = clientIdOf(row);
    const prev =
      cachedById.get(row.id) ||
      (clientMessageId && clientMessageId !== row.id
        ? cachedById.get(clientMessageId) ||
          cachedTempByWireId.get(toWireClientMessageId(clientMessageId))
        : undefined);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const merged = { ...prev, ...row, id: row.id } as T;
    if (prev.deliveryState && row.deliveryState == null) {
      // The server has this row, so any local 'pending' / 'failed' badge is stale.
      (merged as MergeableCachedChatMessage).deliveryState = undefined;
    }
    byId.set(row.id, merged);
  }

  for (const row of cachedRows) {
    if (serverIds.has(row.id) || byId.has(row.id)) continue;
    // A temp row the server has already reconciled under a real id is gone.
    if (reconciledClientIds.has(toWireClientMessageId(row.id))) continue;
    const clientMessageId = clientIdOf(row);
    if (clientMessageId && reconciledClientIds.has(toWireClientMessageId(clientMessageId))) continue;

    const isLocalOnly =
      row.deliveryState === 'pending' ||
      row.deliveryState === 'failed' ||
      isTempMessageId(row.id);
    const ms = messageTimeMs(row);
    const isOutsidePageWindow = ms < oldestServerMs || ms > newestServerMs;
    if (isLocalOnly || isOutsidePageWindow) byId.set(row.id, row);
  }

  return [...byId.values()].sort((a, b) => messageTimeMs(a) - messageTimeMs(b));
}
