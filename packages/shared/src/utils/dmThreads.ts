/**
 * DM thread list merge helpers shared by web and mobile.
 * Soft merge keeps optimistic local threads; server merge drops stale locals.
 */

export type MergeableDmThread = {
  id: string;
  lastMessage?: string | null;
  lastMessageTimestamp?: Date | string | number | null;
  unreadCount?: number | null;
  participants?: Record<string, unknown> | null;
  /**
   * Set on locally created threads until the server returns the row.
   * Survives first-send lastMessage updates so server merges cannot drop the thread.
   */
  clientPending?: boolean | null;
  // No index signature — see MergeableChatMessage: interfaces without implicit
  // index signatures must still satisfy the generic constraint.
};

function threadTimeMs(thread: MergeableDmThread): number {
  if (thread.lastMessageTimestamp == null) return 0;
  const ms = new Date(thread.lastMessageTimestamp as Date | string | number).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Local-only thread created before the server acknowledges the row. */
export function isOptimisticDmThread(thread: MergeableDmThread): boolean {
  if (thread.clientPending) return true;
  return !thread.lastMessage && !thread.lastMessageTimestamp;
}

export type MergeDmThreadListsMode = 'soft' | 'server';

/**
 * Merge server threads with local ones.
 * - soft: keep any local thread missing from the server (optimistic first-message)
 * - server: keep only optimistic locals missing from the server (authoritative refresh)
 */
export function mergeDmThreadLists<T extends MergeableDmThread>(
  existing: T[],
  fetched: T[],
  mode: MergeDmThreadListsMode = 'soft',
): T[] {
  const existingList = Array.isArray(existing) ? existing : [];
  const fetchedList = Array.isArray(fetched) ? fetched : [];
  const byId = new Map<string, T>();

  for (const thread of fetchedList) {
    byId.set(thread.id, thread);
  }

  for (const local of existingList) {
    const server = byId.get(local.id);
    if (!server) {
      if (mode === 'soft' || isOptimisticDmThread(local)) {
        byId.set(local.id, local);
      }
      continue;
    }
    // Server row is authoritative — drop clientPending so future merges treat it as real.
    const { clientPending: _clientPending, ...localRest } = local;
    byId.set(local.id, {
      ...localRest,
      ...server,
      clientPending: undefined,
      participants: {
        ...((local.participants as Record<string, unknown>) || {}),
        ...((server.participants as Record<string, unknown>) || {}),
      },
      unreadCount: server.unreadCount ?? local.unreadCount,
    });
  }

  return Array.from(byId.values()).sort((a, b) => threadTimeMs(b) - threadTimeMs(a));
}

/** Retry a transient async failure once after a short delay. */
export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  options?: { delayMs?: number; shouldRetry?: (error: unknown) => boolean },
): Promise<T> {
  const delayMs = options?.delayMs ?? 400;
  const shouldRetry =
    options?.shouldRetry ??
    ((error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      if (/AUTH_NOT_READY|Authentication required|AUTH_UNAUTHORIZED/i.test(message)) {
        return true;
      }
      if (/Failed to fetch|NetworkError|timeout|ECONNRESET|503|502|504/i.test(message)) {
        return true;
      }
      return false;
    });

  try {
    return await operation();
  } catch (error) {
    if (!shouldRetry(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return operation();
  }
}
