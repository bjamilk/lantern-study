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

/**
 * The width at which the sidebar stops being a thing you summon and becomes a
 * thing that is simply there.
 *
 * AppShell renders the sidebar inside `hidden md:block`: below `md` it is not
 * drawn at all (BottomNav is the navigation), and at `md` and above it is a
 * persistent column that `<main>`'s `md:ml-*` offset makes room for. That is
 * the only honest condition for "is the nav taking width from the content", so
 * anything that wants to stand the nav down — `hooks/useFocusSidebarCollapse`
 * — asks THIS rather than picking a breakpoint of its own.
 *
 * FIXED: focus mode originally gated on `(min-width: 1024px)`, an invented
 * number. The founder browses at 125% zoom, where a 1258 device-px window is a
 * 1006 CSS-px viewport: under `lg`, comfortably over `md`, and the sidebar was
 * very much still a 224px column pushing the studio. The nav never stood down
 * for the one person the redesign was for.
 *
 * The class and the query are declared TOGETHER, one line apart, because
 * Tailwind's scanner cannot see a class name built at runtime — so the class
 * has to stay a literal, and the only protection against the two drifting is
 * that changing one means reading the other. `shellSideColumn.test.ts` asserts
 * they still agree.
 */
export const SHELL_SIDEBAR_COLUMN_CLASS = 'hidden md:block';

/** Tailwind's default `md`. Must stay in step with the class above. */
export const SHELL_SIDEBAR_COLUMN_QUERY = '(min-width: 768px)';

/** Is the sidebar currently laid out as a column rather than not drawn at all? */
export function shellSidebarIsAColumn(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SHELL_SIDEBAR_COLUMN_QUERY).matches;
}

/** True while the column is the screen's own navigation and cannot be closed. */
export function isSideColumnPinned(appMode: AppMode, column: SideColumn): boolean {
  return column === 'chats' && appMode === AppMode.CHAT;
}
