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
  for (const message of existing) {
    byId.set(message.id, message);
  }

  for (const next of incoming) {
    const clientMessageId =
      typeof next.clientMessageId === 'string' && next.clientMessageId
        ? next.clientMessageId
        : undefined;

    if (clientMessageId && clientMessageId !== next.id && byId.has(clientMessageId)) {
      const prev = byId.get(clientMessageId)!;
      byId.delete(clientMessageId);
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
      (item) => item.clientMessageId === id || item.id === id
    );
    if (matched) byId.delete(id);
    else {
      // Keep unmatched optimistic rows.
      void message;
    }
  }

  return [...byId.values()].sort((a, b) => messageTimeMs(a) - messageTimeMs(b));
}
