/**
 * How big a room tile's scene is, and which two colours it is drawn in.
 *
 * Pure, like `illustrationFills.ts` beside it and for the same reason: this
 * project's jest run is node-only, so a rendered-tree assertion is not
 * available and a pure planner is how every other sizing rule here
 * (`doorTileLayout`, `appIconStroke`, `illustrationSvgProps`) is pinned.
 *
 * The colours themselves are NOT decided here — `tileSceneFills` lives in
 * `@lantern/shared/design` beside the geometry, so web's `color-mix` and this
 * file's arithmetic derive the same shade from the same two tokens. It is
 * re-exported below because this is where mobile callers look.
 */
import {
  TILE_SCENE_VIEW_BOX,
  tileSceneFills,
  type TileSceneName,
} from '@lantern/shared/design';

export { tileSceneFills, type TileSceneName };

/** `0 0 160 120` as numbers, so the fit below is arithmetic and not a guess. */
const [, , SCENE_WIDTH, SCENE_HEIGHT] = TILE_SCENE_VIEW_BOX.split(' ').map(Number) as [
  number,
  number,
  number,
  number,
];

/**
 * The three props the renderer hands its `Svg`, as data.
 *
 * A scene is LANDSCAPE and the box it is given is whatever shape the tile's
 * panel turned out to be, so the fit is `min` of the two scales — the drawing
 * touches the tighter edge and centres on the other. It is computed rather
 * than left to `preserveAspectRatio` because on a narrow column the difference
 * is the whole question of whether the scene reads as art or as a stamp, and
 * a number a test can read is the only way that stays true.
 *
 * Rounded and floored at 0: a pathologically narrow tile returns a drawable
 * (if useless) box rather than a negative one Yoga would reject — the same
 * guard `doorTileLayout` makes for the same reason.
 */
export function tileSceneSvgProps({
  boxWidth,
  boxHeight,
}: {
  boxWidth: number;
  boxHeight: number;
}): { width: number; height: number; viewBox: string } {
  const scale = Math.max(
    0,
    Math.min(boxWidth / SCENE_WIDTH, boxHeight / SCENE_HEIGHT)
  );
  return {
    width: Math.round(SCENE_WIDTH * scale),
    height: Math.round(SCENE_HEIGHT * scale),
    viewBox: TILE_SCENE_VIEW_BOX,
  };
}
