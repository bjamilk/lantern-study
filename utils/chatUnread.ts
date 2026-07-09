import type { DMThread, Group } from '../types';

/** Sum unread messages across active (non-archived) groups and DM threads. */
export function getTotalActiveUnreadChatCount(
  groups: Group[],
  dmThreads: DMThread[],
): number {
  const groupUnread = groups
    .filter((g) => !g.isArchived)
    .reduce((sum, g) => sum + (g.unreadCount || 0), 0);
  const dmUnread = dmThreads
    .filter((t) => !t.isArchived)
    .reduce((sum, t) => sum + (t.unreadCount || 0), 0);
  return groupUnread + dmUnread;
}

export function formatUnreadBadgeCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}
