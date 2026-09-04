/**
 * The pure half of the one-time "Save for me" → `message_bookmarks` import
 * (§7.3). Kept out of `services/bookmarkImport.ts` so it can be tested without
 * dragging in the supabase client, the stores and expo-secure-store.
 */

export const STARRED_MESSAGES_KEY_PREFIX = 'lantern_starred_msgs:';

/**
 * Which of this user's starred-message keys belong to a BOARD.
 *
 * This filter is load-bearing, not defensive. `GroupChatScreen` and
 * `DirectMessageScreen` write the IDENTICAL key shape for chat and DM stars,
 * so importing every key would turn a starred CHAT message into a board
 * bookmark — a row "Saved posts" would then list and no surface could open,
 * because `PUT /messages/:id/bookmark` answers `not_a_board_post` for exactly
 * that message. `isCommunityBoardGroupIn` also refuses to guess: a community
 * whose lounge pointer has not loaded is reported UNRESOLVED and its groups
 * are left alone until it has — which is safe, because the import endpoint
 * upserts and this simply runs again next launch.
 */
export function selectBoardStarKeys(
  keys: readonly string[],
  userId: string,
  isBoardGroup: (groupId: string) => boolean,
): string[] {
  const prefix = `${STARRED_MESSAGES_KEY_PREFIX}${userId}:`;
  return keys.filter((key) => {
    if (!key.startsWith(prefix)) return false;
    const groupId = key.slice(prefix.length);
    return !!groupId && isBoardGroup(groupId);
  });
}

/** Parse one stored key's payload; a corrupt entry contributes nothing. */
export function parseStarredIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}
