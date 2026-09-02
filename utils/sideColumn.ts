import { AppMode } from '../types';

/**
 * Which 20rem column sits beside the icon rail.
 *
 * `'community'` — a community is active and the app is on its page, one of
 * its channels, or a room opened from it: the aside is the channel column.
 * `'chats'` — the persisted Chats flyout, everywhere except the chat screen
 * (ChatWindow renders its own list there).
 * `null` — no column; the sidebar renders at its persisted width.
 *
 * Sidebar (what the aside shows) and AppShell (how far `<main>` is offset)
 * MUST both derive from this, never from a second hand-written predicate —
 * the two drifted once and the content sat under the column.
 */
export type SideColumn = 'chats' | 'community' | null;

export function resolveSideColumn(input: {
  isChatsSectionExpanded: boolean;
  appMode: AppMode;
  activeCommunity: { slug: string } | null;
}): SideColumn {
  const { isChatsSectionExpanded, appMode, activeCommunity } = input;
  if (
    activeCommunity &&
    (appMode === AppMode.COMMUNITY_DETAIL || appMode === AppMode.STUDY_ROOM)
  ) {
    return 'community';
  }
  if (isChatsSectionExpanded && appMode !== AppMode.CHAT) return 'chats';
  return null;
}
