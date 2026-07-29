import type { DMThread } from '../types';

/** Map API DM thread rows into client DMThread shape. */
export function mapDmThreadFromApi(
  t: any,
  unreadCounts: Record<string, number> = {},
): DMThread {
  const status =
    t.status === 'pending' || t.status === 'declined' || t.status === 'open'
      ? t.status
      : 'open';
  return {
    id: t.id,
    participantIds: t.participantIds || t.participant_ids || [],
    participants: t.participants || {},
    lastMessage: t.lastMessage || t.last_message,
    lastMessageTimestamp: t.lastMessageTimestamp || t.last_message_time,
    unreadCount: unreadCounts[t.id] || t.unreadCount || 0,
    isArchived: t.isArchived || t.is_archived || false,
    status,
    requestedBy: t.requestedBy ?? t.requested_by ?? null,
  };
}

/**
 * Merge server threads with local ones. Keeps optimistic threads that are not
 * on the server yet (first message has not created the row).
 */
export function mergeDmThreadLists(
  existing: DMThread[],
  fetched: DMThread[],
): DMThread[] {
  const existingList = Array.isArray(existing) ? existing : [];
  const fetchedList = Array.isArray(fetched) ? fetched : [];
  const byId = new Map<string, DMThread>();
  for (const thread of fetchedList) {
    byId.set(thread.id, thread);
  }
  for (const local of existingList) {
    const server = byId.get(local.id);
    if (!server) {
      byId.set(local.id, local);
      continue;
    }
    byId.set(local.id, {
      ...local,
      ...server,
      participants: { ...local.participants, ...server.participants },
      unreadCount: server.unreadCount ?? local.unreadCount,
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const at = a.lastMessageTimestamp ? new Date(a.lastMessageTimestamp).getTime() : 0;
    const bt = b.lastMessageTimestamp ? new Date(b.lastMessageTimestamp).getTime() : 0;
    return bt - at;
  });
}
