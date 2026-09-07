/**
 * How tall a door is, as arithmetic rather than as a measurement.
 *
 * WHY THIS FILE EXISTS. On build 166 every Home door rendered 132 dp tall —
 * its floor — while the identical `FeatureTile` on the Study hub rendered
 * 160 dp. The extra 28 dp is exactly the picture's row, and on Home that row
 * was drawn but not counted: the illustration spilled past the tile's
 * `overflow-hidden` edge, clipped mid-drawing, and the chevron below it was
 * pushed out of the card entirely (shots24/32a-coldstart-doors.png,
 * 01c-review-tile.png, and still wrong on 34-final-home.png at the end of the
 * run, because a tab screen mounted at boot is never re-laid-out).
 *
 * The cause is not Home. Home is the initial route, so its doors are the ONLY
 * ones laid out on the app's very first layout pass; the Study hub mounts
 * later and measures correctly, which is why the same component looked right
 * there. Something in the picture's subtree contributes no height on that
 * first pass — an `Svg` whose native view has not attached yet — so the tile's
 * content measured 105 dp, its 132 floor won, and nothing ever asked again.
 *
 * The fix is to stop asking. A door's height is knowable from the type scale
 * and the spacing it is built out of, so this module computes it and the tile
 * declares it:
 *
 *   - `featureTileFooterHeight` gives the picture/chevron row a DEFINITE
 *     height, so a picture that measures late cannot collapse the row it sits
 *     in; and
 *   - `featureTileMinHeight` raises the tile's own floor to what that content
 *     needs, so even a first pass that measures nothing at all reserves the
 *     right box.
 *
 * Neither makes a tile taller than its content: both are floors, and a promise
 * that wraps to two lines still grows the card past them.
 *
 * Pure and node-testable, like `appIconStroke.ts` and `illustrationFills.ts`
 * beside it. The numbers are imported, never retyped: line heights come from
 * the type scale and the paddings are this project's Tailwind rem (14 px, the
 * reason `p-3` is 10.5 and not 12).
 */
import { typeScale } from '../../design/typeScale';

/** NativeWind's rem in this app. `tailwind.config.js` sets nothing else. */
const REM = 14;

/** The tint strip across the top of a door. Spec §5.6; 24% of the 132 floor. */
export const TILE_BAND_HEIGHT = 32;

/** A tile's picture, and a band's. The one size a door gets. */
export const TILE_ILLUSTRATION_SIZE = 56;

/** The affordance at the foot of a door, when there is no picture beside it. */
export const TILE_CHEVRON_SIZE = 16;

/**
 * The floor a door may never go under, picture or no picture: two of these sit
 * side by side on a 360 dp screen and each has to read as a target.
 */
export const TILE_TAP_TARGET_FLOOR = 132;

/**
 * The `border` utility on the tile: 1 px top and bottom. Yoga's `minHeight` is
 * the BORDER box, so the floor has to carry it or the reserved box is 2 dp
 * short of the content it promises — which is invisible on a pass that
 * measures correctly and eats bottom padding on one that does not. With it the
 * arithmetic lands on what the Study hub measured on device: 159.75 dp is
 * 419.3 px at 2.625, and shots24/02-study-hub.png shows 420.
 */
const TILE_BORDER_WIDTH = 1;

/** `p-3` on the body. */
const BODY_PADDING = 0.75 * REM;
/** `mt-0.5` between the title and the promise. */
const SUBTITLE_GAP = 0.125 * REM;
/** `mt-2` between the promise and the picture's row. */
const PICTURE_GAP = 0.5 * REM;

/**
 * The height of a door's bottom row — the picture and the chevron.
 *
 * Declared rather than measured. This is the line that makes the first render
 * correct: the row is as tall as the picture whether or not the picture's own
 * view has answered yet.
 */
export function featureTileFooterHeight(hasIllustration: boolean): number {
  return hasIllustration ? TILE_ILLUSTRATION_SIZE : TILE_CHEVRON_SIZE;
}

/**
 * The floor for a door with this content: band, padded body, title, optional
 * promise, and the footer row — or the tap-target floor, whichever is larger.
 *
 * `subtitleLines` is what the promise is ALLOWED to take (`numberOfLines={2}`
 * on the tile), not what it happens to take. Passing 1 keeps the floor at what
 * a one-line door needs and lets a two-line one grow naturally, which is the
 * "must not grow beyond what the picture needs" half of the rule.
 */
export function featureTileMinHeight({
  hasIllustration,
  hasSubtitle,
  subtitleLines = 1,
}: {
  hasIllustration: boolean;
  hasSubtitle: boolean;
  subtitleLines?: number;
}): number {
  const content =
    TILE_BORDER_WIDTH * 2 +
    TILE_BAND_HEIGHT +
    BODY_PADDING * 2 +
    typeScale.body.lineHeight +
    (hasSubtitle ? SUBTITLE_GAP + typeScale.caption.lineHeight * subtitleLines : 0) +
    (hasIllustration ? PICTURE_GAP : 0) +
    featureTileFooterHeight(hasIllustration);
  return Math.max(TILE_TAP_TARGET_FLOOR, content);
}
