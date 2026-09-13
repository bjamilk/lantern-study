import fs from 'fs';
import path from 'path';
import { TAB_PILL } from '../../theme/surfaceMetrics';
import {
  TAB_PILL_MIN_TOUCH_WIDTH,
  TAB_PILL_TRANSITION_MS,
  TAB_BADGE_CORNER_OVERLAP,
  TAB_BADGE_SIZE,
  planTabPillRow,
  tabBadgeAnchor,
  tabBadgeGlyphOverlap,
  tabPillActiveIndex,
  tabPillMaxWidth,
  tabPillTransitionMs,
} from './tabPillLayout';

const SRC_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');

/** The real bar: the five destinations, in order. */
const FIVE = [
  { id: 'Home', label: 'Home' },
  { id: 'Study', label: 'Study' },
  { id: 'Chat', label: 'Chat' },
  { id: 'Campus', label: 'Campus' },
  { id: 'Me', label: 'Profile' },
];

describe('planTabPillRow — icon-only idle tabs, one hugging pill', () => {
  it('draws a word on the ACTIVE item only', () => {
    const plan = planTabPillRow({ items: FIVE, activeIndex: 2, barWidth: 360 });
    expect(plan.items.map((i) => i.label)).toEqual([null, null, 'Chat', null, null]);
    expect(plan.items.map((i) => i.expanded)).toEqual([false, false, true, false, false]);
  });

  it('keeps every name in the accessibility tree, drawn or not', () => {
    // The whole reason the idle words may go at all. A nameless glyph a screen
    // reader cannot announce is not a simplification, it is a regression — and
    // it is the one thing the measured app could NOT be shown to get right
    // (uiautomator never got an idle frame out of it).
    const plan = planTabPillRow({ items: FIVE, activeIndex: 0, barWidth: 360 });
    expect(plan.items.map((i) => i.accessibleName)).toEqual([
      'Home',
      'Study',
      'Chat',
      'Campus',
      'Profile',
    ]);
  });

  it('pins the two ends and lets only the interior items shift', () => {
    // The measured behaviour: the first and last x-centres are identical in all
    // five captured states (95 and 987 px); the mic moves 42 px when the pill
    // beside it grows. Flex is what expresses that — a pinned end takes no
    // share, so it cannot be pushed off its edge.
    const plan = planTabPillRow({ items: FIVE, activeIndex: 1, barWidth: 360 });
    expect(plan.items.map((i) => i.pinned)).toEqual([true, false, false, false, true]);
    expect(plan.items.map((i) => i.flex)).toEqual([0, 0, 1, 1, 0]);
  });

  it('gives the pill no flex share at either end, so it still hugs', () => {
    // An end item that is ALSO the active one is both pinned and expanded.
    // Both want flex 0 — the pill sizes to its word — so the two rules agree
    // rather than fight; this asserts they keep agreeing.
    const first = planTabPillRow({ items: FIVE, activeIndex: 0, barWidth: 360 });
    const last = planTabPillRow({ items: FIVE, activeIndex: 4, barWidth: 360 });
    expect(first.items[0]).toMatchObject({ pinned: true, expanded: true, flex: 0 });
    expect(last.items[4]).toMatchObject({ pinned: true, expanded: true, flex: 0 });
  });

  it('lights nothing up when no item is the current screen', () => {
    // The set bar on a set's Overview: six doors, none of which IS the screen.
    // A planner that fell back to index 0 would put a pill on `Home` and tell
    // the student they are standing somewhere they are not.
    const plan = planTabPillRow({ items: FIVE, activeIndex: -1, barWidth: 360 });
    expect(plan.items.some((i) => i.expanded)).toBe(false);
    expect(plan.items.every((i) => i.label === null)).toBe(true);
    expect(plan.items.every((i) => i.accessibleName.length > 0)).toBe(true);
  });

  it('draws the SAME row minus its lit seat when nothing is active', () => {
    // SF3b device pass, item 2: on a set's Overview and Plan the row fell back
    // to the OLD anatomy — six words under six icons, the pre-SF3 look
    // reappearing mid-section. The bar that IS the bar may not change shape
    // depending on which room you stand in, so the no-active row is the active
    // one with the pill taken out: same pinning, same shares, no word drawn,
    // every name still announced.
    const plan = planTabPillRow({ items: FIVE, activeIndex: -1, barWidth: 360 });
    expect(plan.items.map((i) => i.pinned)).toEqual([true, false, false, false, true]);
    expect(plan.items.map((i) => i.flex)).toEqual([0, 1, 1, 1, 0]);
    // No ceiling anywhere: a ceiling belongs to a pill, and there is no pill.
    expect(plan.items.every((i) => i.maxWidth === null)).toBe(true);
    expect(plan.items.every((i) => i.selected === false)).toBe(true);
    // The row itself is unchanged — same height, same radius, same 44 dp.
    expect(plan.height).toBe(TAB_PILL.height);
  });

  it('treats every out-of-range index as no selection, not as item 0', () => {
    // `tabPillActiveIndex` returns -1, but a caller could pass 5 on a 5-item
    // row (an off-by-one) or NaN; none of those may light a tab up.
    for (const activeIndex of [-1, -7, 5, 99]) {
      const plan = planTabPillRow({ items: FIVE, activeIndex, barWidth: 360 });
      expect(plan.items.some((i) => i.expanded)).toBe(false);
      expect(plan.items.every((i) => i.label === null)).toBe(true);
    }
  });

  it('never lets the pill starve its neighbours below a touch target', () => {
    // On Android an over-wide child does not clip — it draws over the next
    // tab's glyph — so the ceiling is a real maxWidth, not a hope about flex.
    const plan = planTabPillRow({ items: FIVE, activeIndex: 3, barWidth: 360 });
    expect(plan.items[3].maxWidth).toBe(360 - 4 * TAB_PILL_MIN_TOUCH_WIDTH);
    expect(plan.items[3].maxWidth).toBeGreaterThanOrEqual(TAB_PILL_MIN_TOUCH_WIDTH);
    // …and every item, pill or not, stays pressable.
    expect(plan.items.every((i) => i.minWidth === TAB_PILL_MIN_TOUCH_WIDTH)).toBe(true);
  });

  it('caps the pill only on the item that wears it', () => {
    const plan = planTabPillRow({ items: FIVE, activeIndex: 2, barWidth: 360 });
    expect(plan.items.filter((i) => i.maxWidth !== null)).toHaveLength(1);
  });

  it('leaves the pill unclamped for the first frame, not clamped to zero', () => {
    // onLayout has not fired: the bar reports 0. A 0 ceiling would draw an
    // invisible lit tab on the first frame of every launch.
    expect(tabPillMaxWidth(0, 5)).toBeNull();
    expect(tabPillMaxWidth(null, 5)).toBeNull();
    expect(tabPillMaxWidth(undefined, 5)).toBeNull();
    expect(tabPillMaxWidth(Number.NaN, 5)).toBeNull();
  });

  it('keeps the bar at the measured 44 dp, fully rounded', () => {
    // The founder asked for a bigger LABEL. Nothing else about the bar's size
    // was on the table, and a taller bar is a smaller screen on every route.
    const plan = planTabPillRow({ items: FIVE, activeIndex: 0, barWidth: 360 });
    expect(plan.height).toBe(44);
    expect(plan.height).toBe(TAB_PILL.height);
    expect(plan.radius).toBe(plan.height / 2);
  });

  it('sets the pill word beside the glyph, not under it', () => {
    // The gap is horizontal (12–14 dp measured) and the padding is asymmetric
    // (15 leading, 18 trailing) precisely because the glyph leads and the word
    // trails. A stacked pill needs neither.
    const plan = planTabPillRow({ items: FIVE, activeIndex: 0, barWidth: 360 });
    expect(plan.gap).toBeGreaterThanOrEqual(12);
    expect(plan.gap).toBeLessThanOrEqual(14);
    expect(plan.paddingTrailing).toBeGreaterThan(plan.paddingLeading);
  });
});

describe('tabPillActiveIndex', () => {
  it('finds the selected item and reports -1 for nothing selected', () => {
    expect(tabPillActiveIndex(FIVE, 'Chat')).toBe(2);
    expect(tabPillActiveIndex(FIVE, null)).toBe(-1);
    expect(tabPillActiveIndex(FIVE, undefined)).toBe(-1);
    expect(tabPillActiveIndex(FIVE, 'Nope')).toBe(-1);
  });
});

describe('tabPillTransitionMs', () => {
  it('re-flows in ~180 ms and SNAPS under reduce motion', () => {
    expect(tabPillTransitionMs(false)).toBe(TAB_PILL_TRANSITION_MS);
    expect(TAB_PILL_TRANSITION_MS).toBeGreaterThanOrEqual(150);
    expect(TAB_PILL_TRANSITION_MS).toBeLessThanOrEqual(200);
    // Not a shorter slide: none at all. A student who asked the OS for less
    // motion gets exactly the snap this bar had before today.
    expect(tabPillTransitionMs(true)).toBe(0);
  });
});

/**
 * THE WIRING, as a source scan — the same instrument bottomBarComposition.test
 * already uses, and for the same reason: mobile jest is node-env and cannot
 * render a `.tsx`, so a component that ignored the planner above (or negated it
 * in JSX) would invert the founder's decision app-wide with every assertion
 * here still green.
 */
describe('the wiring the founder decision depends on', () => {
  const bar = read('components/layout/BottomTabBar.tsx');
  const row = read('components/layout/ContextualBar.tsx');

  it('draws every tab through the row planner', () => {
    expect(bar).toContain('planTabPillRow');
    expect(bar).toContain('plan.expanded');
    // A hardcoded `active ? label : null` in the JSX would ship the old bar
    // while every test above stayed green.
    expect(bar).toContain('plan.label !== null');
  });

  it('keeps the name, the role and the selected state on EVERY tab', () => {
    // The a11y win the founder's ask is allowed to keep. Dropping the drawn
    // word is only acceptable while these three survive.
    expect(bar).toContain('accessibilityLabel={plan.accessibleName}');
    expect(bar).toContain('accessibilityRole="tab"');
    expect(bar).toContain('accessibilityState={{ selected: plan.selected }}');
    expect(row).toContain('accessibilityLabel={plan.accessibleName}');
    expect(row).toContain('accessibilityRole="tab"');
    expect(row).toContain('accessibilityState={{ selected: plan.selected }}');
  });

  it('keeps the badge on the glyph, where a count belongs', () => {
    // Study's due-card count is the one thing on this bar that is not
    // navigation, and an icon-only idle tab is exactly where it must still be
    // legible — it is now the ONLY thing distinguishing that glyph.
    expect(bar).toContain('<Badge count={tab.badge}');
    // …and it is ANCHORED through the pure model, never nudged by a Tailwind
    // `-top-1 -right-1`, which is what buried the glyph on device.
    expect(bar).toContain('tabBadgeAnchor(');
    expect(bar).not.toContain('<Badge count={tab.badge} />');
  });

  it('anchors the badge by its LEFT edge so a wide count cannot creep back', () => {
    // The defect was not the offset, it was the anchor: a badge pinned by its
    // RIGHT edge grows leftwards over the icon as digits are added. The
    // component must spend `top`/`left`, so the disc grows outwards.
    const ui = read('components/ui/index.tsx');
    expect(ui).toContain('top: anchor.top, left: anchor.left');
    expect(bar).not.toMatch(/Badge[^>]*right:/);
  });

  it('sets the pill word at a NAMED step, never a raw size', () => {
    // `text-body` is 15 sp — the nearest step to the measured 15 sp cap height
    // — at semibold. A raw `fontSize: 15` here would pass the eye and fail the
    // type-scale gate, and would not rescale with the appearance setting.
    expect(bar).toContain('text-body');
    expect(bar).not.toMatch(/fontSize:\s*\d/);
    expect(row).toContain('text-body');
  });

  it('animates the re-flow through the shared duration, reduce-motion aware', () => {
    for (const src of [bar, row]) {
      expect(src).toContain('tabPillTransitionMs(reduceMotion)');
      expect(src).toContain('LayoutAnimation');
    }
    // Android needs the experimental flag turned on or LayoutAnimation is a
    // silent no-op there — which would ship the snap to the platform the
    // founder actually tests on.
    expect(bar).toContain('setLayoutAnimationEnabledExperimental');
  });
});

describe('tabBadgeAnchor — the unread count sits BESIDE the glyph, never on it', () => {
  // SF3b device pass, item 5: the Study tab rendered as a bare red disc, its
  // glyph completely hidden by the 68-due badge. These pin the geometry that
  // cannot happen again.
  const GLYPH = TAB_PILL.inactiveGlyphSize;

  it('pins the badge\'s top-LEFT corner inside the glyph\'s top-right one', () => {
    const { top, left } = tabBadgeAnchor({ glyphSize: GLYPH });
    // Above the glyph's top edge: the badge hangs off the corner upwards.
    expect(top).toBeLessThan(0);
    expect(top).toBe(TAB_BADGE_CORNER_OVERLAP - TAB_BADGE_SIZE);
    // …and to the right of the glyph's centre, so half the icon is never under
    // it. `left`, not `right` — see the module note.
    expect(left).toBe(GLYPH - TAB_BADGE_CORNER_OVERLAP);
    expect(left).toBeGreaterThan(GLYPH / 2);
  });

  it('covers at most a 6x6 corner of the glyph AT ANY COUNT', () => {
    // The real regression test. 18 dp is a one-digit badge, 24 a two-digit
    // "68" (the count that hid the icon on device), 34 the three-digit "99+".
    for (const badgeWidth of [TAB_BADGE_SIZE, 24, 34, 60]) {
      const { width, height } = tabBadgeGlyphOverlap({ glyphSize: GLYPH, badgeWidth });
      expect(width).toBe(TAB_BADGE_CORNER_OVERLAP);
      expect(height).toBe(TAB_BADGE_CORNER_OVERLAP);
      // A third of the glyph's area is the ceiling; 6x6 of 18x18 is a ninth.
      expect((width * height) / (GLYPH * GLYPH)).toBeLessThan(1 / 3);
    }
  });

  it('would have FAILED on the shipped -3.5 dp right-edge nudge', () => {
    // What was on device: a right-anchored badge 3.5 dp out, i.e. its left
    // edge at `glyph + 3.5 - width`. At a two-digit count that is x = -2.5 —
    // the whole glyph. Expressed through the same overlap maths so the
    // comparison is honest rather than a comment.
    const shippedLeft = GLYPH + 3.5 - 24;
    const shippedOverlapWidth = Math.min(GLYPH, shippedLeft + 24) - Math.max(0, shippedLeft);
    expect(shippedOverlapWidth).toBe(GLYPH);
    expect(shippedOverlapWidth).toBeGreaterThan(TAB_BADGE_CORNER_OVERLAP);
  });
});
