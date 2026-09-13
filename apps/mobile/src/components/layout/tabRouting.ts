/**
 * The five destinations, their route names, their labels — and the arithmetic
 * that turns a navigation state into "which tab is lit".
 *
 * Pure on purpose, and importing NOTHING: jest here runs on the `node`
 * environment with `testMatch: ['**\/*.test.ts']` and cannot transform a
 * native module, so every decision the chrome makes lives in this file and is
 * unit-tested in tabRouting.test.ts. BottomTabBar/TopBar/ChromeContext are
 * then a thin, untestable shell over tested logic.
 *
 * THE NAVIGATION RULE
 * -------------------
 * A bottom tab is a PLACE a student goes on purpose several times a week. The
 * top bar holds only the two things that FOLLOW you (Lantern AI,
 * Notifications). Profile is the student's own place. A mode or a setting is
 * never a destination, and every feature has exactly one name and one door.
 */

/**
 * Every destination the chrome can point at.
 *
 * The first five are the bottom bar, in order. `Notifications` and `AI` are
 * top-bar surfaces that follow the reader around — they light their own icon
 * up there and deliberately light NO bottom tab, because neither is a place.
 */
export type TabKey = 'Home' | 'Study' | 'Chat' | 'Campus' | 'Me' | 'Notifications' | 'AI';

/** The bottom bar, in the order it is drawn. Home is also the launch tab. */
export const BOTTOM_TABS = ['Home', 'Study', 'Chat', 'Campus', 'Me'] as const;

export type BottomTabKey = (typeof BOTTOM_TABS)[number];

export function isBottomTab(tab: TabKey): tab is BottomTabKey {
  return (BOTTOM_TABS as readonly string[]).includes(tab);
}

/**
 * One name per feature: what the bar prints, what the top bar titles, and what
 * a screen reader says are all this one string.
 */
export const TAB_LABELS: Record<TabKey, string> = {
  Home: 'Home',
  Study: 'Study',
  Chat: 'Chat',
  Campus: 'Campus',
  Me: 'Profile',
  Notifications: 'Notifications',
  AI: 'Lantern AI',
};

/** Tab key → the route registered on the tab navigator. `null` = not a route. */
export const TAB_ROUTE_BY_KEY: Record<TabKey, string | null> = {
  Home: 'HomeTab',
  Study: 'StudyTab',
  Chat: 'ChatTab',
  Campus: 'CampusTab',
  Me: 'MeTab',
  Notifications: 'NotificationsTab',
  // Lantern AI is a panel over whatever you are reading, never a route.
  AI: null,
};

/**
 * Route → tab key.
 *
 * The legacy route names are here on purpose. `MarketTab`, `JobsTab` and
 * `BudgetTab` are compatibility shims (see navigation/legacyTabs.ts) that
 * forward to Campus and Me; mapping them to their DESTINATION means the right
 * tab is already lit during the one frame the shim is mounted, instead of the
 * bar blinking to "no tab" and back.
 */
export const TAB_KEY_BY_ROUTE: Record<string, TabKey> = {
  HomeTab: 'Home',
  StudyTab: 'Study',
  ChatTab: 'Chat',
  CampusTab: 'Campus',
  MeTab: 'Me',
  NotificationsTab: 'Notifications',
  MarketTab: 'Campus',
  JobsTab: 'Campus',
  BudgetTab: 'Me',
};

export interface ActiveTabInput {
  /** Focused route on the tab navigator, e.g. 'CampusTab'. */
  tabRouteName: string | undefined;
  /** The Lantern AI panel is open over the app. */
  companionOpen: boolean;
}

/**
 * Which destination the chrome should show as current.
 *
 * Unknown routes fall back to Home rather than to whichever tab happens to be
 * first in an object literal: Home is the launch tab, so "we do not know" and
 * "you just started the app" agree.
 */
export function resolveActiveTab({ tabRouteName, companionOpen }: ActiveTabInput): TabKey {
  if (companionOpen) return 'AI';
  return TAB_KEY_BY_ROUTE[tabRouteName ?? ''] ?? 'Home';
}

/** The title the top bar prints for the current destination. */
export function tabTitle(tab: TabKey): string {
  return TAB_LABELS[tab];
}
