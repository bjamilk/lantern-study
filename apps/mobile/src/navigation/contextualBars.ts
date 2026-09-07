/**
 * The contextual row: what sits directly ABOVE the global bottom bar, and what
 * a press on it means (spec v3 §7.2, "Lantern's version").
 *
 * The global five — Home · Study · Chat · Campus · Me — never change. This is
 * the second row: a small set of doors *within* the destination you are
 * already in, so a student can move from Library to Tests without climbing out
 * to the hub and back down. StudyFetch's counter-example is to delete its bar
 * on every pushed screen, which leaves the only way back as the exact pixel you
 * came in by (`inv #169`); the row exists so the global bar never has to move
 * and is always one tap away.
 *
 * Three things this file is deliberately NOT:
 *
 * 1. It is not scroll state. The row is a property of the FOCUSED ROUTE, decided
 *    once, exactly as `immersive` already is (navigation/types.ts). Scrolling,
 *    the keyboard opening, a search box taking focus and a selection changing
 *    all leave it alone.
 * 2. It is not a second tab bar. No item opens a modal or a sheet, and no item
 *    crosses into another tab's stack — every target is a route in the SAME
 *    stack as the route that asked for it, which `contextualBars.test.ts`
 *    asserts against RootNavigator's own `<StudyStack.Screen>` list. That is
 *    what keeps round-4 invariant 3 (`nestedNavigateLint`) irrelevant here:
 *    there is no nested navigate to forget `initial: false` on.
 * 3. It is not a re-tap of the global bar. An item that resolves to the route
 *    you are already on scrolls to top and nothing else — it must not swallow
 *    or duplicate the `tabPress` event that `planTabPress` emits (invariant 2).
 *
 * Pure and import-free at runtime, like tabPressBehavior.ts next door: the two
 * imports below are erased (a type, and a predicate from a file that itself has
 * no runtime imports), so mobile jest's node environment can test all of it.
 *
 * FOUNDER SCOPE, this wave: the STUDY registry only. Deck detail, the note
 * editor and the Shop registries are named in §7.2 and come later; adding a key
 * here is the whole change when they do.
 */

import type { FeatureKey } from '@lantern/shared/design';
import type { AppIconName } from '../components/ui/appIconMap';
import { shouldHideTabBar, type RouteName } from './types';

/** The tab stacks a contextual row can belong to. Keys of MainTabParamList. */
export type ContextualBarStack = 'HomeTab' | 'StudyTab' | 'ChatTab' | 'CampusTab' | 'MeTab';

/**
 * Where an item goes.
 *
 * `route` is a plain route NAME inside the spec's own stack — never a nested
 * `navigate('<Tab>', …)`, never a modal. `record` and `ai` are the two doors
 * that are not screens: the recorder door (ask → create the note → open the
 * editor with `startRecording`, screens/study/recorderDoor.ts) and the AI
 * companion panel (`useCompanionStore.open`). Both live outside this file
 * because both need stores; the plan only says which one to run.
 */
export type ContextualBarTarget =
  | { kind: 'route'; route: RouteName; params?: Record<string, unknown> }
  | { kind: 'record' }
  | { kind: 'ai' };

export interface ContextualBarItem {
  /** Stable id, for keys and for tests; not shown to anyone. */
  id: string;
  /** The visible word. One word wherever one word will do. */
  label: string;
  /** A name in components/ui/appIconMap.ts. */
  icon: AppIconName;
  /** Which of the eight identities paints this item when it is active (§5.6). */
  feature: FeatureKey;
  target: ContextualBarTarget;
  /**
   * Extra routes this item is the ACTIVE one on.
   *
   * A door's own screen can have children in the same lane — "+ New test"
   * pushes TestBuilder, which is still Tests. Without this the row went
   * neutral the moment the builder opened and the student lost the one signal
   * that says which of the five they are inside. Never a navigate target: the
   * item still goes to `target`, so pressing Tests from the builder comes
   * back out to the list rather than scrolling a screen that is not there.
   */
  activeFor?: readonly RouteName[];
}

export interface ContextualBarSpec {
  /** The tab whose stack every `route` target below belongs to. */
  stack: ContextualBarStack;
  items: readonly ContextualBarItem[];
}

/**
 * The Study row: the same five doors the hub shows as tiles, carried down into
 * every screen of the Study stack that is not a session.
 *
 * Every focused route listed here maps to the SAME spec object on purpose —
 * the row must not twitch as you move between Library, Notes, Flashcards and
 * Tests; only which item is active changes.
 */
const STUDY_BAR: ContextualBarSpec = {
  stack: 'StudyTab',
  items: [
    {
      id: 'library',
      label: 'Library',
      icon: 'library',
      feature: 'notes',
      target: { kind: 'route', route: 'Library' },
    },
    {
      id: 'flashcards',
      label: 'Flashcards',
      icon: 'layers',
      feature: 'flashcards',
      target: { kind: 'route', route: 'FlashcardsList' },
    },
    {
      id: 'tests',
      label: 'Tests',
      icon: 'clipboard',
      feature: 'tests',
      target: { kind: 'route', route: 'TestsList' },
      // The builder is a room inside Tests, not a sixth door.
      activeFor: ['TestBuilder'],
    },
    {
      id: 'record',
      label: 'Record',
      icon: 'mic',
      feature: 'recording',
      target: { kind: 'record' },
    },
    {
      id: 'ai',
      label: 'AI',
      icon: 'sparkles',
      feature: 'ai',
      target: { kind: 'ai' },
    },
  ],
};

/**
 * Focused route → the row it carries.
 *
 * A route that is absent has NO row (height 0), which is the correct answer for
 * every tab root outside Study (Dashboard, GroupsList, Campus, Me) and for
 * every screen this wave does not own. An empty registry is exactly today's
 * shell, which is how this ships safely.
 */
export const CONTEXTUAL_BARS: Partial<Record<RouteName, ContextualBarSpec>> = {
  StudyHub: STUDY_BAR,
  Library: STUDY_BAR,
  NotesList: STUDY_BAR,
  FlashcardsList: STUDY_BAR,
  TestsList: STUDY_BAR,
  // The SAME spec object as every other Study route, so the row does not
  // twitch when "+ New test" pushes this screen — only which item is active
  // changes, and `activeFor` keeps that on Tests.
  TestBuilder: STUDY_BAR,
};

/**
 * The row for a focused route, or null when there is none.
 *
 * Immersive routes are subtracted here rather than left to the caller: a
 * session owns the whole window, both bars unmount, and the screen's own header
 * back is the one tap out. `shouldHideTabBar` is the single source for that
 * list, so a route added to it can never keep a row behind the founder's back.
 */
export function specForRoute(focusedRoute: string | undefined): ContextualBarSpec | null {
  if (!focusedRoute) return null;
  if (shouldHideTabBar(focusedRoute)) return null;
  return CONTEXTUAL_BARS[focusedRoute as RouteName] ?? null;
}

/**
 * The item that IS the screen you are looking at, or null.
 *
 * Strictly "this item's target route is the focused route" — an item is active
 * because it points here, not because it is thematically related. The accent
 * the row paints is this item's `feature` (§7.2, "Accent: feature of the active
 * item"); with no active item the row is neutral.
 */
export function activeItem(focusedRoute: string | undefined): ContextualBarItem | null {
  const spec = specForRoute(focusedRoute);
  if (!spec) return null;
  return (
    spec.items.find(
      item =>
        (item.target.kind === 'route' && item.target.route === focusedRoute) ||
        item.activeFor?.includes(focusedRoute as RouteName),
    ) ?? null
  );
}

/** The row's accent, or null when nothing in it is the current screen. */
export function accentForRoute(focusedRoute: string | undefined): FeatureKey | null {
  return activeItem(focusedRoute)?.feature ?? null;
}

export interface ContextualPressInput {
  /** The route currently focused inside the tab's stack. */
  focusedRoute: string | undefined;
  item: ContextualBarItem;
}

export type ContextualPressPlan =
  | { kind: 'navigate'; route: RouteName; params?: Record<string, unknown> }
  | { kind: 'scrollToTop' }
  | { kind: 'openAi' }
  | { kind: 'record' };

/**
 * What a press on a contextual item means.
 *
 * The only branch worth arguing about is the first: pressing the item you are
 * already on. `navigate` to the focused route is a no-op in React Navigation
 * when the params match and a silent param merge when they do not, so the row
 * would feel dead. It scrolls to top instead — the same courtesy the global bar
 * pays on a re-tap, and the same mechanism (`useScrollToTop`). It does NOT emit
 * `tabPress`: that event also pops the stack to root, which is emphatically not
 * what "I pressed Tests while on Tests" should do.
 */
export function planContextualPress({
  focusedRoute,
  item,
}: ContextualPressInput): ContextualPressPlan {
  const { target } = item;
  if (target.kind === 'record') return { kind: 'record' };
  if (target.kind === 'ai') return { kind: 'openAi' };
  if (focusedRoute && target.route === focusedRoute) return { kind: 'scrollToTop' };
  return {
    kind: 'navigate',
    route: target.route,
    ...(target.params !== undefined ? { params: target.params } : {}),
  };
}
