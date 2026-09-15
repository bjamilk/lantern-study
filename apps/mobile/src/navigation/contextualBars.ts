/**
 * The contextual row: the second row of doors *within* a destination, and what
 * a press on one means (spec v3 §7.2, "Lantern's version").
 *
 * The global five — Home · Study · Chat · Campus · Me — are the whole product's
 * map. This is the row below them: a small set of doors within the destination
 * you are already in, so a student can move from Library to Tests without
 * climbing out to the hub and back down.
 *
 * WHERE THE ROW SITS. Above the global bar on every registry EXCEPT one: the
 * set row (`SET_BAR`), which stands IN the global bar's slot — one bar at a
 * time, the StudyFetch model (SF2 evidence §2, §4, §6 items 2 and 3).
 *
 * That is not a re-run of the 2026-09-08 `replace` mode the build-185 device
 * pass rejected, and the difference is the whole reason it is safe now. The old
 * mode took the five labelled tabs away across ALL of Study and ALL of Shop —
 * on the Study hub, on Library, on Tests, on every Shop root — so the product's
 * map vanished from surfaces that are not inside anything. `replace` is now
 * declared by exactly one row, on exactly the routes that are INSIDE ONE SET
 * (the room and its studios), it carries a leading `Home` door back out to the
 * global tabs, and it is suppressed entirely unless the focused route actually
 * names a set (`requiresAnyParam`). Outside a set, the global bar stands alone
 * with no row above it at all — which is the other half of SF2 §6 #3: the Study
 * row used to STACK on the tab bar for 290 px of chrome on surfaces where it
 * duplicated the destinations underneath it.
 *
 * So the default is still `above`, and every row that is not the set row keeps
 * it: a row for a SINGLE screen you pass through (one deck, one note, one
 * document, one community) and the Shop section's row alike are drawn directly
 * ABOVE a global bar that stays fully labelled underneath them. The global bar
 * is those rows' way out, so none of them needs one of its own. The set row is
 * the one place where the global bar is not on screen, which is exactly why it
 * is the one row that carries `Home`.
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
 * THE ONE-WAY RULE. Every function here is a pure read of `(focusedRoute,
 * focusedParams)`. Those two come from React Navigation's own state —
 * RootNavigator's `CustomTabBar` walks the focused chain and publishes them
 * into the chrome context — so the ROUTE is the source of truth and the bar is
 * a projection of it. The flow is route → bar, and only that way:
 *
 * - Nothing in this file mutates anything. `specForRoute`, `activeItem`,
 *   `accentForRoute`, `contextualBarMode` and `planContextualPress` return
 *   values; they never call `setParams`, never touch a store, and never
 *   navigate. A press produces a PLAN that a caller carries out.
 * - A bar must never write its own state back into the route it was derived
 *   from. Doing so closes the loop — the route re-renders the bar, which
 *   re-writes the route — and React Navigation rebuilds `route.params` on every
 *   navigate, so each lap is a fresh object and nothing ever settles. That is
 *   the `Maximum update depth exceeded` crash documented in
 *   navigation/segmentParamSync.ts, and the reason the mirror it describes was
 *   removed.
 * - The screen's side of the same rule: a door's ask arrives as a param, is
 *   adopted ONCE (segmentParamSync.ts, keyed by a ticket), and what the screen
 *   is actually showing is published to a store (stores/setRoomUiStore) — never
 *   back into the params. The param is an inbox, not a mirror.
 * - The one exception, and it is guarded: `Campus` has three segments inside a
 *   single route, so `CONTEXTUAL_BAR_SEGMENTS` below needs a param the route
 *   would not otherwise carry, and CampusScreen publishes the visible segment
 *   into its own params under `shouldPublishCampusSegment` — a rule that keeps
 *   exactly one writer per event and never overwrites an unadopted request.
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
  | {
      kind: 'record';
      /**
       * Params carried from the FOCUSED route into the note the door creates.
       *
       * The set row is why this exists: "Record" inside a set must file the
       * lecture note INTO that set (`studySetId`), not into the loose pile the
       * global Study row's Record door made. Same copy-by-name rule as a route
       * target's `paramsFrom`; the keys land on `createNote`.
       */
      paramsFrom?: readonly string[];
    }
  | {
      kind: 'ai';
      /**
       * Keys of the focused route that identify the ROOM this door's companion
       * is about, narrowest first; the first one present wins.
       *
       * SF2 §6 #14: Ask pressed inside a set room opened a companion scoped to
       * the last NOTE the student had open ("On: Lecture — 12 Sep"), because
       * the panel restored whatever attachment was persisted. A door that knows
       * which set it is standing in can say so before the sheet mounts, which
       * is what `openForScope` is for.
       */
      scopeIdFrom?: readonly string[];
      /** Keys carrying a human NAME for that room ("On: Pharmacology"). */
      scopeLabelFrom?: readonly string[];
    }
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

/**
 * Where the row is drawn.
 *
 * - `above` (the default, and every row but one): directly above a global bar
 *   that is still on screen and still fully labelled.
 * - `replace`: IN the global bar's slot — the five tabs come off screen while
 *   the row is up. One bar at a time, StudyFetch's model. Only ever declared by
 *   a row that (a) is about ONE THING the student is inside, (b) carries its own
 *   way back out to the global tabs, and (c) is suppressed when that thing is
 *   not known. `SET_BAR` is the only such row; see this file's header for why
 *   the sectionwide version of this was reverted in build 185.
 */
export type ContextualBarMode = 'above' | 'replace';

export interface ContextualBarSpec {
  /** The tab whose stack every `route` target below belongs to. */
  stack: ContextualBarStack;
  items: readonly ContextualBarItem[];
  /** Where the row sits. Omitted means `above` — see {@link ContextualBarMode}. */
  mode?: ContextualBarMode;
  /**
   * Param keys the row is MEANINGLESS without: unless the focused route carries
   * at least one of them, this spec resolves to null and the route has no row.
   *
   * The set row needs a set. A `replace` row with nothing to be about would take
   * the five tabs off screen in exchange for five doors that cannot say which
   * set they lead into — so the honest answer there is no row at all, and the
   * global bar alone. `requires` on a single ITEM makes that one press
   * `unavailable`; this makes the whole ROW stand down.
   */
  requiresAnyParam?: readonly string[];
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
 * The SET row: the doors of the set you are standing IN — SF2 §6 items 2 and 3.
 *
 * WHAT IT REPLACES. The old `STUDY_BAR` carried `Library · Flashcards · Tests ·
 * Record · Ask` on every Study screen, stacked on top of the global bar, and
 * every one of those five opened a GLOBAL list. Pressed from inside a set that
 * is not a sub-navigation, it is an exit: the student is thrown out of the set
 * they were working in and into the app-wide pile of everything they own, with
 * the room they left reachable only by Back. StudyFetch's five tabs are
 * set-scoped by construction — the bottom bar IS the set — so this row is too:
 * every door below acts INSIDE the set named by the focused route's params.
 *
 * WHY IT REPLACES THE TAB BAR. On the surfaces it is keyed to, the student is
 * inside one thing, and the five global destinations are not the question being
 * asked; two stacked bars spent 290 px (12% of the window) on nav and drew
 * `Ask`/`Flashcards`/`Tests` twice within a thumb's reach of each other. So the
 * global bar stands down and `Home` — the first door, mirroring StudyFetch's
 * first tab — is the way back to it. Everywhere else in Study the global bar is
 * alone with no row above it.
 *
 * THE LABELS STAY. StudyFetch labels only its selected tab; this row labels all
 * six, which is Lantern's own win and the reason `Materials` reads as a word
 * rather than a tray glyph.
 */
const SET_BAR: ContextualBarSpec = {
  stack: 'StudyTab',
  mode: 'replace',
  // No set in the focused route's params, no row: see `requiresAnyParam`. A
  // studio opened without one keeps the global bar, which is the only honest
  // answer when the row could not say which set its doors lead into.
  requiresAnyParam: ['studySetId', 'courseId'],
  items: [
    {
      // The way back to the global five, in the slot StudyFetch puts `Home` in.
      // It targets the Study HUB rather than the Home tab: the hub is where the
      // sets live, it is in this same stack (so no nested navigate), and it
      // carries no row of its own — so pressing it is also what puts the five
      // labelled tabs back on screen.
      id: 'home',
      label: 'Home',
      icon: 'home',
      feature: 'sets',
      target: { kind: 'route', route: 'StudyHub' },
    },
    {
      // Was "Library", and that is the rename that matters: the old door opened
      // the app-wide library. This one opens the MATERIALS segment of the room
      // for this set. `segment` is the param name agreed with the room's own
      // segment row (screens/study/CourseRoomScreen.tsx); it is declared on
      // `CourseRoom` in navigation/types.ts.
      id: 'materials',
      label: 'Materials',
      icon: 'library',
      feature: 'notes',
      target: {
        kind: 'route',
        route: 'CourseRoom',
        params: { segment: 'materials' },
        paramsFrom: ['studySetId', 'courseId', 'courseLabel'],
      },
    },
    {
      // This set's decks, not every deck. `StudySetLibrary` is the screen for
      // "what is filed in ONE set"; `kind` picks the shelf.
      id: 'flashcards',
      label: 'Flashcards',
      icon: 'layers',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'StudySetLibrary',
        params: { kind: 'cards' },
        paramsFrom: ['studySetId', 'courseId', 'courseLabel'],
        // The screen's own contract: it is the library OF a set and cannot
        // open without one. The row is suppressed without a set anyway; this
        // is the second lock, on the door rather than the row.
        requires: ['studySetId'],
      },
    },
    {
      id: 'tests',
      label: 'Tests',
      icon: 'clipboard',
      feature: 'tests',
      target: {
        kind: 'route',
        route: 'StudySetLibrary',
        params: { kind: 'tests' },
        paramsFrom: ['studySetId', 'courseId', 'courseLabel'],
        requires: ['studySetId'],
      },
    },
    {
      // Record INTO this set: the note the door creates is filed here rather
      // than in the loose pile, which is what `paramsFrom` carries.
      id: 'record',
      label: 'Record',
      icon: 'mic',
      feature: 'recording',
      target: { kind: 'record', paramsFrom: ['studySetId', 'courseId'] },
    },
    {
      // Ask about the SET. `scopeIdFrom` is the §6 #14 fix: the door states the
      // room before the sheet mounts, so the panel cannot fall back to whatever
      // note was attached last.
      id: 'ai',
      label: 'Ask',
      icon: 'sparkles',
      feature: 'ai',
      target: {
        kind: 'ai',
        scopeIdFrom: ['studySetId', 'courseId'],
        scopeLabelFrom: ['courseLabel'],
      },
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
  // INSIDE A SET, and nowhere else in Study.
  //
  // The room, its studios, the set's own library and its import screen all map
  // to the SAME spec object on purpose — the row must not twitch as the student
  // moves between them; only which door is active changes. Every one of these
  // routes declares `studySetId`/`courseId` in navigation/types.ts, which is
  // what `requiresAnyParam` reads; one opened without either keeps the global
  // tab bar instead.
  //
  // NOT KEYED, deliberately: `StudyHub`, `Library`, `NotesList`,
  // `FlashcardsList`, `TestsList`, `TestBuilder` and `StudyCalendar`. Those are
  // the app-wide lists and the hub — you are not inside anything there, so the
  // global bar stands alone (SF2 §6 #3). The row they used to carry was five
  // doors to the very screens they already are.
  CourseRoom: SET_BAR,
  NotesStudio: SET_BAR,
  AdaptiveQuiz: SET_BAR,
  LectureStudio: SET_BAR,
  LessonStudio: SET_BAR,
  RecapStudio: SET_BAR,
  EssayStudio: SET_BAR,
  PlayStudio: SET_BAR,
  StudySetLibrary: SET_BAR,
  StudySetUpload: SET_BAR,

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
    return withRequiredParams(segmented.values[value] ?? null, focusedParams);
  }
  return withRequiredParams(CONTEXTUAL_BARS[focusedRoute as RouteName] ?? null, focusedParams);
}

/**
 * A spec stands down entirely when the focused route names none of the things
 * it is about ({@link ContextualBarSpec.requiresAnyParam}).
 *
 * The set row is the caller that needs this: a `replace` row takes the five
 * global tabs off screen, and it may only do that in exchange for doors that
 * genuinely lead somewhere. With no set id in the route's params, "Flashcards"
 * cannot name a deck list and "Materials" cannot name a room, so the row is not
 * drawn at all and the global bar keeps its place.
 */
function withRequiredParams(
  spec: ContextualBarSpec | null,
  focusedParams: Record<string, unknown> | undefined,
): ContextualBarSpec | null {
  if (!spec?.requiresAnyParam) return spec;
  const satisfied = spec.requiresAnyParam.some((key) => {
    const value = focusedParams?.[key];
    return typeof value === 'string' ? value.trim().length > 0 : value !== undefined;
  });
  return satisfied ? spec : null;
}

/**
 * Where the focused route's row is drawn, and therefore whether the global bar
 * is on screen under it. `above` when there is no row at all — nothing is
 * standing in the bar's place.
 */
export function contextualBarMode(
  focusedRoute: string | undefined,
  focusedParams?: Record<string, unknown> | undefined,
): ContextualBarMode {
  return specForRoute(focusedRoute, focusedParams)?.mode ?? 'above';
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
        (item.target.kind === 'route' &&
          item.target.route === focusedRoute &&
          fixedParamsMatch(item.target.params, focusedParams)) ||
        item.activeFor?.includes(focusedRoute as RouteName),
    ) ?? null
  );
}

/**
 * Do the item's FIXED params describe the screen actually on screen?
 *
 * Two doors on the set row point at the same route and differ only by a fixed
 * param — Flashcards is `StudySetLibrary { kind: 'cards' }` and Tests is the
 * same screen with `kind: 'tests'`, exactly as the room's Materials door is
 * `CourseRoom { segment: 'materials' }`. Route-name matching alone lit whichever
 * of them was declared FIRST on every one of those screens, which is a row that
 * tells the student they are somewhere they are not.
 *
 * Only the fixed `params` are compared, never `paramsFrom`: those carry the set
 * id across and are the same for every door on the row, so they say nothing
 * about which door you are standing in.
 */
function fixedParamsMatch(
  params: Record<string, unknown> | undefined,
  focusedParams: Record<string, unknown> | undefined,
): boolean {
  if (!params) return true;
  return Object.entries(params).every(([key, value]) => focusedParams?.[key] === value);
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
  /**
   * Open the companion. `scopeId` names the ROOM it is about when the door knew
   * one (the set row's Ask); with no scope the panel infers one from the route
   * as it always has.
   */
  | { kind: 'openAi'; scopeId?: string; scopeLabel?: string }
  /** Start the recorder. `params` file the note the door creates (a set id). */
  | { kind: 'record'; params?: Record<string, unknown> }
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
 * The named keys the focused route actually has, or undefined when it has none.
 *
 * The non-route half of `paramsFrom`: the recorder door needs the set id the
 * same way a route target does, and for the same reason — the registry is a
 * constant and cannot know which set the student is inside.
 */
function carried(
  keys: readonly string[] | undefined,
  focusedParams: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!keys?.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = focusedParams?.[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The first of `keys` the focused route carries as a non-empty string. */
function firstString(
  keys: readonly string[] | undefined,
  focusedParams: Record<string, unknown> | undefined,
): string | undefined {
  for (const key of keys ?? []) {
    const value = focusedParams?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
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
  if (target.kind === 'record') {
    const params = carried(target.paramsFrom, focusedParams);
    return { kind: 'record', ...(params !== undefined ? { params } : {}) };
  }
  if (target.kind === 'ai') {
    const scopeId = firstString(target.scopeIdFrom, focusedParams);
    const scopeLabel = firstString(target.scopeLabelFrom, focusedParams);
    return {
      kind: 'openAi',
      ...(scopeId !== undefined ? { scopeId } : {}),
      ...(scopeLabel !== undefined ? { scopeLabel } : {}),
    };
  }
  if (target.kind === 'screenAction') return { kind: 'screenAction', action: target.action };
  // "The route you are already on" is the route AND the fixed params that say
  // which of its segments this door is: pressing Materials from the room's
  // OVERVIEW must navigate to the materials segment, not scroll the overview.
  if (
    focusedRoute &&
    target.route === focusedRoute &&
    fixedParamsMatch(target.params, focusedParams)
  ) {
    return { kind: 'scrollToTop' };
  }
  const params = resolveParams(target, focusedParams);
  if (params === null) return { kind: 'unavailable' };
  return {
    kind: 'navigate',
    route: target.route,
    ...(params !== undefined ? { params } : {}),
  };
}
