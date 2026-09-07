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
  accentForRoute,
  activeItem,
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

function entries(): [string, ContextualBarSpec][] {
  return Object.entries(CONTEXTUAL_BARS) as [string, ContextualBarSpec][];
}

function itemById(spec: ContextualBarSpec, id: string): ContextualBarItem {
  const item = spec.items.find(candidate => candidate.id === id);
  if (!item) throw new Error(`no contextual item '${id}'`);
  return item;
}

const studyBar = (): ContextualBarSpec => {
  const spec = specForRoute('StudyHub');
  if (!spec) throw new Error('the Study row is missing');
  return spec;
};

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
      expect(screensOf(STACK_COMPONENT[spec.stack])).toContain(route);
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

  it('never targets the stack root, which a row must not stack under itself', () => {
    // Invariant 1: the root is reached by the GLOBAL bar's re-tap, never by a
    // contextual item — `planTabRootReset` owns that path.
    for (const [, spec] of entries()) {
      const root = TAB_STACK_ROOT_ROUTE[spec.stack as keyof typeof TAB_STACK_ROOT_ROUTE];
      for (const item of spec.items) {
        if (item.target.kind === 'route') expect(item.target.route).not.toBe(root);
      }
    }
  });
});

describe('which routes carry a row', () => {
  it('carries the Study row on all five Study surfaces', () => {
    for (const route of ['StudyHub', 'Library', 'NotesList', 'FlashcardsList', 'TestsList']) {
      expect(specForRoute(route)).not.toBeNull();
      expect(specForRoute(route)!.stack).toBe('StudyTab');
    }
  });

  it('gives the five Study surfaces the SAME row, so it never twitches', () => {
    const rows = ['StudyHub', 'Library', 'NotesList', 'FlashcardsList', 'TestsList'].map(route =>
      specForRoute(route),
    );
    for (const row of rows) expect(row).toBe(rows[0]);
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
    registry.TestTaking = studyBar();
    try {
      expect(specForRoute('TestTaking')).toBeNull();
    } finally {
      delete registry.TestTaking;
    }
  });

  it('has no row for an unknown route or none at all', () => {
    expect(specForRoute('NotAScreen')).toBeNull();
    expect(specForRoute(undefined)).toBeNull();
  });
});

describe('the Study row itself', () => {
  it('is Library · Flashcards · Tests · Record · AI, in that order', () => {
    expect(studyBar().items.map(item => item.id)).toEqual([
      'library',
      'flashcards',
      'tests',
      'record',
      'ai',
    ]);
    expect(studyBar().items.map(item => item.label)).toEqual([
      'Library',
      'Flashcards',
      'Tests',
      'Record',
      'AI',
    ]);
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
    expect(itemById(studyBar(), 'record').target.kind).toBe('record');
    expect(itemById(studyBar(), 'ai').target.kind).toBe('ai');
  });
});

describe('the active item', () => {
  it('is the item that points at the current route', () => {
    expect(activeItem('Library')?.id).toBe('library');
    expect(activeItem('FlashcardsList')?.id).toBe('flashcards');
    expect(activeItem('TestsList')?.id).toBe('tests');
  });

  it('paints the row in that item’s feature accent', () => {
    expect(accentForRoute('Library')).toBe('notes');
    expect(accentForRoute('FlashcardsList')).toBe('flashcards');
    expect(accentForRoute('TestsList')).toBe('tests');
  });

  it('is nothing on a Study screen no item points at', () => {
    // The hub is the row's home, not one of its doors; Notes is reached through
    // Library. Neither may borrow another item's highlight.
    expect(activeItem('StudyHub')).toBeNull();
    expect(accentForRoute('StudyHub')).toBeNull();
    expect(activeItem('NotesList')).toBeNull();
  });

  it('is nothing where there is no row', () => {
    expect(activeItem('TestTaking')).toBeNull();
    expect(activeItem('Dashboard')).toBeNull();
    expect(accentForRoute(undefined)).toBeNull();
  });
});

describe('planContextualPress', () => {
  it('navigates to another screen in the stack', () => {
    expect(
      planContextualPress({ focusedRoute: 'Library', item: itemById(studyBar(), 'tests') }),
    ).toEqual({ kind: 'navigate', route: 'TestsList' });
  });

  it('scrolls to top when the item IS the current route (a re-tap)', () => {
    expect(
      planContextualPress({ focusedRoute: 'TestsList', item: itemById(studyBar(), 'tests') }),
    ).toEqual({ kind: 'scrollToTop' });
    expect(
      planContextualPress({ focusedRoute: 'Library', item: itemById(studyBar(), 'library') }),
    ).toEqual({ kind: 'scrollToTop' });
  });

  it('never resets the stack on a re-tap — that is the global bar’s job', () => {
    // Invariant 2: a contextual re-tap must not duplicate `tabPress`, which
    // also pops to root. "I pressed Tests while on Tests" means scroll up.
    const plan = planContextualPress({
      focusedRoute: 'TestsList',
      item: itemById(studyBar(), 'tests'),
    });
    expect(plan.kind).toBe('scrollToTop');
    expect(plan).not.toHaveProperty('route');
  });

  it('opens the recorder door from anywhere in the row', () => {
    for (const route of ['StudyHub', 'Library', 'NotesList', 'TestsList']) {
      expect(
        planContextualPress({ focusedRoute: route, item: itemById(studyBar(), 'record') }),
      ).toEqual({ kind: 'record' });
    }
  });

  it('opens the AI panel from anywhere in the row', () => {
    for (const route of ['StudyHub', 'FlashcardsList', 'TestsList']) {
      expect(
        planContextualPress({ focusedRoute: route, item: itemById(studyBar(), 'ai') }),
      ).toEqual({ kind: 'openAi' });
    }
  });

  it('still navigates when the focused route is unknown', () => {
    // A press that arrives a frame before focus settles must do the obvious
    // thing rather than silently scrolling something to the top.
    expect(
      planContextualPress({ focusedRoute: undefined, item: itemById(studyBar(), 'library') }),
    ).toEqual({ kind: 'navigate', route: 'Library' });
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
      focusedRoute: 'StudyHub',
      item: itemById(studyBar(), 'library'),
    });
    expect(Object.prototype.hasOwnProperty.call(plan, 'params')).toBe(false);
  });
});
