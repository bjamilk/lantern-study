import { AppMode } from '../../types';
import { resolveSideColumn, type SideColumn } from '../../utils/sideColumn';

export type { SideColumn };

/**
 * Which 20rem column the shell puts beside the sidebar.
 *
 * Wraps `resolveSideColumn` with the one rule the base predicate cannot know:
 * Chat is now a DESTINATION, and its conversation list is that column. The base
 * predicate suppressed the flyout on the chat screen on the assumption that
 * ChatWindow renders its own list there — it does, but only on mobile, so
 * `/chat` on a desktop showed a 0px-wide empty aside next to a placeholder that
 * said "select a conversation from the sidebar". There was nothing to select.
 *
 * On Chat the column is not a preference, so it ignores the persisted toggle:
 * closing the only list on the screen is not a state the student can want.
 *
 * Sidebar (what the aside shows) and AppShell (how far `<main>` is offset) both
 * call THIS, never the base predicate and never a hand-written copy — the two
 * drifted once and the content sat under the column.
 */
export function resolveShellSideColumn(input: {
  isChatsSectionExpanded: boolean;
  appMode: AppMode;
  activeCommunity: { slug: string } | null;
}): SideColumn {
  const base = resolveSideColumn(input);
  // A community still wins: its channel column is what the page is about.
  if (base) return base;
  if (input.appMode === AppMode.CHAT) return 'chats';
  return null;
}

/** True while the column is the screen's own navigation and cannot be closed. */
export function isSideColumnPinned(appMode: AppMode, column: SideColumn): boolean {
  return column === 'chats' && appMode === AppMode.CHAT;
}
