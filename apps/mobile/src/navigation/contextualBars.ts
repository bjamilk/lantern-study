/**
 * The contextual row: the second row of doors *within* a destination, and what
 * a press on one means (spec v3 §7.2, "Lantern's version").
 *
 * The global five — Home · Study · Chat · Campus · Me — are the whole product's
 * map. This is the row below them: a small set of doors within the destination
 * you are already in, so a student can move from Library to Tests without
 * climbing out to the hub and back down.
 *
 * WHERE THE ROW SITS — ALWAYS ABOVE THE GLOBAL BAR, on every registry, with no
 * per-registry mode to declare (device pass on build 185, which reverts the
 * `replace` mode of 2026-09-08).
 *
 * The 2026-09-08 decision let Study and Shop declare `mode: 'replace'`: their
 * row stood IN the global bar's slot, the five destinations came off screen for
 * the whole section, and a single leading Back/Home control stood in for them.
 * The device pass rejected exactly that: on the Study hub, Library, Tests and
 * every Shop root the five labelled tabs were simply GONE, which is the
 * StudyFetch behaviour §7.2 was written against (`inv #169`) and the opposite of
 * the target — five labelled tabs, always. So the mode, the exit control and the
 * clearance arithmetic that took the bar's height back out are all removed
 * rather than left switched off: a row that can never replace the bar cannot
 * regress into replacing it.
 *
 * The rule is now unconditional and needs no field: the contextual row is drawn
 * directly ABOVE the global bar, inside the same chrome view, and the global bar
 * stays fully labelled underneath it. That holds for a SECTION of co-equal doors
 * (Study, Shop) and for a SINGLE screen you pass through (one deck, one note,
 * one document, one community) alike — the global bar is every row's way out, so
 * no row needs one of its own.
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
 * FOUNDER SCOPE: six registries live here now — Study and Shop, and deck
 * detail, the note editor, the walk-through and a community page. Every one of
 * them sits ABOVE the global bar (see the header).
 * The five added after Study brought two things the Study row never needed, and
 * both are deliberately small:
 *
 * - `paramsFrom`. Every deck mode is "this deck, in that mode", so the row has
 *   to carry the deck id it is standing on. The registry cannot read the
 *   navigator, so the FOCUSED ROUTE'S OWN PARAMS are passed into
 *   `planContextualPress` and named keys are copied across. `requires` names
 *   the keys the item is meaningless without: a Review with no `deckId` opens
 *   an immersive session on nothing, so the plan is `unavailable` instead —
 *   never a navigate that lands somewhere broken.
 * - `screenAction`. Two of the note editor's four doors are not screens and not
 *   global stores either: "Cards" is that screen's own generate-flashcards flow
 *   (credits, a job, a toast). The plan names the action and the SCREEN runs
 *   it, exactly as `record` and `ai` name a door someone else opens.
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
  | {
      kind: 'route';
      route: RouteName;
      /** Fixed params, the same on every press. */
      params?: Record<string, unknown>;
      /**
       * Params to carry across from the FOCUSED route, by name.
       *
       * The deck row is the reason this exists: `DeckDetail` → `MatchStudy` is
       * only meaningful for the deck you are looking at, and the registry is a
       * constant that cannot know which one that is. Keys absent from the
       * focused route's params are skipped, not written as `undefined` — React
       * Navigation merges params, and an explicit `undefined` would erase one
       * the screen already had.
       */
      paramsFrom?: readonly string[];
      /**
       * The subset of `paramsFrom` the item is meaningless without.
       *
       * `deckId` is required and `deckName` is not: a nameless review is a
       * cosmetic loss, a deckless one is an immersive session over an empty
       * deck. A missing required key makes the press `unavailable` rather than
       * a navigate — the row would rather do nothing than do that.
       */
      requires?: readonly string[];
    }
  | { kind: 'record' }
  | { kind: 'ai' }
  | { kind: 'screenAction'; action: ContextualScreenAction };

/**
 * A door that only the focused SCREEN can open.
 *
 * Not a route (there is nothing to navigate to) and not a store either (these
 * flows spend credits, run a job and raise a toast inside the note editor's own
 * state). The registry names the action; the screen listens for it.
 */
export type ContextualScreenAction =
  /** Scroll to / open the note editor's "Learn from this note" card. */
  | 'noteLearn'
  /** The editor's own "Turn into → Flashcards" generate flow. */
  | 'noteFlashcards'
  /** The walk-through's plan panel — the document's pages, and which are done. */
  | 'walkthroughPlan'
  /** Ask about the page on screen: the composer, typed or spoken. */
  | 'walkthroughAsk'
  /** Make questions from THIS page (one AI use). */
  | 'walkthroughQuiz'
  /** Mark the page on screen done, or undo that. */
  | 'walkthroughDone'
  /** Open the community's one live chat (its `General` lounge). */
  | 'communityChat'
  /** Jump to the community's BOARDS section. */
  | 'communityBoards'
  /** Jump to the community's STUDY ROOMS section. */
  | 'communityRooms';

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
  /**
   * The row's accent when NO item is the current screen.
   *
   * Study has none on purpose — its hub is not one of its own doors, so the row
   * is neutral there and §7.2 says "feature of the active item". The three rows
   * added after it are the opposite case: §7.2 gives the deck row lime and the
   * note row teal outright, because you are never standing on one of their
   * items — `DeckDetail` and `NoteEditor` are the screens the row serves, not
   * destinations inside it.
   */
  accent?: FeatureKey;
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
      // The companion door is "Ask Lantern" everywhere a door is named. This
      // row has five items and no room for two words, so it wears the short
      // form "Ask" — never "AI", which named nothing the student could see.
      label: 'Ask',
      icon: 'sparkles',
      feature: 'ai',
      target: { kind: 'ai' },
    },
  ],
};

/**
 * The deck row: the four ways to study THIS deck, without going back up to the
 * deck screen's own buttons every time.
 *
 * Every target is a fullScreenModal session on the same stack, and every one of
 * them takes the deck — hence `paramsFrom`. Nothing here is ever the active
 * item: the sessions are immersive, so the row does not exist inside them, and
 * `DeckDetail` itself is the screen the row serves rather than a fifth mode. So
 * the accent is declared (§7.2: lime = `flashcards`) instead of derived.
 *
 * Cram is the plain speed run, not the timed drill: the timed one asks for a
 * length first, and an item in this row may not open a sheet (§7.2 swap rule).
 */
const DECK_BAR: ContextualBarSpec = {
  stack: 'StudyTab',
  accent: 'flashcards',
  items: [
    {
      id: 'review',
      label: 'Review',
      icon: 'play-circle',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'FlashcardReview',
        paramsFrom: ['deckId', 'deckName'],
        requires: ['deckId'],
      },
    },
    {
      id: 'learn',
      label: 'Learn',
      icon: 'school',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'LearnStudy',
        paramsFrom: ['deckId', 'deckName'],
        requires: ['deckId'],
      },
    },
    {
      id: 'match',
      label: 'Match',
      icon: 'shuffle',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'MatchStudy',
        paramsFrom: ['deckId', 'deckName'],
        requires: ['deckId'],
      },
    },
    {
      id: 'cram',
      label: 'Cram',
      icon: 'flash',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'CramSession',
        paramsFrom: ['deckId', 'deckName'],
        requires: ['deckId'],
      },
    },
  ],
};

/**
 * The note row: the four things a note becomes — §7.2's "the Note Learn
 * actions, closes the mobile gap".
 *
 * Two of the four are the editor's own flows rather than screens, which is what
 * `screenAction` is for. Test is the one real navigate: `TestBuilder` is a
 * Study-stack route and takes the note as its source, so `paramsFrom` carries
 * `noteId` across and `requires` keeps the builder from opening on nothing.
 *
 * Accent teal (`notes`) per §7.2, declared for the same reason as the deck
 * row: you are standing on the note, not on one of its four doors.
 */
const NOTE_BAR: ContextualBarSpec = {
  stack: 'StudyTab',
  accent: 'notes',
  items: [
    {
      id: 'learn',
      label: 'Learn',
      icon: 'bulb',
      feature: 'notes',
      target: { kind: 'screenAction', action: 'noteLearn' },
    },
    {
      id: 'cards',
      label: 'Cards',
      icon: 'layers',
      feature: 'flashcards',
      target: { kind: 'screenAction', action: 'noteFlashcards' },
    },
    {
      id: 'test',
      label: 'Test',
      icon: 'clipboard',
      feature: 'tests',
      target: {
        kind: 'route',
        route: 'TestBuilder',
        paramsFrom: ['noteId'],
        requires: ['noteId'],
      },
    },
    {
      id: 'ai',
      // The companion door is "Ask Lantern" everywhere a door is named. This
      // row has five items and no room for two words, so it wears the short
      // form "Ask" — never "AI", which named nothing the student could see.
      label: 'Ask',
      icon: 'sparkles',
      feature: 'ai',
      target: { kind: 'ai' },
    },
  ],
};

/**
 * The walk-through row: Plan · Ask · Quiz · Done.
 *
 * All four are `screenAction`s, and that is not a shortcut — none of them is a
 * place. Plan and Ask open the screen's own panels, Quiz spends an AI use on
 * the page in front of the student, and Done writes a mark. A row item may not
 * open a sheet that belongs to somewhere else (§7.2's swap rule); these open
 * this screen's own surfaces, which is the same thing the note editor's Learn
 * item already does.
 *
 * Accent teal (`notes`) for the same reason the note row declares one: the
 * student is standing on the document, never on one of its four doors, so
 * there is no active item to derive a colour from.
 */
const WALKTHROUGH_BAR: ContextualBarSpec = {
  stack: 'StudyTab',
  accent: 'notes',
  items: [
    {
      id: 'plan',
      label: 'Plan',
      icon: 'list',
      feature: 'notes',
      target: { kind: 'screenAction', action: 'walkthroughPlan' },
    },
    {
      id: 'ask',
      label: 'Ask',
      icon: 'sparkles',
      feature: 'ai',
      target: { kind: 'screenAction', action: 'walkthroughAsk' },
    },
    {
      id: 'quiz',
      label: 'Quiz',
      icon: 'clipboard',
      feature: 'tests',
      target: { kind: 'screenAction', action: 'walkthroughQuiz' },
    },
    {
      id: 'done',
      label: 'Done',
      icon: 'checkmark-circle',
      feature: 'notes',
      target: { kind: 'screenAction', action: 'walkthroughDone' },
    },
  ],
};

/**
 * The community row: Lounge · Boards · Rooms · Members.
 *
 * The spec names it "Board · Channels · Members · Rooms"; these are the same
 * four doors under the names this app already uses for them. "Channels" is the
 * community's ONE live chat — founder decision 1 (2026-09-02) keeps the lounge
 * a chat and renders it as `General`. It is labelled **Lounge**, not "Chat":
 * every row sits above the global bar — whose second tab is the
 * app-wide "Chat" — sits directly below it, and build 175's device pass found
 * the old green "Chat" item reading as a second, broken copy of that tab once
 * the row's labels were restored. `communityChat` opens the community's own
 * lounge (`openLounge` → the `General` channel), which is what "Lounge" names.
 * Boards and Rooms are the two sections of the community page below that.
 *
 * Three of the four are `screenAction`s and one is a route, and that split is
 * forced by where the things actually live: Boards and Rooms are SECTIONS of
 * `CommunityDetail`, not screens, and the lounge is a group whose id the
 * registry cannot know (it is minted on first use by `POST /communities/:id/
 * lounge`). Members is a real CampusStack route, and `CommunityDetail`'s own
 * `slug` param is exactly what it needs — hence `paramsFrom`/`requires`, so a
 * press before the community has loaded is `unavailable` rather than a push
 * onto a roster for nothing.
 *
 * Keyed on `CommunityDetail` ALONE. `CommunityChannel` is deliberately absent:
 * inside a channel chat the row would sit under the composer and above the
 * keyboard, and the spec hides it there. `CommunityMembers`, `CommunityPost`
 * and the board are rooms reached BY this row and carry their own back arrow;
 * keying them would put three screen actions on screens that do not register
 * them, which is a row of dead buttons.
 *
 * Accent `campus` for the same reason the deck and note rows declare one: the
 * student is standing on the community, never on one of its four doors.
 */
const COMMUNITY_BAR: ContextualBarSpec = {
  stack: 'CampusTab',
  accent: 'campus',
  items: [
    {
      // The community's one live chat (its `General` lounge). Labelled "Lounge"
      // rather than "Chat" so it cannot be mistaken for the global "Chat" tab
      // sitting one row below it — see this registry's header.
      id: 'chat',
      label: 'Lounge',
      icon: 'chatbubbles',
      feature: 'groups',
      target: { kind: 'screenAction', action: 'communityChat' },
    },
    {
      id: 'boards',
      label: 'Boards',
      icon: 'list',
      feature: 'campus',
      target: { kind: 'screenAction', action: 'communityBoards' },
    },
    {
      id: 'rooms',
      label: 'Rooms',
      icon: 'people',
      feature: 'campus',
      target: { kind: 'screenAction', action: 'communityRooms' },
    },
    {
      id: 'members',
      label: 'Members',
      icon: 'person',
      feature: 'campus',
      target: {
        kind: 'route',
        route: 'CommunityMembers',
        paramsFrom: ['slug'],
        requires: ['slug'],
      },
    },
  ],
};

/**
 * The Shop row: Browse · Cart · You, §7.2's third registry.
 *
 * Shop lives on the CAMPUS stack — `MarketTab` in the spec table is the retired
 * tab name, kept only as a redirect shim (navigation/legacyTabs.ts) — so every
 * target here is a `CampusStack` route reached by name, and the Campus tab
 * stays lit the whole way.
 *
 * `MarketplaceHome` is deliberately NOT a key: it is a one-frame redirect onto
 * the Campus shop segment, and a row on it would flash in and straight back out.
 * The department pages and the course index are rooms inside Browse rather than
 * doors of their own, so they hang off `activeFor`.
 *
 * Accent `campus` — §7.2 writes "marketplace", which is this palette's name for
 * the same identity; `FEATURE_KEYS` has eight entries and campus is Shop's.
 */
const SHOP_BAR: ContextualBarSpec = {
  stack: 'CampusTab',
  // The app bar keeps naming the SECTION, Campus: this row no longer owns the
  // bottom (the global five sit under it), so `campusAppBarTitleOverride` no
  // longer renames the screen to "Shop". In practice every
  // keyed Shop surface has an active door (Browse is `activeFor` the Campus shop
  // segment and the two course rooms), so the row draws a selected pill; a Shop
  // key with no active door would label every door instead, exactly as the Study
  // hub now does.
  accent: 'campus',
  items: [
    {
      id: 'browse',
      label: 'Browse',
      icon: 'storefront',
      feature: 'campus',
      // Departments and the by-course index are Browse, not extra doors, and
      // so is Campus's own shop SEGMENT — the grid a student actually lands on
      // (see CONTEXTUAL_BAR_SEGMENTS). Browse is therefore active there while
      // still targeting `ShopBrowse`: pressing it opens the department list,
      // exactly as Tests walks out of the test builder rather than scrolling a
      // screen that is not there. It cannot target `Campus` in any case — that
      // is the stack ROOT, which is the global bar's re-tap, never a row's.
      target: { kind: 'route', route: 'ShopBrowse' },
      activeFor: ['Campus', 'CourseBrowse', 'CourseListings'],
    },
    {
      id: 'cart',
      label: 'Cart',
      icon: 'cart',
      feature: 'campus',
      target: { kind: 'route', route: 'Cart' },
    },
    {
      id: 'you',
      label: 'You',
      icon: 'person-circle',
      feature: 'campus',
      // Orders, saved and the seller tools are rooms of the You hub, but they
      // are not keys of this registry, so they carry no row and there is
      // nothing for an `activeFor` to highlight. Adding one here without also
      // adding the key is dead data that reads like a decision.
      target: { kind: 'route', route: 'ShopAccount' },
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
  CourseRoom: STUDY_BAR,
  NotesStudio: STUDY_BAR,
  AdaptiveQuiz: STUDY_BAR,
  LectureStudio: STUDY_BAR,
  LessonStudio: STUDY_BAR,
  RecapStudio: STUDY_BAR,
  StudyCalendar: STUDY_BAR,
  EssayStudio: STUDY_BAR,
  PlayStudio: STUDY_BAR,
  Library: STUDY_BAR,
  NotesList: STUDY_BAR,
  FlashcardsList: STUDY_BAR,
  TestsList: STUDY_BAR,
  // The SAME spec object as every other Study route, so the row does not
  // twitch when "+ New test" pushes this screen — only which item is active
  // changes, and `activeFor` keeps that on Tests.
  TestBuilder: STUDY_BAR,

  // One deck, four modes. The sessions themselves are immersive and carry no
  // row at all, which is why only the deck screen is keyed.
  DeckDetail: DECK_BAR,

  // The note editor. `NotesList` keeps the STUDY row above — the list is a
  // Study surface; the editor is a note.
  NoteEditor: NOTE_BAR,

  // The walk-through. A reading screen, not a session: it keeps both bars, so
  // the way out is the global bar rather than the pixel it was entered by.
  Walkthrough: WALKTHROUGH_BAR,

  // Shop, on the Campus stack. The three keys the row points at, plus the
  // browse rooms that hang off them, so the row never disappears mid-shop.
  ShopBrowse: SHOP_BAR,
  CourseBrowse: SHOP_BAR,
  CourseListings: SHOP_BAR,
  Cart: SHOP_BAR,
  Checkout: SHOP_BAR,
  Addresses: SHOP_BAR,
  ShopAccount: SHOP_BAR,

  // The community page. Only this key — see COMMUNITY_BAR's header for why the
  // roster, the board and a channel chat carry no row.
  CommunityDetail: COMMUNITY_BAR,
};

/**
 * The rows that belong to a SEGMENT of a route rather than to the route.
 *
 * Build 166's device pass found the Shop row missing everywhere it mattered,
 * and the reason was not a typo: `ShopBrowse` is a real CampusStack screen,
 * but it is the DEPARTMENT LIST, two taps in. The Shop a student actually
 * lands on from the tab bar is the `shop` segment of the `Campus` route —
 * `CampusScreen` renders `MarketplaceScreen` inline — so the focused route
 * name the chrome observes there is `Campus`, which no key matched.
 *
 * A segment is not screen state: `CampusScreen` publishes the visible one back
 * into its own route params (`navigation.setParams({ segment })`), so this
 * stays what the file's header promises — a function of the FOCUSED ROUTE and
 * its params, decided once, unmovable by scrolling, the keyboard or a
 * selection. `Campus` with the communities or jobs segment has no row, exactly
 * as before.
 */
export const CONTEXTUAL_BAR_SEGMENTS: Partial<
  Record<RouteName, { param: string; values: Readonly<Record<string, ContextualBarSpec>> }>
> = {
  Campus: { param: 'segment', values: { shop: SHOP_BAR } },
};

/**
 * The row for a focused route, or null when there is none.
 *
 * Immersive routes are subtracted here rather than left to the caller: a
 * session owns the whole window, both bars unmount, and the screen's own header
 * back is the one tap out. `shouldHideTabBar` is the single source for that
 * list, so a route added to it can never keep a row behind the founder's back.
 *
 * `focusedParams` is optional and only ever read for a route in
 * {@link CONTEXTUAL_BAR_SEGMENTS}: a caller that has none still gets the right
 * answer for every route whose row is the route's alone.
 */
export function specForRoute(
  focusedRoute: string | undefined,
  focusedParams?: Record<string, unknown> | undefined,
): ContextualBarSpec | null {
  if (!focusedRoute) return null;
  if (shouldHideTabBar(focusedRoute)) return null;
  const segmented = CONTEXTUAL_BAR_SEGMENTS[focusedRoute as RouteName];
  if (segmented) {
    const value = focusedParams?.[segmented.param];
    if (typeof value !== 'string') return null;
    return segmented.values[value] ?? null;
  }
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
export function activeItem(
  focusedRoute: string | undefined,
  focusedParams?: Record<string, unknown> | undefined,
): ContextualBarItem | null {
  const spec = specForRoute(focusedRoute, focusedParams);
  if (!spec) return null;
  return (
    spec.items.find(
      item =>
        (item.target.kind === 'route' && item.target.route === focusedRoute) ||
        item.activeFor?.includes(focusedRoute as RouteName),
    ) ?? null
  );
}

/**
 * The row's accent: the active item's feature, else the row's own declared one.
 *
 * The fallback is not a default — it is only ever set on rows whose SCREEN is
 * not one of their items (the deck, the note), where §7.2 names a colour
 * outright. Study declares none, so its hub stays neutral exactly as before.
 */
export function accentForRoute(
  focusedRoute: string | undefined,
  focusedParams?: Record<string, unknown> | undefined,
): FeatureKey | null {
  const item = activeItem(focusedRoute, focusedParams);
  if (item) return item.feature;
  return specForRoute(focusedRoute, focusedParams)?.accent ?? null;
}

export interface ContextualPressInput {
  /** The route currently focused inside the tab's stack. */
  focusedRoute: string | undefined;
  item: ContextualBarItem;
  /**
   * That route's own params, for targets that declare `paramsFrom`.
   *
   * Optional so a caller that has no params to give (or has not been taught to
   * pass them yet) still compiles and still gets the right plan for every
   * target that does not need them.
   */
  focusedParams?: Record<string, unknown> | undefined;
}

export type ContextualPressPlan =
  | { kind: 'navigate'; route: RouteName; params?: Record<string, unknown> }
  | { kind: 'scrollToTop' }
  | { kind: 'openAi' }
  | { kind: 'record' }
  /** The focused SCREEN runs this one; see `ContextualScreenAction`. */
  | { kind: 'screenAction'; action: ContextualScreenAction }
  /**
   * Nothing to do: the item needs a param the focused route did not supply.
   * The row does nothing rather than navigating somewhere broken.
   */
  | { kind: 'unavailable' };

/**
 * The params a `route` target should carry, or null when a required one is
 * missing.
 *
 * Fixed `params` first, `paramsFrom` over the top — the two never name the same
 * key today, and if they ever do, the value belonging to the deck or note you
 * are actually looking at is the one that should win. A key the focused route
 * does not have is left out entirely rather than written as `undefined`, which
 * React Navigation's param merge would treat as an erasure.
 */
function resolveParams(
  target: Extract<ContextualBarTarget, { kind: 'route' }>,
  focusedParams: Record<string, unknown> | undefined,
): Record<string, unknown> | null | undefined {
  for (const key of target.requires ?? []) {
    if (focusedParams?.[key] === undefined) return null;
  }
  const carried: Record<string, unknown> = { ...(target.params ?? {}) };
  for (const key of target.paramsFrom ?? []) {
    const value = focusedParams?.[key];
    if (value !== undefined) carried[key] = value;
  }
  // `{ params: undefined }` is not `{}` to the param merge; say nothing at all.
  return Object.keys(carried).length > 0 ? carried : undefined;
}

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
  focusedParams,
}: ContextualPressInput): ContextualPressPlan {
  const { target } = item;
  if (target.kind === 'record') return { kind: 'record' };
  if (target.kind === 'ai') return { kind: 'openAi' };
  if (target.kind === 'screenAction') return { kind: 'screenAction', action: target.action };
  if (focusedRoute && target.route === focusedRoute) return { kind: 'scrollToTop' };
  const params = resolveParams(target, focusedParams);
  if (params === null) return { kind: 'unavailable' };
  return {
    kind: 'navigate',
    route: target.route,
    ...(params !== undefined ? { params } : {}),
  };
}
