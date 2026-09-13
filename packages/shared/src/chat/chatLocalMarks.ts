export type ChatMarkScope = 'group' | 'dm';

export function chatStarredStorageKey(
  userId: string,
  scope: ChatMarkScope,
  chatId: string,
): string {
  return scope === 'dm'
    ? `lantern_starred_msgs:${userId}:dm:${chatId}`
    : `lantern_starred_msgs:${userId}:${chatId}`;
}

export function chatPinnedMessageStorageKey(
  userId: string,
  scope: ChatMarkScope,
  chatId: string,
): string {
  return scope === 'dm'
    ? `lantern_pinned_msg:${userId}:dm:${chatId}`
    : `lantern_pinned_msg:${userId}:${chatId}`;
}

export const PINNED_CHATS_STORAGE_KEY = 'lantern_pinned_chats';

export function parseStoredIdSet(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function serializeIdSet(ids: Iterable<string>): string {
  return JSON.stringify([...ids]);
}
