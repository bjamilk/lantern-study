import type { DMThread } from '../types';
import {
  mergeDmThreadLists as mergeDmThreadListsShared,
  type MergeDmThreadListsMode,
} from '@lantern/shared/utils';

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
    historyClearedAt: t.historyClearedAt ?? t.history_cleared_at ?? null,
    status,
    requestedBy: t.requestedBy ?? t.requested_by ?? null,
  };
}

/** Inbound pending request — recipient has not accepted/replied yet. */
export function isInboundDmMessageRequest(
  thread: Pick<DMThread, 'status' | 'requestedBy'>,
  currentUserId: string | null | undefined,
): boolean {
  if (!currentUserId) return false;
  return (
    thread.status === 'pending' &&
    typeof thread.requestedBy === 'string' &&
    thread.requestedBy !== currentUserId
  );
}

/**
 * Merge server threads with local ones. Keeps optimistic threads that are not
 * on the server yet (first message has not created the row).
 */
export function mergeDmThreadLists(
  existing: DMThread[],
  fetched: DMThread[],
  mode: MergeDmThreadListsMode = 'soft',
): DMThread[] {
  return mergeDmThreadListsShared(existing, fetched, mode);
}
