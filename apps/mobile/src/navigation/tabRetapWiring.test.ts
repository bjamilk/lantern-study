/**
 * D5 — a re-tap on the tab you are already on must go back to its root.
 *
 * Two halves have to hold, and they live in different files, so this suite
 * checks both:
 *
 *  1. The PLAN: a press on the focused tab emits `tabPress` and — when the
 *     bottom of that stack is not the tab's own root — plans a reset onto it.
 *     A press on another tab is a plain switch that keeps the remembered
 *     screen; that is not a regression, it is what a tab bar does.
 *  2. The WIRING: BottomTabBar's button still calls `onPress`, and
 *     RootNavigator still emits the event. The bar was restyled to a duotone
 *     current icon (AppIcon `tone="active"`), and an icon that swallowed the
 *     press, or a handler that stopped emitting, would break the re-tap
 *     without breaking anything a pure test can see. mobile jest is node-env
 *     and cannot render a `.tsx`, so the wiring is asserted as a source scan —
 *     the same instrument as nestedNavigateLint.
 */
import fs from 'fs';
import path from 'path';
import { planTabPress, planTabRootReset, TAB_STACK_ROOT_ROUTE } from './tabPressBehavior';

const SRC_ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');

const routes = [
  { key: 'HomeTab-1', name: 'HomeTab' },
  { key: 'StudyTab-1', name: 'StudyTab' },
  { key: 'ChatTab-1', name: 'ChatTab' },
  { key: 'CampusTab-1', name: 'CampusTab' },
  { key: 'MeTab-1', name: 'MeTab' },
];

describe('a press on the tab that is already focused', () => {
  it('emits tabPress and resets a stack whose bottom is not the tab root', () => {
    // Study entered from Home: `[TestTaking]`, index 0, so popToTop has
    // nothing to pop and StudyHub is unreachable without this reset.
    const press = planTabPress({ routes, index: 1, routeName: 'StudyTab' });
    expect(press.alreadyFocused).toBe(true);
    expect(press.emitTarget).toBe('StudyTab-1');
    expect(press.navigateTo).toBeNull();

    const repair = planTabRootReset({
      childState: { key: 'stack-9', index: 0, routes: [{ name: 'TestTaking' }] },
      initialRouteName: TAB_STACK_ROOT_ROUTE.StudyTab,
    });
    expect(repair).toEqual({ resetTo: 'StudyHub', target: 'stack-9' });
  });

  it('emits and leaves the pop to native-stack when the stack IS rooted', () => {
    const press = planTabPress({ routes, index: 1, routeName: 'StudyTab' });
    expect(press.emitTarget).toBe('StudyTab-1');

    const repair = planTabRootReset({
      childState: {
        key: 'stack-9',
        index: 2,
        routes: [{ name: 'StudyHub' }, { name: 'Library' }, { name: 'DeckDetail' }],
      },
      initialRouteName: TAB_STACK_ROOT_ROUTE.StudyTab,
    });
    // Nothing to repair: popToTop reaches StudyHub on its own.
    expect(repair).toEqual({ resetTo: null, target: null });
  });
});

describe('a press on a different tab', () => {
  it('is a plain switch that keeps that tab where it was left', () => {
    // Deep in Study, pressing Home: Home reopens on the screen it was left on.
    // That is expected; only the RE-TAP goes to the root.
    const press = planTabPress({ routes, index: 1, routeName: 'HomeTab' });
    expect(press.alreadyFocused).toBe(false);
    expect(press.navigateTo).toBe('HomeTab');
    expect(press.emitTarget).toBe('HomeTab-1');
  });
});

describe('the wiring the duotone bar must not have broken', () => {
  const bar = read('components/layout/BottomTabBar.tsx');
  const nav = read('navigation/RootNavigator.tsx');

  it('still hands every tab button its press handler', () => {
    // The Pressable, not the icon, is what the finger lands on.
    expect(bar).toMatch(/<Pressable\s+onPress=\{onPress\}/);
    expect(bar).toMatch(/onPress=\{\(\) => onTabPress\(tab\.key\)\}/);
  });

  it('draws the current icon with a tone, never with its own press handler', () => {
    // An AppIcon takes no onPress and must not be given one: a pressable icon
    // would take the touch and the bar's button would never fire.
    const icon = bar.slice(bar.indexOf('<AppIcon'), bar.indexOf('/>', bar.indexOf('<AppIcon')));
    expect(icon).toContain("tone={active ? 'active' : 'neutral'}");
    expect(icon).not.toContain('onPress');
  });

  it('still emits tabPress from the bar handler, and can be prevented', () => {
    expect(nav).toContain("type: 'tabPress'");
    expect(nav).toContain('canPreventDefault: true');
    expect(nav).toContain('if (event.defaultPrevented) return;');
    expect(nav).toContain('planTabRootReset({');
  });

  it('passes the bar handler to the bar', () => {
    expect(nav).toMatch(/onTabPress=\{navigateTab\}/);
  });
});
