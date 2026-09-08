import fs from 'fs';
import path from 'path';
import { canPopFocusedStack, planBottomBarComposition } from './bottomBarComposition';

const SRC_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');

describe('canPopFocusedStack — Back vs Home at a section', () => {
  it('is true when a screen sits behind the focused one', () => {
    // [StudyHub, Library] focused on Library: Back pops to StudyHub.
    expect(canPopFocusedStack({ index: 1, routes: [{}, {}] })).toBe(true);
  });

  it('is false at the section root, with nothing behind it', () => {
    // StudyHub alone: the exit is Home, never a Back that does nothing.
    expect(canPopFocusedStack({ index: 0, routes: [{}] })).toBe(false);
  });

  it('is false for a stack whose root was dropped by a nested navigate', () => {
    // planTabRootReset builds [Library] with index 0 when Study is entered from
    // elsewhere: there is genuinely nothing to pop, so Home is the honest exit.
    expect(canPopFocusedStack({ index: 0, routes: [{}] })).toBe(false);
  });

  it('is false when the tab has no nested state yet (its declared root)', () => {
    expect(canPopFocusedStack(undefined)).toBe(false);
    expect(canPopFocusedStack(null)).toBe(false);
    expect(canPopFocusedStack({})).toBe(false);
    expect(canPopFocusedStack({ routes: [] })).toBe(false);
  });

  it('falls back to the last route when index is absent', () => {
    expect(canPopFocusedStack({ routes: [{}, {}] })).toBe(true);
    expect(canPopFocusedStack({ routes: [{}] })).toBe(false);
  });
});

describe('planBottomBarComposition — the replace-mode rule', () => {
  it('hides the global five and shows the exit in replace mode', () => {
    // If this inverts, Study and Shop ship both bars at once (the thing the
    // founder decision removes) or a section with no way out.
    expect(planBottomBarComposition({ replace: true })).toEqual({
      showGlobalTabs: false,
      showExit: true,
    });
  });

  it('keeps the global five and shows no exit in every other case', () => {
    // above-mode rows (deck, note, community) and every plain route: the global
    // bar is its own way out, so there is no second exit control.
    expect(planBottomBarComposition({ replace: false })).toEqual({
      showGlobalTabs: true,
      showExit: false,
    });
  });
});

/**
 * THE WIRING, as a source scan — the same instrument as tabRetapWiring and
 * nestedNavigateLint, and for the same reason: mobile jest is node-env and
 * cannot render a `.tsx`, so a component that ignored the planner above (or
 * negated it in JSX) would invert the founder's decision app-wide with every
 * one of these tests still green. That happened once already in review.
 */
describe('the wiring the founder decision depends on', () => {
  const bar = read('components/layout/BottomTabBar.tsx');
  const nav = read('navigation/RootNavigator.tsx');
  const screen = read('components/layout/Screen.tsx');
  const row = read('components/layout/ContextualBar.tsx');

  it('composes the bottom bar from the planner, not from an inline ternary', () => {
    expect(bar).toContain('planBottomBarComposition({ replace: replaceGlobalTabs })');
    expect(bar).toContain('{composition.showGlobalTabs ? (');
    // A negation here would flip the whole decision without touching the rule.
    expect(bar).not.toContain('!composition.showGlobalTabs');
    expect(bar).not.toContain('!replaceGlobalTabs');
  });

  it('draws the exit only in replace mode, and only with a handler behind it', () => {
    expect(bar).toContain('composition.showExit && exit ? (');
    expect(bar).toMatch(/onPress=\{exit\.onPress\}/);
  });

  it('gives the row its width shares and its label step from the planner', () => {
    // `flex: 1` on every segment is what ellipsises the promoted word to
    // nothing on Study's five-item row; the share has to come from the planner,
    // where contextualPillLabelSpace measures it.
    expect(row).toContain('flex: plan.flex');
    expect(row).not.toContain('flex: 1, minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT');
    // A named step, not a raw size: the word is `text-body` (15 sp).
    expect(row).toContain('text-body');
    // And the exit stays a fixed-width square, so it cannot eat that room back.
    expect(bar).toContain('width: CONTEXTUAL_BAR_CONTENT_HEIGHT');
  });

  it('keeps exactly ONE exit control in the app', () => {
    // The row must not grow a second one: the founder decision says one leading
    // control, and the bar's outlives the row (which unmounts on the keyboard).
    expect(row).not.toContain('ExitControl');
    expect(row).not.toContain('onExit');
  });

  it('wires the mode, the exit and both branches of its navigation', () => {
    expect(nav).toContain('replacesGlobalBar(contextual)');
    expect(nav).toContain('contextualExitControl(canPopFocusedStack(childStackState))');
    expect(nav).toMatch(/replaceGlobalTabs=\{replaceGlobalTabs\}/);
    expect(nav).toMatch(/exit=\{\{ control: exitControl, onPress: onExit \}\}/);
    // Back pops the focused child stack; Home leaves for the tab that has no
    // replace registry, which is what brings the global five back.
    expect(nav).toContain('StackActions.pop(1)');
    expect(nav).toContain("navigation.navigate('HomeTab' as never)");
  });

  it('gives both clearance callers the same mode the chrome draws', () => {
    // If a screen padded for a bar that is not there (or not for the row that
    // is), the last row of a list lands under the chrome — the offline-box bug.
    for (const src of [bar, screen]) {
      expect(src).toContain('replaceMode: replacesGlobalBar(contextual)');
      expect(src).toContain('globalBarContentHeight: TAB_BAR_CONTENT_HEIGHT');
    }
  });
});
