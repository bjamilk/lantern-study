/**
 * Two kinds of test in one file, because the registry has two kinds of way to
 * be wrong.
 *
 * The behaviour half is ordinary: press an item, get the right plan. The other
 * half is a SOURCE SCAN in the spirit of nestedNavigateLint.test.ts — a route
 * name in this registry is a string, a `navigate` to a route that does not
 * exist is silently dropped in release builds, and a target that lands in
 * another tab's stack is the exact dead end the whole navigation round was
 * about. So the route names are checked against RootNavigator's own
 * `<StudyStack.Screen name="…">` list rather than against a copy of it.
 */

import fs from 'fs';
import path from 'path';
import {
  CONTEXTUAL_BARS,
  CONTEXTUAL_BAR_SEGMENTS,
  accentForRoute,
  activeItem,
  contextualBarMode,
  planContextualPress,
  specForRoute,
  type ContextualBarItem,
  type ContextualBarSpec,
} from './contextualBars';
import { IMMERSIVE_ROUTE_NAMES } from './types';
import { TAB_STACK_ROOT_ROUTE } from './tabPressBehavior';

const ROOT_NAVIGATOR = path.resolve(__dirname, 'RootNavigator.tsx');

/** Every `<XStack.Screen name="…">` registered on one navigator, in order. */
function screensOf(navigator: string): string[] {
  const source = fs.readFileSync(ROOT_NAVIGATOR, 'utf8');
  const pattern = new RegExp(`<${navigator}\\.Screen\\s+name="([A-Za-z0-9_]+)"`, 'g');
  const names: string[] = [];
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) names.push(m[1]);
  return names;
}

/** Which navigator component each tab's stack is declared with. */
const STACK_COMPONENT: Record<string, string> = {
  HomeTab: 'HomeStack',
  StudyTab: 'StudyStack',
  ChatTab: 'ChatStack',
  CampusTab: 'CampusStack',
  MeTab: 'MeStack',
};

/**
 * Every row in the file, however it is keyed: the plain route registry AND the
 * segmented one. The source scans below are the only defence against a route
 * name that is a typo or lives in another stack, so a registry they do not
 * walk is a registry with no scan at all — which is how the Shop row shipped
 * pointing at screens the student never lands on.
 */
function entries(): [string, ContextualBarSpec][] {
  const rows = Object.entries(CONTEXTUAL_BARS) as [string, ContextualBarSpec][];
  for (const [route, segmented] of Object.entries(CONTEXTUAL_BAR_SEGMENTS)) {
    for (const [value, spec] of Object.entries(segmented!.values)) {
      rows.push([`${route}#${segmented!.param}=${value}`, spec]);
    }
  }
  return rows;
}

/** The route half of an `entries()` key, without any `#segment=…` suffix. */
function routeOf(key: string): string {
  return key.split('#')[0];
}

function itemById(spec: ContextualBarSpec, id: string): ContextualBarItem {
  const item = spec.items.find(candidate => candidate.id === id);
  if (!item) throw new Error(`no contextual item '${id}'`);
  return item;
}

const barFor = (route: string, params?: Record<string, unknown>): ContextualBarSpec => {
  const spec = specForRoute(route, params);
  if (!spec) throw new Error(`no contextual row on '${route}'`);
  return spec;
};

/** The params a real set room carries. The set row needs one to exist at all. */
const SET = { studySetId: 'set-1', courseLabel: 'Pharmacology' };

const setBar = (): ContextualBarSpec => barFor('CourseRoom', SET);
const deckBar = (): ContextualBarSpec => barFor('DeckDetail');
const noteBar = (): ContextualBarSpec => barFor('NoteEditor');
const shopBar = (): ContextualBarSpec => barFor('ShopBrowse');
const walkthroughBar = (): ContextualBarSpec => barFor('Walkthrough');

/** The params a real `DeckDetail` route carries. */
const DECK = { deckId: 'deck-1', deckName: 'Pharmacology' };

describe('the registry reads its own navigator', () => {
  it('finds the Study stack in RootNavigator (self-check)', () => {
    // If the scan silently stops matching, every assertion below passes for
    // the wrong reason.
    const study = screensOf('StudyStack');
    expect(study).toContain('StudyHub');
    expect(study).toContain('TestsList');
    expect(study.length).toBeGreaterThan(10);
  });

  it('registers every spec against a real tab stack', () => {
    for (const [route, spec] of entries()) {
      expect(STACK_COMPONENT[spec.stack]).toBeDefined();
      expect(TAB_STACK_ROOT_ROUTE[spec.stack as keyof typeof TAB_STACK_ROOT_ROUTE]).toBeDefined();
      expect(typeof route).toBe('string');
    }
  });

  it('keys the registry on routes of the stack they name', () => {
    // The row belongs to the screen you are ON; a key from another stack would
    // mean the row never appears, or appears over the wrong navigator.
    for (const [route, spec] of entries()) {
      expect(screensOf(STACK_COMPONENT[spec.stack])).toContain(routeOf(route));
    }
  });

  it('sends every navigate target to a route in the SAME stack as its key', () => {
    // Invariant 3: a target inside the focused stack is reached by route name
    // alone, so there is no nested `navigate('<Tab>', …)` to forget
    // `initial: false` on, and no stack can be built without its root.
    const offenders: string[] = [];
    for (const [route, spec] of entries()) {
      const screens = screensOf(STACK_COMPONENT[spec.stack]);
      for (const item of spec.items) {
        if (item.target.kind !== 'route') continue;
        if (!screens.includes(item.target.route)) {
          offenders.push(`${route} → ${item.id} → ${item.target.route} (not in ${spec.stack})`);
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });

  it('keeps every activeFor route in the SAME stack as its item', () => {
    // `activeFor` is the other place a route NAME is written as a string, and
    // it is wrong in the same two ways: a typo highlights nothing forever, and
    // a route from another stack claims a highlight this row can never own.
    const offenders: string[] = [];
    for (const [route, spec] of entries()) {
      const screens = screensOf(STACK_COMPONENT[spec.stack]);
      for (const item of spec.items) {
        for (const extra of item.activeFor ?? []) {
          if (!screens.includes(extra)) {
            offenders.push(`${route} → ${item.id} → activeFor ${extra} (not in ${spec.stack})`);
          }
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });

  it('targets the stack root from ONE door only: a replace row\u2019s way out', () => {
    // Invariant 1 said no item may target the stack root, because on an `above`
    // row the global bar's re-tap already goes there and a second path would
    // stack the root under itself. The set row is the exception the rule was
    // never written for: it stands IN the global bar's place, so the bar's
    // re-tap is not on screen to be the way out, and its first door — `Home` —
    // IS that way out. Narrow, not loosened: only a `replace` row may do it,
    // and only through the door whose id is `home`.
    for (const [, spec] of entries()) {
      const root = TAB_STACK_ROOT_ROUTE[spec.stack as keyof typeof TAB_STACK_ROOT_ROUTE];
      for (const item of spec.items) {
        if (item.target.kind !== 'route') continue;
        if (item.target.route !== root) continue;
        expect(spec.mode).toBe('replace');
        expect(item.id).toBe('home');
      }
    }
  });

  it('gives the one replace row a door back to the global tabs', () => {
    // A row that takes the five tabs off screen and offers no way back is a
    // trap. Every `replace` row must carry a door to its stack's root.
    for (const [, spec] of entries()) {
      if (spec.mode !== 'replace') continue;
      const root = TAB_STACK_ROOT_ROUTE[spec.stack as keyof typeof TAB_STACK_ROOT_ROUTE];
      const exits = spec.items.filter(
        item => item.target.kind === 'route' && item.target.route === root,
      );
      expect(exits).toHaveLength(1);
      // First, as StudyFetch puts `Home` first: the way out is where a thumb
      // already looks for it.
      expect(spec.items[0]).toBe(exits[0]);
    }
  });
});

describe('every key is a route the chrome can actually observe', () => {
  /**
   * The build-166 defect this describes exists for.
   *
   * The Shop row was keyed on `ShopBrowse`, `Cart` and `ShopAccount` — all
   * three real CampusStack screens, so every scan above passed — and it never
   * appeared, because the Shop a student reaches from the tab bar is not a
   * screen at all: `CampusScreen` renders `MarketplaceScreen` inline as its
   * `shop` SEGMENT, so the route name the chrome publishes there is `Campus`.
   * A registry key is only worth anything if the chrome can see it.
   */
  const CAMPUS_SCREEN = path.resolve(__dirname, '../screens/campus/CampusScreen.tsx');

  /** Every route name any tab stack registers — what CustomTabBar can report. */
  function observableRoutes(): string[] {
    return Object.values(STACK_COMPONENT).flatMap(navigator => screensOf(navigator));
  }

  it('finds screens on all five stacks (self-check)', () => {
    expect(observableRoutes().length).toBeGreaterThan(40);
  });

  it('keys every row on a route name some stack registers', () => {
    const observable = new Set(observableRoutes());
    const offenders = entries()
      .map(([key]) => routeOf(key))
      .filter(route => !observable.has(route));
    expect(offenders.join('\n')).toBe('');
  });

  it('carries the Shop row on the SEGMENT the student lands on, not only the department list', () => {
    expect(specForRoute('Campus', { segment: 'shop' })).toBe(shopBar());
    expect(activeItem('Campus', { segment: 'shop' })?.id).toBe('browse');
    expect(accentForRoute('Campus', { segment: 'shop' })).toBe('campus');
  });

  it('leaves Campus\'s other two segments with no row at all', () => {
    expect(specForRoute('Campus', { segment: 'communities' })).toBeNull();
    expect(specForRoute('Campus', { segment: 'jobs' })).toBeNull();
    // No params at all — the first frame, before the screen has published one.
    expect(specForRoute('Campus')).toBeNull();
    expect(specForRoute('Campus', {})).toBeNull();
    expect(activeItem('Campus', { segment: 'communities' })).toBeNull();
  });

  it('reads Shop as a segment of Campus in the screen itself (source scan)', () => {
    // If Shop is ever promoted to its own route, this fails and the segment
    // entry becomes dead data that reads like a decision.
    const source = fs.readFileSync(CAMPUS_SCREEN, 'utf8');
    expect(source).toMatch(/active === 'shop'/);
    // Rendered directly since V1 (2026-09-15): it used to be `<GatedShop`, the
    // private-pilot HOC that is now deleted.
    expect(source).toMatch(/<MarketplaceScreen/);
  });

  it('publishes the visible segment where the chrome can read it (source scan)', () => {
    // The other half of the fix: a segment held only in `useState` is
    // invisible to CustomTabBar, so the row would never resolve however the
    // registry were keyed.
    const source = fs.readFileSync(CAMPUS_SCREEN, 'utf8');
    expect(source).toMatch(/setParams\?\.\(\{ segment: active \}\)/);
  });

  it('presses Browse out to the department list from the segment', () => {
    // Browse is ACTIVE on the segment but is not that route, so it navigates
    // rather than scrolling — the same rule Tests follows from the builder. It
    // must never target `Campus`: that is the stack root, the global bar's.
    expect(
      planContextualPress({ focusedRoute: 'Campus', item: itemById(shopBar(), 'browse') }),
    ).toEqual({ kind: 'navigate', route: 'ShopBrowse' });
    expect(
      planContextualPress({ focusedRoute: 'Campus', item: itemById(shopBar(), 'cart') }),
    ).toEqual({ kind: 'navigate', route: 'Cart' });
  });
});

describe('which routes carry a row', () => {
  it('carries the set row on the room and its studios', () => {
    for (const route of [
      'CourseRoom',
      'NotesStudio',
      'LectureStudio',
      'LessonStudio',
      'RecapStudio',
      'EssayStudio',
      'PlayStudio',
      'AdaptiveQuiz',
      'StudySetLibrary',
      'StudySetUpload',
    ]) {
      expect(specForRoute(route, SET)).not.toBeNull();
      expect(specForRoute(route, SET)!.stack).toBe('StudyTab');
      expect(specForRoute(route, SET)!.mode).toBe('replace');
    }
  });

  it('gives every set surface the SAME row, so it never twitches', () => {
    const rows = ['CourseRoom', 'NotesStudio', 'LectureStudio', 'StudySetLibrary'].map(route =>
      specForRoute(route, SET),
    );
    for (const row of rows) expect(row).toBe(rows[0]);
  });

  it('leaves the hub and the app-wide lists with the global bar alone', () => {
    // SF2 §6 #3: the old row stacked five doors on top of the five tabs here,
    // and every one of them opened a screen the student was already looking at
    // or could reach from the tab bar. Outside a set there is no row at all.
    for (const route of [
      'StudyHub',
      'Library',
      'NotesList',
      'FlashcardsList',
      'TestsList',
      'TestBuilder',
      'StudyCalendar',
    ]) {
      expect(specForRoute(route)).toBeNull();
      // …and not merely for want of params: these screens are not inside a set.
      expect(specForRoute(route, SET)).toBeNull();
    }
  });

  it('stands the row down when the route names no set', () => {
    // A `replace` row with nothing to be about would take the five tabs away
    // in exchange for doors that cannot say where they lead.
    expect(specForRoute('CourseRoom')).toBeNull();
    expect(specForRoute('CourseRoom', {})).toBeNull();
    expect(specForRoute('CourseRoom', { studySetId: '  ' })).toBeNull();
    expect(specForRoute('CourseRoom', { courseId: 'course-9' })).not.toBeNull();
  });

  it('has no row on the Home, Me, Chat or Campus roots', () => {
    for (const root of ['Dashboard', 'Me', 'GroupsList', 'Campus']) {
      expect(specForRoute(root)).toBeNull();
    }
  });

  it('has no row on any immersive route', () => {
    // Both bars unmount for a session; the screen's own header back is the one
    // tap out. Reading the list rather than repeating it means a route added to
    // IMMERSIVE_ROUTE_NAMES later is covered without touching this test.
    for (const route of IMMERSIVE_ROUTE_NAMES) {
      expect(specForRoute(route)).toBeNull();
    }
    // The trap this guards: a study SESSION launched from a Study screen.
    expect(specForRoute('TestTaking')).toBeNull();
    expect(specForRoute('FlashcardReview')).toBeNull();
    expect(specForRoute('CramSession')).toBeNull();
    expect(specForRoute('MatchStudy')).toBeNull();
    expect(specForRoute('LearnStudy')).toBeNull();
  });

  it('subtracts immersive routes even if one is registered by mistake', () => {
    // The registry is data; `shouldHideTabBar` is the rule. Prove the rule wins
    // rather than trusting today's registry to stay clean.
    const registry = CONTEXTUAL_BARS as Record<string, ContextualBarSpec>;
    registry.TestTaking = setBar();
    try {
      expect(specForRoute('TestTaking', SET)).toBeNull();
    } finally {
      delete registry.TestTaking;
    }
  });

  it('has no row for an unknown route or none at all', () => {
    expect(specForRoute('NotAScreen')).toBeNull();
    expect(specForRoute(undefined)).toBeNull();
  });
});

describe('the set row itself', () => {
  it('is Home · Materials · Flashcards · Tests · Record · Ask, in that order', () => {
    expect(setBar().items.map(item => item.id)).toEqual([
      'home',
      'materials',
      'flashcards',
      'tests',
      'record',
      'ai',
    ]);
    expect(setBar().items.map(item => item.label)).toEqual([
      'Home',
      'Materials',
      'Flashcards',
      'Tests',
      'Record',
      'Ask',
    ]);
  });

  it('labels every door — the thing StudyFetch does not do', () => {
    for (const item of setBar().items) expect(item.label.trim().length).toBeGreaterThan(0);
  });

  it('acts INSIDE the set, never on the app-wide lists (SF2 §6 #2)', () => {
    // The old row's Library/Flashcards/Tests opened `Library`, `FlashcardsList`
    // and `TestsList` — the pile of everything the student owns — which is an
    // EXIT from the set dressed as a sub-navigation.
    const routes = setBar()
      .items.map(item => item.target)
      .filter(target => target.kind === 'route')
      .map(target => (target as { route: string }).route);
    for (const global of ['Library', 'FlashcardsList', 'TestsList', 'NotesList']) {
      expect(routes).not.toContain(global);
    }
  });

  it('carries the set id into every door that opens a screen', () => {
    for (const item of setBar().items) {
      if (item.target.kind !== 'route' || item.id === 'home') continue;
      expect(item.target.paramsFrom).toContain('studySetId');
    }
    // …and into the two doors that are not screens.
    expect(itemById(setBar(), 'record').target).toMatchObject({
      paramsFrom: expect.arrayContaining(['studySetId']),
    });
    expect(itemById(setBar(), 'ai').target).toMatchObject({
      scopeIdFrom: expect.arrayContaining(['studySetId']),
    });
  });

  it('gives every item an icon, a label and a feature accent', () => {
    for (const [, spec] of entries()) {
      for (const item of spec.items) {
        expect(item.icon).toMatch(/^[a-z0-9-]+$/);
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.feature.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses each item id once per row', () => {
    for (const [, spec] of entries()) {
      const ids = spec.items.map(item => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the two non-screen doors as doors, not routes', () => {
    expect(itemById(setBar(), 'record').target.kind).toBe('record');
    expect(itemById(setBar(), 'ai').target.kind).toBe('ai');
  });
});

describe('the walk-through row', () => {
  it('is Plan · Ask · Quiz · Done', () => {
    expect(walkthroughBar().items.map(item => item.id)).toEqual(['plan', 'ask', 'quiz', 'done']);
    expect(walkthroughBar().items.map(item => item.label)).toEqual(['Plan', 'Ask', 'Quiz', 'Done']);
  });

  it('paints teal with nothing active — you stand on the document, not on a door', () => {
    expect(activeItem('Walkthrough')).toBeNull();
    expect(accentForRoute('Walkthrough')).toBe('notes');
  });

  it('hands all four back to the screen: none of them is a place', () => {
    const actions = walkthroughBar().items.map(item =>
      planContextualPress({ focusedRoute: 'Walkthrough', item }),
    );
    expect(actions).toEqual([
      { kind: 'screenAction', action: 'walkthroughPlan' },
      { kind: 'screenAction', action: 'walkthroughAsk' },
      { kind: 'screenAction', action: 'walkthroughQuiz' },
      { kind: 'screenAction', action: 'walkthroughDone' },
    ]);
  });

  it('is a reading screen, so it keeps its row rather than going immersive', () => {
    // A session subtracts its own row (`shouldHideTabBar`); the walk-through
    // is somewhere a student reads, and the way out is the global bar.
    expect(specForRoute('Walkthrough')).not.toBeNull();
  });

  it('is a different row from the note editor’s', () => {
    expect(specForRoute('Walkthrough')).not.toBe(specForRoute('NoteEditor'));
  });
});

describe('the active item', () => {
  it('is the item that points at the current route AND segment', () => {
    // Two doors of the set row point at the SAME screen and differ only by a
    // fixed param (the set library's `kind`). Matching on the route name alone
    // lit whichever was declared first on both of them.
    expect(activeItem('CourseRoom', { ...SET, segment: 'materials' })?.id).toBe('materials');
    expect(activeItem('StudySetLibrary', { ...SET, kind: 'cards' })?.id).toBe('flashcards');
    expect(activeItem('StudySetLibrary', { ...SET, kind: 'tests' })?.id).toBe('tests');
  });

  it('paints the row in that item’s feature accent', () => {
    expect(accentForRoute('CourseRoom', { ...SET, segment: 'materials' })).toBe('notes');
    expect(accentForRoute('StudySetLibrary', { ...SET, kind: 'cards' })).toBe('flashcards');
    expect(accentForRoute('StudySetLibrary', { ...SET, kind: 'tests' })).toBe('tests');
  });

  it('is nothing on a set screen no door points at', () => {
    // The room's OVERVIEW is not the Materials door, and a studio is not any
    // door: neither may borrow another item's highlight.
    expect(activeItem('CourseRoom', SET)).toBeNull();
    expect(accentForRoute('CourseRoom', SET)).toBeNull();
    expect(activeItem('NotesStudio', SET)).toBeNull();
    expect(activeItem('LectureStudio', SET)).toBeNull();
  });

  it('is what the ROW paints, not a target comparison the component repeats', () => {
    // A source scan, because mobile jest cannot render the strip. The
    // component had its own rule — `item.target.route === focusedRoute` —
    // which knows nothing of `activeFor`, so Tests went grey the moment the
    // builder opened however carefully the registry said otherwise.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/layout/ContextualBar.tsx'),
      'utf8',
    );
    expect(source).toMatch(/activeItem\(/);
    expect(source).not.toMatch(/active=\{item\.target/);
  });

  it('is nothing where there is no row', () => {
    expect(activeItem('TestTaking')).toBeNull();
    expect(activeItem('Dashboard')).toBeNull();
    expect(accentForRoute(undefined)).toBeNull();
  });
});

describe('planContextualPress', () => {
  it('opens the set\u2019s own materials, decks and tests', () => {
    // The exact params the room and the set library are opened with. A change
    // here is a change to a contract shared with those screens.
    expect(
      planContextualPress({
        focusedRoute: 'LectureStudio',
        focusedParams: SET,
        item: itemById(setBar(), 'materials'),
      }),
    ).toEqual({
      kind: 'navigate',
      route: 'CourseRoom',
      params: { segment: 'materials', studySetId: 'set-1', courseLabel: 'Pharmacology' },
    });
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: SET,
        item: itemById(setBar(), 'flashcards'),
      }),
    ).toEqual({
      kind: 'navigate',
      route: 'StudySetLibrary',
      params: { kind: 'cards', studySetId: 'set-1', courseLabel: 'Pharmacology' },
    });
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: SET,
        item: itemById(setBar(), 'tests'),
      }),
    ).toEqual({
      kind: 'navigate',
      route: 'StudySetLibrary',
      params: { kind: 'tests', studySetId: 'set-1', courseLabel: 'Pharmacology' },
    });
  });

  it('takes Home back to the hub, where the global tabs are', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: SET,
        item: itemById(setBar(), 'home'),
      }),
    ).toEqual({ kind: 'navigate', route: 'StudyHub' });
  });

  it('scrolls to top when the door IS the screen AND the segment (a re-tap)', () => {
    expect(
      planContextualPress({
        focusedRoute: 'StudySetLibrary',
        focusedParams: { ...SET, kind: 'cards' },
        item: itemById(setBar(), 'flashcards'),
      }),
    ).toEqual({ kind: 'scrollToTop' });
  });

  it('navigates rather than scrolling when only the ROUTE matches', () => {
    // Materials pressed from the room's overview is a move to another segment
    // of the same screen, not a re-tap of it. Comparing route names alone made
    // this door dead on the surface it is most likely to be pressed from.
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: SET,
        item: itemById(setBar(), 'materials'),
      }).kind,
    ).toBe('navigate');
    expect(
      planContextualPress({
        focusedRoute: 'StudySetLibrary',
        focusedParams: { ...SET, kind: 'cards' },
        item: itemById(setBar(), 'tests'),
      }).kind,
    ).toBe('navigate');
  });

  it('never resets the stack on a re-tap — that is the global bar’s job', () => {
    // Invariant 2: a contextual re-tap must not duplicate `tabPress`, which
    // also pops to root.
    const plan = planContextualPress({
      focusedRoute: 'StudySetLibrary',
      focusedParams: { ...SET, kind: 'tests' },
      item: itemById(setBar(), 'tests'),
    });
    expect(plan.kind).toBe('scrollToTop');
    expect(plan).not.toHaveProperty('route');
  });

  it('does nothing rather than opening a set library on no set', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: { courseId: 'course-9' },
        item: itemById(setBar(), 'flashcards'),
      }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('records INTO the set the row is standing in', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: { ...SET, courseId: 'course-9' },
        item: itemById(setBar(), 'record'),
      }),
    ).toEqual({ kind: 'record', params: { studySetId: 'set-1', courseId: 'course-9' } });
  });

  it('asks about the SET, not about the last note (SF2 §6 #14)', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        focusedParams: { ...SET, noteId: 'note-7' },
        item: itemById(setBar(), 'ai'),
      }),
    ).toEqual({ kind: 'openAi', scopeId: 'set-1', scopeLabel: 'Pharmacology' });
  });

  it('opens a plain AI panel when the door knows no room', () => {
    // The note row's Ask, which has no scope keys at all: unchanged.
    expect(
      planContextualPress({ focusedRoute: 'NoteEditor', item: itemById(noteBar(), 'ai') }),
    ).toEqual({ kind: 'openAi' });
  });

  it('still navigates when the focused route is unknown', () => {
    // A press that arrives a frame before focus settles must do the obvious
    // thing rather than silently scrolling something to the top.
    expect(
      planContextualPress({ focusedRoute: undefined, item: itemById(setBar(), 'home') }),
    ).toEqual({ kind: 'navigate', route: 'StudyHub' });
  });

  it('carries params when a target declares them', () => {
    const item: ContextualBarItem = {
      id: 'notes',
      label: 'Notes',
      icon: 'document-text',
      feature: 'notes',
      target: { kind: 'route', route: 'Library', params: { tab: 'notes' } },
    };
    expect(planContextualPress({ focusedRoute: 'TestsList', item })).toEqual({
      kind: 'navigate',
      route: 'Library',
      params: { tab: 'notes' },
    });
  });

  it('omits params entirely when a target has none', () => {
    // `{ params: undefined }` is not the same object as `{}` to React
    // Navigation's param merge; the plan must not invent one.
    const plan = planContextualPress({
      focusedRoute: 'CourseRoom',
      focusedParams: SET,
      item: itemById(setBar(), 'home'),
    });
    expect(Object.prototype.hasOwnProperty.call(plan, 'params')).toBe(false);
  });
});

describe('activeFor points only at routes that have the row', () => {
  it('keys every activeFor route on the SAME spec object', () => {
    // `activeFor` says "this item is the highlighted one on that screen too".
    // If that screen is not in the registry it carries no row at all, so the
    // highlight can never be drawn: the entry reads like a decision and is
    // dead data. TestBuilder and the two Shop browse rooms are keys precisely
    // so their rows exist to highlight. A SEGMENTED key counts the same way —
    // Browse is active on `Campus` because Campus's shop segment carries this
    // very row — so both registries are consulted.
    const registry = CONTEXTUAL_BARS as Record<string, ContextualBarSpec>;
    const carries = (route: string, spec: ContextualBarSpec): boolean => {
      if (registry[route] === spec) return true;
      const segmented = CONTEXTUAL_BAR_SEGMENTS[route as keyof typeof CONTEXTUAL_BAR_SEGMENTS];
      return Object.values(segmented?.values ?? {}).includes(spec);
    };
    const offenders: string[] = [];
    for (const [route, spec] of entries()) {
      for (const item of spec.items) {
        for (const extra of item.activeFor ?? []) {
          if (!carries(extra, spec)) offenders.push(`${route} → ${item.id} → activeFor ${extra}`);
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });
});

describe('the deck row', () => {
  it('is Review · Learn · Match · Cram, the four modes', () => {
    expect(deckBar().items.map(item => item.id)).toEqual(['review', 'learn', 'match', 'cram']);
    expect(deckBar().items.map(item => item.label)).toEqual(['Review', 'Learn', 'Match', 'Cram']);
  });

  it('sends each mode to that mode’s own Study-stack route', () => {
    const routes = deckBar().items.map(item => (item.target as { route: string }).route);
    expect(routes).toEqual(['FlashcardReview', 'LearnStudy', 'MatchStudy', 'CramSession']);
    // The same-stack lint above proves these exist on StudyStack; this proves
    // the four are not accidentally the same one.
    expect(new Set(routes).size).toBe(4);
  });

  it('paints lime (§7.2) even though nothing in it is ever the current screen', () => {
    // The four targets are immersive, so no press can ever leave you standing
    // on one of them with the row still up. Without the declared accent the
    // deck row would be permanently neutral.
    expect(activeItem('DeckDetail')).toBeNull();
    expect(accentForRoute('DeckDetail')).toBe('flashcards');
  });

  it('carries the deck through to the mode it opens', () => {
    for (const item of deckBar().items) {
      expect(
        planContextualPress({ focusedRoute: 'DeckDetail', item, focusedParams: DECK }),
      ).toEqual({
        kind: 'navigate',
        route: (item.target as { route: string }).route,
        params: { deckId: 'deck-1', deckName: 'Pharmacology' },
      });
    }
  });

  it('carries the id alone when the deck has no name yet', () => {
    // `deckName` is optional in StudyStackParamList; a key the focused route
    // does not have must be LEFT OUT, not written as `undefined` — React
    // Navigation merges params, and an explicit undefined erases one.
    const plan = planContextualPress({
      focusedRoute: 'DeckDetail',
      item: itemById(deckBar(), 'match'),
      focusedParams: { deckId: 'deck-1' },
    });
    expect(plan).toEqual({ kind: 'navigate', route: 'MatchStudy', params: { deckId: 'deck-1' } });
    expect(
      Object.prototype.hasOwnProperty.call((plan as { params: object }).params, 'deckName'),
    ).toBe(false);
  });

  it('does NOTHING rather than open a session on no deck', () => {
    // The trap this exists for: a caller that has not been taught to pass the
    // focused route's params. A navigate would push an immersive session over
    // an empty deck, which is worse than a dead press.
    for (const item of deckBar().items) {
      expect(planContextualPress({ focusedRoute: 'DeckDetail', item })).toEqual({
        kind: 'unavailable',
      });
      expect(
        planContextualPress({ focusedRoute: 'DeckDetail', item, focusedParams: { deckName: 'x' } }),
      ).toEqual({ kind: 'unavailable' });
    }
  });

  it('never re-taps: no mode is the screen the row is on', () => {
    // Re-tap means "the item IS the current route". On the deck screen no item
    // is, so every press must be a real navigate — a `scrollToTop` here would
    // be a mode button that silently does nothing.
    for (const item of deckBar().items) {
      expect(
        planContextualPress({ focusedRoute: 'DeckDetail', item, focusedParams: DECK }).kind,
      ).toBe('navigate');
    }
  });

  it('is gone inside every mode it opens', () => {
    // §7.2: a session owns the window. The row that launched it must not
    // survive into it, and there is nothing to highlight when it is gone.
    for (const route of ['FlashcardReview', 'LearnStudy', 'MatchStudy', 'CramSession']) {
      expect(specForRoute(route)).toBeNull();
      expect(activeItem(route)).toBeNull();
      expect(accentForRoute(route)).toBeNull();
    }
  });
});

describe('the note row', () => {
  it('is Learn · Cards · Test · AI', () => {
    expect(noteBar().items.map(item => item.id)).toEqual(['learn', 'cards', 'test', 'ai']);
    expect(noteBar().items.map(item => item.label)).toEqual(['Learn', 'Cards', 'Test', 'Ask']);
  });

  it('paints teal (§7.2) with nothing active', () => {
    expect(activeItem('NoteEditor')).toBeNull();
    expect(accentForRoute('NoteEditor')).toBe('notes');
  });

  it('leaves NotesList on the STUDY row — the list is a Study surface', () => {
    // The editor is a note; the list of notes is one of Study's five places.
    expect(specForRoute('NotesList')).toBe(specForRoute('StudyHub'));
    expect(specForRoute('NoteEditor')).not.toBe(specForRoute('NotesList'));
  });

  it('hands Learn and Cards back to the screen to run', () => {
    // Neither is a route and neither is a global store: both spend credits and
    // raise a toast inside the editor's own state.
    expect(
      planContextualPress({ focusedRoute: 'NoteEditor', item: itemById(noteBar(), 'learn') }),
    ).toEqual({ kind: 'screenAction', action: 'noteLearn' });
    expect(
      planContextualPress({ focusedRoute: 'NoteEditor', item: itemById(noteBar(), 'cards') }),
    ).toEqual({ kind: 'screenAction', action: 'noteFlashcards' });
  });

  it('plans a screen action without needing the focused route at all', () => {
    // A screen action is not a navigate: it must not become `scrollToTop`, and
    // it must not wait on focus having settled.
    for (const route of [undefined, 'NoteEditor', 'NotAScreen']) {
      expect(
        planContextualPress({ focusedRoute: route, item: itemById(noteBar(), 'cards') }).kind,
      ).toBe('screenAction');
    }
  });

  it('opens the test builder with THIS note preselected', () => {
    expect(
      planContextualPress({
        focusedRoute: 'NoteEditor',
        item: itemById(noteBar(), 'test'),
        focusedParams: { noteId: 'note-9', startRecording: true },
      }),
    ).toEqual({ kind: 'navigate', route: 'TestBuilder', params: { noteId: 'note-9' } });
  });

  it('does not open an empty builder when the note id is missing', () => {
    expect(
      planContextualPress({ focusedRoute: 'NoteEditor', item: itemById(noteBar(), 'test') }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('still opens the AI panel, the same door the Study row uses', () => {
    expect(
      planContextualPress({ focusedRoute: 'NoteEditor', item: itemById(noteBar(), 'ai') }),
    ).toEqual({ kind: 'openAi' });
  });
});

describe('the Shop row', () => {
  it('is Browse · Cart · You on the CAMPUS stack, not a retired MarketTab', () => {
    // Spec §7.2 writes "MarketTab / Shop screens"; MarketTab is a redirect
    // shim (legacyTabs.ts) and Shop's screens live on CampusStack. A row
    // registered against the wrong stack never appears.
    expect(shopBar().stack).toBe('CampusTab');
    expect(shopBar().items.map(item => item.id)).toEqual(['browse', 'cart', 'you']);
    expect(shopBar().items.map(item => item.label)).toEqual(['Browse', 'Cart', 'You']);
  });

  it('carries the same row across every shop surface it owns', () => {
    for (const route of [
      'ShopBrowse',
      'CourseBrowse',
      'CourseListings',
      'Cart',
      'ShopAccount',
    ]) {
      expect(specForRoute(route)).toBe(shopBar());
    }
  });

  it('does not key the redirect that is not a screen', () => {
    // `MarketplaceHome` forwards to the Campus shop segment in one frame; a
    // row there would appear and animate straight back out.
    expect(specForRoute('MarketplaceHome')).toBeNull();
  });

  it('highlights the surface you are on, browse rooms included', () => {
    expect(activeItem('ShopBrowse')?.id).toBe('browse');
    expect(activeItem('CourseBrowse')?.id).toBe('browse');
    expect(activeItem('CourseListings')?.id).toBe('browse');
    expect(activeItem('Cart')?.id).toBe('cart');
    expect(activeItem('ShopAccount')?.id).toBe('you');
    for (const route of ['ShopBrowse', 'Cart', 'ShopAccount']) {
      expect(accentForRoute(route)).toBe('campus');
    }
  });

  it('re-taps the surface you are already on, and navigates otherwise', () => {
    expect(
      planContextualPress({ focusedRoute: 'Cart', item: itemById(shopBar(), 'cart') }),
    ).toEqual({ kind: 'scrollToTop' });
    expect(
      planContextualPress({ focusedRoute: 'Cart', item: itemById(shopBar(), 'browse') }),
    ).toEqual({ kind: 'navigate', route: 'ShopBrowse' });
    // Browse is ACTIVE in a department page but is not that route: pressing it
    // must walk out to the department list, exactly as Tests does from the
    // test builder.
    expect(
      planContextualPress({ focusedRoute: 'CourseListings', item: itemById(shopBar(), 'browse') }),
    ).toEqual({ kind: 'navigate', route: 'ShopBrowse' });
  });

  it('carries no params it was not given', () => {
    const plan = planContextualPress({
      focusedRoute: 'ShopAccount',
      item: itemById(shopBar(), 'cart'),
      focusedParams: { role: 'buyer' },
    });
    // No `paramsFrom` means no pass-through: a stray param from whatever
    // screen you happened to be on must not leak into the target.
    expect(plan).toEqual({ kind: 'navigate', route: 'Cart' });
  });

  it('is gone on a listing, which is immersive', () => {
    expect(specForRoute('ListingDetail')).toBeNull();
  });
});

describe('params pass-through, in general', () => {
  it('lets a focused param override a fixed one of the same name', () => {
    const item: ContextualBarItem = {
      id: 'x',
      label: 'X',
      icon: 'layers',
      feature: 'flashcards',
      target: {
        kind: 'route',
        route: 'MatchStudy',
        params: { deckId: 'fallback' },
        paramsFrom: ['deckId'],
      },
    };
    expect(
      planContextualPress({ focusedRoute: 'DeckDetail', item, focusedParams: { deckId: 'real' } }),
    ).toEqual({ kind: 'navigate', route: 'MatchStudy', params: { deckId: 'real' } });
  });

  it('keeps a fixed param when the focused route has nothing to say', () => {
    const item: ContextualBarItem = {
      id: 'x',
      label: 'X',
      icon: 'layers',
      feature: 'flashcards',
      target: { kind: 'route', route: 'Library', params: { tab: 'notes' }, paramsFrom: ['deckId'] },
    };
    expect(planContextualPress({ focusedRoute: 'DeckDetail', item })).toEqual({
      kind: 'navigate',
      route: 'Library',
      params: { tab: 'notes' },
    });
  });

  it('omits params when pass-through resolves to nothing', () => {
    const item: ContextualBarItem = {
      id: 'x',
      label: 'X',
      icon: 'layers',
      feature: 'flashcards',
      target: { kind: 'route', route: 'Library', paramsFrom: ['tab'] },
    };
    const plan = planContextualPress({ focusedRoute: 'DeckDetail', item, focusedParams: {} });
    expect(Object.prototype.hasOwnProperty.call(plan, 'params')).toBe(false);
  });

  it('ignores focused params entirely for a target with no paramsFrom', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        item: itemById(setBar(), 'home'),
        focusedParams: { ...SET, deckId: 'deck-1' },
      }),
    ).toEqual({ kind: 'navigate', route: 'StudyHub' });
  });

  it('never lets `requires` name a key `paramsFrom` does not carry', () => {
    // A required key that is never copied would make the item permanently
    // unavailable in one direction, or navigate without it in the other.
    const offenders: string[] = [];
    for (const [route, spec] of entries()) {
      for (const item of spec.items) {
        if (item.target.kind !== 'route') continue;
        const { paramsFrom, requires } = item.target;
        for (const key of requires ?? []) {
          if (!paramsFrom?.includes(key)) offenders.push(`${route} → ${item.id} requires ${key}`);
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });
});

describe('where every row sits, and which one may take the global bar away', () => {
  // Build 185's device pass reverted the SECTIONWIDE `replace` mode of
  // 2026-09-08: inside Study and Shop the five labelled tabs were simply gone,
  // including on the hub and on every app-wide list, where the student is not
  // inside anything. The mode is back for exactly one row and under three locks
  // — it is about ONE thing the student is in, it carries its own way out, and
  // it stands down when that thing is unknown. These assertions are the locks.
  it('lets only the set row replace the bar; every other row sits above it', () => {
    for (const [route, spec] of entries()) {
      if (spec.mode === undefined || spec.mode === 'above') continue;
      expect(spec.mode).toBe('replace');
      // Keyed only on set surfaces, never on a hub, a list or a section root.
      expect(spec).toBe(setBar());
      expect(routeOf(route)).not.toBe('StudyHub');
    }
  });

  it('keeps the Shop row and every pass-through row above the bar', () => {
    for (const bar of [shopBar(), deckBar(), noteBar(), walkthroughBar(), barFor('CommunityDetail')]) {
      expect(bar.mode ?? 'above').toBe('above');
    }
  });

  it('never lets a replace row exist without a set to be about', () => {
    for (const [, spec] of entries()) {
      if (spec.mode !== 'replace') continue;
      expect(spec.requiresAnyParam?.length).toBeGreaterThan(0);
    }
  });

  it('reports the mode the chrome reads, and `above` where there is no row', () => {
    expect(contextualBarMode('CourseRoom', SET)).toBe('replace');
    expect(contextualBarMode('CourseRoom')).toBe('above');
    expect(contextualBarMode('StudyHub')).toBe('above');
    expect(contextualBarMode('ShopBrowse')).toBe('above');
    expect(contextualBarMode(undefined)).toBe('above');
  });

  it('keeps no exit-control escape hatch in the registry source', () => {
    // A source scan because the thing being asserted is an ABSENCE. The set
    // row's way out is an ITEM (`Home`), drawn and labelled like every other
    // door — not a chrome affordance bolted beside the row, which is what the
    // 2026-09-08 mode needed and what made it a second, unnamed control.
    const src = fs.readFileSync(path.join(__dirname, 'contextualBars.ts'), 'utf8');
    expect(src).not.toMatch(/export function replacesGlobalBar/);
    expect(src).not.toMatch(/export function contextualExitControl/);
  });

  it('still resolves a spec for every section and pass-through screen', () => {
    for (const bar of [
      setBar(),
      shopBar(),
      deckBar(),
      noteBar(),
      walkthroughBar(),
      barFor('CommunityDetail'),
      specForRoute('Campus', { segment: 'shop' }),
    ]) {
      expect(bar?.items.length).toBeGreaterThan(0);
    }
  });
});

// Build 175 gave every registry a `name` and drew it as a leading section title
// on the no-selection rows; build 176's device pass removed both — a
// no-selection row now labels every door instead (contextualBarPresentation.ts).
// The registry no longer carries a `name`, so there is nothing to assert here.

describe('the community row', () => {
  const communityBar = (): ContextualBarSpec => barFor('CommunityDetail');

  it('offers the four doors of a community, in order', () => {
    expect(communityBar().items.map(item => item.id)).toEqual([
      'chat',
      'boards',
      'rooms',
      'members',
    ]);
  });

  it('labels its live chat "Lounge", not "Chat", so it cannot be the global Chat tab', () => {
    // The community row is `above` mode, so the global bar — whose second tab is
    // the app-wide "Chat" — sits directly below it. With the row's labels
    // restored (build 175), a door still labelled "Chat" reads as a second,
    // broken copy of that tab. The door opens the community's own lounge
    // (`communityChat` → openLounge → the `General` channel), which is what
    // "Lounge" names. This FAILS the moment the label goes back to "Chat".
    const chat = itemById(communityBar(), 'chat');
    expect(chat.label).toBe('Lounge');
    expect(chat.label).not.toBe('Chat');
    expect(chat.target).toEqual({ kind: 'screenAction', action: 'communityChat' });
    // And no door on this row may collide with the global "Chat" tab's word.
    expect(communityBar().items.map(item => item.label)).not.toContain('Chat');
  });

  it('carries the campus accent, because the student stands on the community', () => {
    // Not on one of its four doors — same reason the deck and note rows
    // declare an accent instead of deriving one.
    expect(accentForRoute('CommunityDetail')).toBe('campus');
    expect(activeItem('CommunityDetail')).toBeNull();
  });

  it('takes Members to the roster for the community you are looking at', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CommunityDetail',
        item: itemById(communityBar(), 'members'),
        focusedParams: { slug: 'unilag-medicine' },
      })
    ).toEqual({
      kind: 'navigate',
      route: 'CommunityMembers',
      params: { slug: 'unilag-medicine' },
    });
  });

  it('does nothing rather than opening a roster for nothing', () => {
    // Before the community has loaded there is no slug to carry.
    expect(
      planContextualPress({
        focusedRoute: 'CommunityDetail',
        item: itemById(communityBar(), 'members'),
        focusedParams: {},
      })
    ).toEqual({ kind: 'unavailable' });
  });

  it('asks the screen for the three doors that are not screens', () => {
    // The lounge's group id is minted on first use, and Boards/Rooms are
    // sections of the community page — none of the three is a route.
    for (const [id, action] of [
      ['chat', 'communityChat'],
      ['boards', 'communityBoards'],
      ['rooms', 'communityRooms'],
    ] as const) {
      expect(
        planContextualPress({
          focusedRoute: 'CommunityDetail',
          item: itemById(communityBar(), id),
        })
      ).toEqual({ kind: 'screenAction', action });
    }
  });

  it('hides the row inside a channel chat and on the rooms the row leads to', () => {
    // Inside a chat the row would sit between the composer and the keyboard;
    // the roster, a post and a board carry their own back arrow and do not
    // register the screen actions, so a row there would be dead buttons.
    for (const route of ['CommunityChannel', 'CommunityMembers', 'CommunityPost', 'SavedPosts']) {
      expect(specForRoute(route)).toBeNull();
    }
  });

  it('registers the community screen actions in the screen itself (source scan)', () => {
    // The registry names an action; only the screen can run it. A row item
    // whose handler nobody registers is a button that does nothing.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../screens/discover/CommunityDetailScreen.tsx'),
      'utf8'
    );
    expect(source).toContain("useScreenActions('CommunityDetail'");
    for (const action of ['communityChat', 'communityBoards', 'communityRooms']) {
      expect(source).toContain(action);
    }
  });
});

// The companion door was read five ways on one device pass: "Ask", "Ask
// Lantern", "AI" on this row, "Lantern AI" on the panel header, and the room's
// tutor row taken for the same thing. One door, one name — **Ask Lantern**,
// shortened to "Ask" where a row of five leaves no room for two words. The
// bare "AI" names nothing a student can point at, so it is gone for good.
describe('the companion door wears one name', () => {
  it('labels every AI row item "Ask", never "AI"', () => {
    for (const bar of Object.values(CONTEXTUAL_BARS)) {
      for (const item of bar.items) {
        if (item.id !== 'ai') continue;
        expect(item.label).toBe('Ask');
      }
    }
  });

  it('keeps the product name "Lantern AI" off every row', () => {
    for (const bar of Object.values(CONTEXTUAL_BARS)) {
      for (const item of bar.items) {
        expect(item.label).not.toBe('AI');
        expect(item.label).not.toBe('Lantern AI');
      }
    }
  });
});
