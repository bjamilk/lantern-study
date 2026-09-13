import fs from 'fs';
import path from 'path';
import { TAB_PILL } from '../../theme/surfaceMetrics';
import { planTabPresentation, tabPillWidth } from './bottomBarComposition';

const SRC_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');

describe('planTabPresentation — the black pill and the five labels', () => {
  it('gives the lit tab a pill and every idle tab none', () => {
    expect(planTabPresentation({ active: true, segmentWidth: 72 }).pillWidth).toBe(72);
    expect(planTabPresentation({ active: false, segmentWidth: 72 }).pillWidth).toBeNull();
  });

  it('draws a label on EVERY tab, lit or not', () => {
    // The in-Study row shipped without idle labels and that was the build-176
    // device-pass finding. Five destinations are the product's whole map; four
    // of them may not be nameless glyphs.
    expect(planTabPresentation({ active: true }).showLabel).toBe(true);
    expect(planTabPresentation({ active: false }).showLabel).toBe(true);
  });

  it('keeps the pill inside its own segment', () => {
    // 117 dp is measured off a bar with fewer destinations. Five segments on a
    // 360 dp phone are 72 dp, and an unclamped pill does not clip on Android —
    // it draws straight over the next tab's glyph.
    expect(tabPillWidth(72)).toBe(72);
    expect(tabPillWidth(200)).toBe(TAB_PILL.maxWidth);
  });

  it('falls back to the measured width before the first layout pass', () => {
    // onLayout has not fired yet, so the segment reports nothing. A 0-wide pill
    // would flash an invisible lit tab on the first frame of every launch.
    expect(tabPillWidth(0)).toBe(TAB_PILL.maxWidth);
    expect(tabPillWidth(null)).toBe(TAB_PILL.maxWidth);
    expect(tabPillWidth(undefined)).toBe(TAB_PILL.maxWidth);
    expect(tabPillWidth(Number.NaN)).toBe(TAB_PILL.maxWidth);
  });

  it('is fully rounded, so a lit tab and a primary button are one object', () => {
    const plan = planTabPresentation({ active: true, segmentWidth: 72 });
    expect(plan.pillRadius).toBe(plan.pillHeight / 2);
    expect(plan.pillHeight).toBe(TAB_PILL.height);
  });

  it('draws the lit glyph larger than the idle outline', () => {
    expect(planTabPresentation({ active: true }).glyphSize).toBeGreaterThan(
      planTabPresentation({ active: false }).glyphSize,
    );
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

  it('draws every tab through a planner, pill and label alike', () => {
    // A hardcoded pill (or an `active ? label : null`) in the JSX would pass
    // every test above while shipping the old bar.
    //
    // WHICH planner changed on 2026-09-13: the bar moved from the per-segment
    // `planTabPresentation` above to the ROW planner in tabPillLayout.ts,
    // because the founder's treatment — idle tabs icon-only, one pill hugging
    // its word, the ends pinned and the middle sliding — is a fact about the
    // whole row and cannot be decided one segment at a time. What this scan
    // guards is unchanged: the JSX asks a tested planner rather than deciding.
    expect(bar).toContain('planTabPillRow');
    expect(bar).toContain('plan.label !== null');
    expect(bar).toContain('plan.expanded');
    // The strip is the PAGE GROUND with a hairline, not a raised slab: the
    // elevation is what made the black pill fight a second white plane.
    expect(bar).toContain('backgroundColor: colors.background');
    expect(bar).toContain('borderTopWidth: StyleSheet.hairlineWidth');
    // The prose above the style block explains the removal, so the scan looks
    // for the STYLE key rather than the string anywhere in the file.
    expect(bar).not.toMatch(/^\s*elevation:/m);
    expect(bar).not.toMatch(/^\s*shadowOpacity:/m);
  });

  it('draws the five tabs unconditionally, with the row stacked above them', () => {
    // The heart of the build-185 fix. The bar used to branch on
    // `composition.showGlobalTabs`, and inside Study and Shop that branch took
    // the five labelled destinations off screen entirely. There is no branch
    // left: `above` renders, then the five, always, in that order.
    expect(bar).not.toContain('composition.showGlobalTabs');
    expect(bar).not.toContain('replaceGlobalTabs');
    expect(bar).not.toContain('planBottomBarComposition');
    const rowAt = bar.indexOf('{above}');
    const tabsAt = bar.indexOf('{tabs.map((tab, index) => (');
    expect(rowAt).toBeGreaterThan(-1);
    expect(tabsAt).toBeGreaterThan(rowAt);
  });

  it('keeps no exit control anywhere in the chrome', () => {
    // The set row DOES replace the bar, and it still has no exit CONTROL: its
    // way out is `Home`, an ordinary labelled item in the row like every other
    // door, not a special affordance bolted to the side of it.
    for (const src of [bar, nav, row]) {
      expect(src).not.toContain('ExitControl');
      expect(src).not.toContain('exitControl');
    }
    expect(nav).not.toContain('replacesGlobalBar');
    expect(nav).not.toContain('canPopFocusedStack');
  });

  it('gives the row its width shares and its label step from the planner', () => {
    // `flex: 1` on every segment is what ellipsises the promoted word to
    // nothing on Study's five-item row; the share has to come from the planner,
    // where contextualPillLabelSpace measures it.
    expect(row).toContain('flex: plan.flex');
    expect(row).not.toContain('flex: 1, minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT');
    // A named step, not a raw size: the word is `text-body` (15 sp).
    expect(row).toContain('text-body');
  });

  it('still mounts the row from the one caller that owns the navigation', () => {
    expect(nav).toContain('<ContextualBar');
    expect(nav).toContain('onNavigate={navigateWithinFocusedStack}');
  });

  it('hides the five tabs only on what the ROW says is on screen', () => {
    // Presence is not the registry's alone — the keyboard takes the row away —
    // so the bar must stand its tabs down on the row's own report, never on a
    // spec lookup. Getting this wrong leaves a student typing inside a set with
    // no bottom navigation at all.
    expect(nav).toContain('onPresence={setContextualMode}');
    expect(nav).toContain("hideTabs={contextualMode === 'replace'}");
    expect(bar).toContain('hideTabs');
  });

  it('gives both clearance callers the same arithmetic, including the swap', () => {
    // If a screen padded for a bar that is not there (or not for the row that
    // is), the last row of a list lands under the chrome — the offline-box bug.
    // An `above` row adds to the bar's clearance; the set row stands IN the
    // bar's place, so its own height replaces the bar's. Both callers must say
    // both halves, and say them identically.
    for (const src of [bar, screen]) {
      expect(src).toContain('contentHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT');
      expect(src).toContain("replace: contextual?.mode === 'replace'");
      expect(src).toContain('tabBarContentHeight: TAB_BAR_CONTENT_HEIGHT');
    }
  });
});
