import { AppMode } from '../../types';
import { ME_PATH, TEST_BUILDER_PATH } from '../../utils/appRoutes';

/**
 * The five places a student goes on purpose. One vocabulary, shared by the
 * desktop sidebar and the phone bar, so the two can never disagree about which
 * destination is lit — and matching mobile's five bottom tabs exactly.
 *
 * The rule that produced this list: a destination is a PLACE, visited several
 * times a week. A mode is not a destination (a running test lives under Study);
 * a setting is not a destination (dark mode lives under Me); the two things
 * that FOLLOW you — Lantern AI and Notifications — are not destinations either,
 * they sit apart from the five.
 */
export type DestinationId = 'home' | 'study' | 'chat' | 'campus' | 'me';

export const DESTINATION_ORDER: readonly DestinationId[] = [
  'home',
  'study',
  'chat',
  'campus',
  'me',
];

export const DESTINATION_LABELS: Record<DestinationId, string> = {
  home: 'Home',
  study: 'Study',
  chat: 'Chat',
  campus: 'Campus',
  me: 'Me',
};

/** Where each destination's tap lands. Me is a path, not a mode. */
export const DESTINATION_MODE: Record<Exclude<DestinationId, 'me'>, AppMode> = {
  home: AppMode.DASHBOARD,
  study: AppMode.STUDY_HUB,
  chat: AppMode.CHAT,
  campus: AppMode.DISCOVER,
};

/**
 * Which destination owns each mode. Every screen belongs to exactly one — a
 * listing is Campus, a running test is Study, Budget is Me — so the lit tab is
 * always the section the student is actually inside.
 */
const MODE_OWNER: Partial<Record<AppMode, DestinationId>> = {
  [AppMode.DASHBOARD]: 'home',

  [AppMode.STUDY_HUB]: 'study',
  [AppMode.COURSE_WORKSPACE]: 'study',
  [AppMode.LIBRARY]: 'study',
  [AppMode.NOTES]: 'study',
  [AppMode.NOTE_EDITOR]: 'study',
  [AppMode.FLASHCARDS]: 'study',
  [AppMode.DECK_DETAIL]: 'study',
  [AppMode.FLASHCARD_REVIEW]: 'study',
  [AppMode.FLASHCARD_CRAM]: 'study',
  [AppMode.FLASHCARD_MATCH]: 'study',
  [AppMode.FLASHCARD_LEARN]: 'study',
  [AppMode.AI_TOOLS]: 'study',
  [AppMode.TESTS_HOME]: 'study',
  [AppMode.TEST_ACTIVE]: 'study',
  [AppMode.TEST_REVIEW]: 'study',
  [AppMode.STUDY_ACTIVE]: 'study',
  [AppMode.GAME_ACTIVE]: 'study',
  [AppMode.GAME_RESULTS]: 'study',
  [AppMode.STUDY_PRODUCT_DRAFTS]: 'study',
  [AppMode.SEMESTER_PRODUCTS]: 'study',

  [AppMode.CHAT]: 'chat',
  [AppMode.CREATE_GROUP]: 'chat',

  [AppMode.DISCOVER]: 'campus',
  [AppMode.COMMUNITY_DETAIL]: 'campus',
  [AppMode.CAMPUS_PAGE]: 'campus',
  [AppMode.STUDY_ROOM]: 'campus',
  [AppMode.MARKETPLACE]: 'campus',
  [AppMode.MARKETPLACE_LISTING_DETAIL]: 'campus',
  [AppMode.CREATE_MARKETPLACE_LISTING]: 'campus',
  [AppMode.MY_LISTINGS]: 'campus',
  [AppMode.MARKETPLACE_PURCHASES]: 'campus',
  [AppMode.MARKETPLACE_FAVORITES]: 'campus',
  [AppMode.MARKETPLACE_INQUIRIES]: 'campus',
  [AppMode.MARKETPLACE_ORDERS]: 'campus',
  [AppMode.MARKETPLACE_CART]: 'campus',
  [AppMode.MARKETPLACE_ORDER_DETAIL]: 'campus',
  [AppMode.SELLER_CUSTOMERS]: 'campus',
  [AppMode.SELLER_PROFILE]: 'campus',
  [AppMode.CREATOR_PROFILE]: 'campus',
  [AppMode.MARKETPLACE_JOBS]: 'campus',
  [AppMode.MARKETPLACE_JOB_DETAIL]: 'campus',
  [AppMode.CREATE_MARKETPLACE_JOB]: 'campus',
  [AppMode.MY_JOB_POSTINGS]: 'campus',
  [AppMode.MY_JOB_APPLICATIONS]: 'campus',
  [AppMode.JOB_EMPLOYER]: 'campus',
  [AppMode.JOB_EMPLOYER_PIPELINE]: 'campus',
  [AppMode.JOB_COMPANY]: 'campus',

  [AppMode.BUDGET_TRACKER]: 'me',
  [AppMode.OFFLINE_MODE]: 'me',
  [AppMode.INVITE_FRIENDS]: 'me',
  [AppMode.ADMIN]: 'me',
};

/**
 * The lit destination. The path wins where a route has no mode behind it (Me),
 * otherwise the mode decides — a mode outlives a path change by a tick, and
 * lighting the wrong tab for that tick is a visible flicker.
 */
export function resolveActiveDestination(
  appMode: AppMode,
  pathname?: string | null,
): DestinationId | null {
  const path = pathname ? pathname.replace(/\/$/, '') : null;
  if (path === ME_PATH) return 'me';
  // `/study/tests/new` and `/study/tests/:testId` have no AppMode behind them
  // (they render from the path, as `/me` does), so the mode underneath is
  // whatever the student came from. The path is the only truthful signal, and
  // both are inside Study.
  if (path && (path === TEST_BUILDER_PATH || path.startsWith('/study/tests/') || path.startsWith('/study/courses/'))) return 'study';
  return MODE_OWNER[appMode] ?? null;
}
