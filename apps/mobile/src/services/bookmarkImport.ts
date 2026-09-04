import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BOARD_BOOKMARK_IMPORT_MAX,
  isCommunityBoardGroupIn,
} from '@lantern/shared/network';
import { importBookmarks } from './boardActions';
import {
  parseStarredIds,
  selectBoardStarKeys,
} from '../utils/bookmarkImportKeys';
import { useCommunityStore, collectKnownLounges } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';

/**
 * The one-time migration of the device-local saves into `message_bookmarks`
 * (§7.3).
 *
 * "Save for me" was AsyncStorage `lantern_starred_msgs:{userId}:{groupId}` on
 * mobile and localStorage `lantern:board:saved:{userId}` on web — two stores
 * that cannot read each other even in principle, both lost on reinstall, with
 * no screen on either platform that listed what you saved. This moves the
 * mobile half server-side.
 *
 * Two rules make it safe to run on every launch:
 *  - it runs ONLY after a `serverBacked: true` response has been seen, so it
 *    never fires against a database without the migration;
 *  - the local key is deleted only on a 2xx. On a 503 it is kept and retried
 *    next launch, and the import endpoint upserts, so a retry is harmless.
 */

let importedThisSession = false;

/** Test seam: a new session (or a different account) may import again. */
export function resetBookmarkImportForTests(): void {
  importedThisSession = false;
}

export async function importLocalBookmarksOnce(userId: string): Promise<number> {
  if (!userId || importedThisSession) return 0;
  importedThisSession = true;

  const groups = useGroupStore.getState().groups;
  const community = useCommunityStore.getState();
  const known = collectKnownLounges(
    community.detailBySlug,
    community.channelsById,
    community.myCommunities,
  );
  const isBoardGroup = (groupId: string): boolean => {
    const group = groups.find((g) => g.id === groupId);
    return !!group && isCommunityBoardGroupIn(group, known);
  };

  let keys: string[];
  try {
    keys = [...(await AsyncStorage.getAllKeys())];
  } catch {
    importedThisSession = false;
    return 0;
  }

  const boardKeys = selectBoardStarKeys(keys, userId, isBoardGroup);
  if (boardKeys.length === 0) return 0;

  const entries = await AsyncStorage.multiGet(boardKeys).catch(() => null);
  if (!entries) {
    importedThisSession = false;
    return 0;
  }

  const messageIds = [
    ...new Set(entries.flatMap(([, raw]) => parseStarredIds(raw))),
  ].slice(0, BOARD_BOOKMARK_IMPORT_MAX);
  if (messageIds.length === 0) {
    // Nothing to move, but the empty keys are still clutter.
    await AsyncStorage.multiRemove(boardKeys).catch(() => undefined);
    return 0;
  }

  try {
    const result = await importBookmarks(messageIds);
    // Only now — a 503 leaves the key exactly where it was.
    await AsyncStorage.multiRemove(boardKeys).catch(() => undefined);
    return result?.imported ?? 0;
  } catch {
    importedThisSession = false;
    return 0;
  }
}
