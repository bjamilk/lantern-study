/**
 * The bottom bar's HUGGING PILL row — founder direction 2026-09-13, measured
 * off StudyFetch's Android app at 1080x2400 / 420 dpi.
 *
 * WHAT CHANGED, AND WHY IT NEEDED A NEW MODULE. Until now every tab drew the
 * same shape in a fixed slot: five equal 82 dp segments, an 11 sp label under
 * every glyph, and a pill clamped to the segment it sat in
 * (`bottomBarComposition.ts`). That bar cannot express what was measured:
 *
 *   - the idle tabs are ICON ONLY (#716D66, no word at all);
 *   - the lit tab is a pill that HUGS `icon + label`, the label BESIDE the
 *     icon at ~15 sp rather than under it at 11;
 *   - the pill's width therefore VARIES with the word (102–145 dp measured
 *     across the five destinations), so the row re-flows;
 *   - the first and last icons are PINNED (x-centres 95 and 987 in all five
 *     captured states) while the interior ones SLIDE (the mic moves 16 dp when
 *     Study Plan is selected).
 *
 * A per-segment planner cannot say any of that, because every one of those
 * facts is about the item's place in the ROW. So the row is planned here, once,
 * from three inputs — the items, which one is active, and how wide the bar is —
 * and `bottomBarComposition.ts` keeps only the pill's own geometry.
 *
 * THE ACCESSIBILITY HALF IS NOT NEGOTIABLE. Dropping the idle words is a
 * DRAWING decision; every item still carries its full name as an accessible
 * name, and the component puts it on `accessibilityLabel` beside
 * `accessibilityRole="tab"` and `accessibilityState={{ selected }}`. That is
 * the one thing this row does that the app it was measured from could not be
 * shown to do: `uiautomator dump` never succeeded against StudyFetch, so
 * whether its nameless glyphs are announced at all is unknown. Lantern's are.
 *
 * Pure and node-testable with one pure-data import, exactly like
 * `bottomBarComposition.ts` and `screenInsets.ts` next door: mobile jest runs
 * the `node` environment and cannot transform a native component, so every
 * decision the bar makes has to live in a `.ts` to be exercised at all.
 */
import { TAB_PILL } from '../../theme/surfaceMetrics';

/**
 * The narrowest an IDLE item may be, and therefore the floor on the space the
 * hugging pill may take from its neighbours: Material's 44 dp minimum target.
 * An icon-only tab has no word to set its width, so without this floor a wide
 * pill on a narrow phone would squeeze the four beside it into unpressable
 * slivers.
 */
export const TAB_PILL_MIN_TOUCH_WIDTH = 44;

/**
 * The gap between the pill's glyph and its word, in dp. Measured at 31–37 px
 * / 12–14 dp; 12 is the low end, taken because Lantern's longest tab word
 * ("Campus") is longer than StudyFetch's median and the gap is the cheapest
 * dp to give back.
 */
export const TAB_PILL_LABEL_GAP = 12;

/**
 * The pill's own horizontal padding, in dp. Measured 40 px / 15.2 left and
 * 48 px / 18.5 right; the asymmetry is the measured app's optical correction
 * for a leading glyph against a trailing word, kept rather than averaged away.
 */
export const TAB_PILL_PADDING_LEADING = 15;
export const TAB_PILL_PADDING_TRAILING = 18;

/**
 * The bar's own padding at either edge, in dp.
 *
 * The two end glyphs are PINNED, so this is literally where they sit: without
 * it the first and last icons would be flush against the screen edge, and the
 * measured app leaves ~14 dp (95 px centre on a 45 px glyph). It also gives the
 * end tabs' 44 dp targets somewhere to be without overhanging the display.
 */
export const TAB_ROW_EDGE_PADDING = 8;

/**
 * The cap on font scaling for the pill's word.
 *
 * 15 sp * 1.3 = 19.5 sp, inside `text-body`'s 22 dp line box and so inside the
 * 44 dp pill. Raising it clips the word at large accessibility text sizes; the
 * cap is on the DRAWN word only, and the accessible name is announced at full
 * effect regardless — the same bargain CONTEXTUAL_PILL_LABEL already makes.
 */
export const TAB_PILL_LABEL_MAX_FONT_SCALE = 1.3;

/**
 * How long the row takes to re-flow, in ms.
 *
 * The measured transition settles between the second and third frame of a
 * ~60 ms capture loop — under ~200 ms including capture latency, with a
 * mid-flight frame in which the pill is gone and the interior icons sit
 * between their start and end positions. 180 ms sits inside that window.
 */
export const TAB_PILL_TRANSITION_MS = 180;

/**
 * The duration to actually use. Zero under `reduceMotion`: a student who has
 * asked the OS for less motion gets the same snap the bar had before, not a
 * shortened slide. Same contract as `contextualBarTransitionMs`.
 */
export function tabPillTransitionMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : TAB_PILL_TRANSITION_MS;
}

/** The little the planner needs off an item: its id and its visible word. */
export interface TabPillItemInput {
  id: string;
  label: string;
}

/** How ONE item of the row is drawn and how it takes its width. */
export interface TabPillItemPlan {
  id: string;
  /**
   * The word DRAWN for this item — the active item's name, or `null` on every
   * idle one. Never the accessible name: see {@link accessibleName}.
   */
  label: string | null;
  /**
   * ALWAYS the item's full name, drawn or not. The word leaves the screen; it
   * never leaves the accessibility tree.
   */
  accessibleName: string;
  selected: boolean;
  /**
   * Anchored to its end of the bar — the first and last items, which stay put
   * in every state so the row has two fixed landmarks while the middle moves.
   * A pinned item takes no flex share; it is exactly as wide as it needs to be.
   */
  pinned: boolean;
  /**
   * This is the item wearing the pill: it hugs `icon + label` and so sets the
   * width the others divide up.
   */
  expanded: boolean;
  /**
   * The flex share. `0` for anything that sizes to its own content (the pill,
   * and the two pinned ends); `1` for every interior idle item, which is what
   * makes them SLIDE as the pill grows instead of sitting in a fixed slot.
   */
  flex: number;
  /** Never narrower than a touch target, pill or not. */
  minWidth: number;
  /**
   * The ceiling on the pill's width, or `null` for an item that has none (an
   * idle icon cannot outgrow its content). `null` too before the first layout
   * pass, when the bar's width is not known yet — an unclamped pill for one
   * frame beats a pill clamped to zero.
   */
  maxWidth: number | null;
}

export interface TabPillRowPlan {
  items: TabPillItemPlan[];
  /** 44 dp, unchanged: the founder asked for a bigger LABEL, not a bigger bar. */
  height: number;
  /** Fully rounded, so a lit tab and a primary button stay one object. */
  radius: number;
  gap: number;
  paddingLeading: number;
  paddingTrailing: number;
}

/**
 * The widest the pill may be on a bar of `barWidth` carrying `itemCount`
 * items: everything left once every OTHER item has its 44 dp target.
 *
 * Returns `null` when the width is not known yet (the first layout pass
 * reports 0). On Android an over-wide child does not clip, it draws over its
 * neighbour — which is the same reason `tabPillWidth` clamps — so the ceiling
 * is applied as a real `maxWidth` on the pill rather than trusted to flex.
 */
export function tabPillMaxWidth(
  barWidth: number | null | undefined,
  itemCount: number,
): number | null {
  if (typeof barWidth !== 'number' || !Number.isFinite(barWidth) || barWidth <= 0) return null;
  if (itemCount <= 1) return barWidth;
  const others = (itemCount - 1) * TAB_PILL_MIN_TOUCH_WIDTH;
  return Math.max(TAB_PILL_MIN_TOUCH_WIDTH, barWidth - others);
}

/**
 * Plan the whole row.
 *
 * `activeIndex` out of range (or negative) means NO item is active — the state
 * the set bar is in on a set's Overview, where none of its six doors is the
 * screen you are looking at. Every item is then icon-only and no pill is drawn;
 * the row does not invent a selection to have something to light up.
 */
export function planTabPillRow({
  items,
  activeIndex,
  barWidth,
}: {
  items: readonly TabPillItemInput[];
  activeIndex: number;
  barWidth?: number | null;
}): TabPillRowPlan {
  const count = items.length;
  const maxWidth = tabPillMaxWidth(barWidth, count);
  return {
    items: items.map((item, index) => {
      const expanded = index === activeIndex && index >= 0 && index < count;
      const pinned = index === 0 || index === count - 1;
      return {
        id: item.id,
        label: expanded ? item.label : null,
        accessibleName: item.label,
        selected: expanded,
        pinned,
        expanded,
        // The pill and the two ends size to their content; only the interior
        // idle items share out what is left, and that sharing is the shift.
        flex: expanded || pinned ? 0 : 1,
        minWidth: TAB_PILL_MIN_TOUCH_WIDTH,
        maxWidth: expanded ? maxWidth : null,
      };
    }),
    height: TAB_PILL.height,
    radius: TAB_PILL.radius,
    gap: TAB_PILL_LABEL_GAP,
    paddingLeading: TAB_PILL_PADDING_LEADING,
    paddingTrailing: TAB_PILL_PADDING_TRAILING,
  };
}

/**
 * The index of the item with `selectedId`, or `-1` when nothing on the row is
 * the current screen. A tiny helper so the two callers (the global bar and the
 * set row) agree on what "nothing selected" is rather than one of them passing
 * `undefined` and lighting up item 0.
 */
export function tabPillActiveIndex(
  items: readonly TabPillItemInput[],
  selectedId: string | null | undefined,
): number {
  if (selectedId == null) return -1;
  return items.findIndex((item) => item.id === selectedId);
}

/**
 * THE UNREAD BADGE'S PLACE ON A TAB GLYPH — SF3b device pass, item 5.
 *
 * The badge used to be a Tailwind `-top-1 -right-1` on a `relative` box the
 * size of the glyph. Two things made that hide the Study icon completely on
 * device:
 *
 *  1. `-1` is 0.25rem, and NativeWind's rem here is 14, so the offset was
 *     3.5 dp — a twentieth of the badge's own 18 dp diameter.
 *  2. The badge is anchored by its RIGHT edge, so a two-digit count ("68")
 *     grows LEFTWARDS across the glyph. The wider the count, the more of the
 *     icon it eats. At 68 the disc covered the whole 18 dp box and the device
 *     pass found a bare red circle where the Study glyph should be.
 *
 * Nudging that offset out to 6 dp does not fix it: the badge still grows left
 * from its right edge, so a three-digit "99+" would re-cover the glyph. The
 * anchor has to move to the badge's TOP-LEFT corner, which is what this
 * returns — the corner is placed `overlap` dp inside the glyph's top-right
 * corner, and the badge then grows up and to the RIGHT, away from the icon.
 *
 * The guarantee, which {@link tabBadgeGlyphOverlap} states and the test pins:
 * whatever the count, the badge covers at most an `overlap` x `overlap` square
 * at the glyph's top-right corner. The glyph's centre is never under it.
 *
 * Placement only. The badge keeps the size, fill and numeral it already had —
 * the device pass asked for it to stop covering the icon, not to become a
 * different object.
 */
export const TAB_BADGE_SIZE = 18;

/** How far the badge's corner sits INSIDE the glyph's, in dp. */
export const TAB_BADGE_CORNER_OVERLAP = 6;

/**
 * Where to pin the badge inside a `glyphSize` box, as an absolute `top`/`left`.
 *
 * `left`, never `right`: see the module note above — a right-anchored badge
 * grows across the glyph as its count widens, which is the whole defect.
 */
export function tabBadgeAnchor({
  glyphSize = TAB_PILL.inactiveGlyphSize,
  badgeSize = TAB_BADGE_SIZE,
  overlap = TAB_BADGE_CORNER_OVERLAP,
}: {
  glyphSize?: number;
  badgeSize?: number;
  overlap?: number;
} = {}): { top: number; left: number } {
  return { top: overlap - badgeSize, left: glyphSize - overlap };
}

/**
 * How much of the glyph the badge actually covers, in dp, for a badge that is
 * `badgeWidth` wide (a count of any number of digits) at {@link tabBadgeAnchor}.
 *
 * Exists so the invariant is asserted rather than eyeballed: the width is
 * `overlap` no matter how wide the count grows, because the badge extends to
 * the right of the corner, and the height is `overlap` because it extends
 * above it.
 */
export function tabBadgeGlyphOverlap({
  glyphSize = TAB_PILL.inactiveGlyphSize,
  badgeWidth = TAB_BADGE_SIZE,
  badgeSize = TAB_BADGE_SIZE,
  overlap = TAB_BADGE_CORNER_OVERLAP,
}: {
  glyphSize?: number;
  badgeWidth?: number;
  badgeSize?: number;
  overlap?: number;
} = {}): { width: number; height: number } {
  const { top, left } = tabBadgeAnchor({ glyphSize, badgeSize, overlap });
  const width = Math.max(0, Math.min(glyphSize, left + badgeWidth) - Math.max(0, left));
  const height = Math.max(0, Math.min(glyphSize, top + badgeSize) - Math.max(0, top));
  return { width, height };
}
