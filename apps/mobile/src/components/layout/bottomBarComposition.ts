/**
 * How ONE tab of the global bottom bar is drawn.
 *
 * WHAT USED TO BE HERE, and why it is gone: `planBottomBarComposition` and
 * `canPopFocusedStack` decided whether the global five-tab bar was on screen at
 * all (the 2026-09-08 `replace` mode) and, when it was not, whether the
 * section's single exit control read Back or Home. Build 185's device pass
 * found the consequence — inside Study and Shop the five labelled tabs were
 * simply missing — and the mode is reverted: the contextual row now sits ABOVE
 * an unchanged global bar on every route (navigation/contextualBars.ts). With
 * no route that can take the bar away there is no composition left to decide
 * and no exit to place, so both rules are deleted rather than left answering a
 * question nobody asks.
 *
 * Pure on purpose, exactly like screenInsets.ts and tabPressBehavior.ts next
 * door: mobile jest runs on the `node` environment with
 * `testMatch: ['**\/*.test.ts']` and cannot transform a native module, so
 * every decision the bottom bar makes lives here and is exercised in
 * bottomBarComposition.test.ts. BottomTabBar.tsx and RootNavigator's
 * CustomTabBar are then a thin shell over these numbers.
 *
 * The one import is `theme/surfaceMetrics`, which is itself pure data and
 * imports nothing — the measured pill geometry belongs beside the button that
 * shares it, not retyped here.
 */
import { TAB_PILL } from '../../theme/surfaceMetrics';

/**
 * How ONE tab is drawn — the founder direction of 2026-09-11, in numbers.
 *
 * The lit tab is a black PILL carrying a white glyph and a white label; every
 * other tab is a grey outline glyph with its label underneath, on the bare
 * page ground. That is the whole signal: shape and ground change, not just a
 * hue, so a reader who cannot separate two colours still knows where they are.
 *
 * TWO THINGS THIS ENCODES THAT ARE EASY TO GET WRONG.
 *
 * 1. `showLabel` is unconditionally TRUE. StudyFetch drops the idle labels and
 *    keeps only the lit one; Lantern may not, because its five are the whole
 *    product's map rather than one section's toolbar. The in-Study row shipped
 *    without them on Library/Flashcards/Tests and that was the build-176
 *    device-pass finding — four unlabelled glyphs and one word. A boolean that
 *    is always true looks silly until someone reintroduces the ternary.
 *
 * 2. The pill's width is CLAMPED to the segment it sits in. The measurement is
 *    117 dp, taken off a bar with fewer destinations; five segments on a 360 dp
 *    phone are 72 dp each, so an unclamped 117 would overlap its neighbours —
 *    and on Android an overlapping absolutely-sized child does not clip, it
 *    draws over the next tab's glyph.
 */
export interface TabPresentation {
  /** The black pill behind the lit tab. `null` on every idle tab. */
  pillWidth: number | null;
  /** The pill's height, and therefore its diameter: it is fully rounded. */
  pillHeight: number;
  pillRadius: number;
  /** The glyph, white inside the pill and a grey outline outside it. */
  glyphSize: number;
  /** Always true. See note 1 above. */
  showLabel: boolean;
}

/**
 * The pill's width inside a segment of `segmentWidth`, or the measured maximum
 * when the segment is not known yet (the first layout pass reports 0).
 */
export function tabPillWidth(segmentWidth: number | null | undefined): number {
  if (typeof segmentWidth !== 'number' || !Number.isFinite(segmentWidth) || segmentWidth <= 0) {
    return TAB_PILL.maxWidth;
  }
  return Math.min(TAB_PILL.maxWidth, segmentWidth);
}

export function planTabPresentation({
  active,
  segmentWidth,
}: {
  active: boolean;
  segmentWidth?: number | null;
}): TabPresentation {
  return {
    pillWidth: active ? tabPillWidth(segmentWidth) : null,
    pillHeight: TAB_PILL.height,
    pillRadius: TAB_PILL.radius,
    glyphSize: active ? TAB_PILL.activeGlyphSize : TAB_PILL.inactiveGlyphSize,
    showLabel: true,
  };
}
