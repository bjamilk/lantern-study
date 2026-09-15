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
  tileSceneForTool,
  type TileSceneName,
} from '@lantern/shared/design';

export { tileSceneFills, tileSceneForTool, type TileSceneName };

/**
 * Home's quick-action door id -> the TOOL id whose scene that door is drawn
 * with, so a Home door and the set room's tile for the same thing draw the
 * same picture in the same two colours.
 *
 * WHY THIS EXISTS. Home's doors were the last `DoorTile`s still handing the
 * panel a portrait `Illustration` instead of a landscape scene, and an
 * illustration's ground ellipse takes one of two colours: the tile's own tint
 * (invisible on its own pastel) or the SURFACE — pure `#ffffff` in light. So
 * `Record a lecture` drew a white sheet on butter while the set room's
 * `Lectures` tile, which takes the scene path, drew the same sheet in the
 * shade (`tileSceneFills`, tint carried toward ink). Same feature, two
 * pictures, one of them wrong. Routing Home through the scene table is what
 * makes the two identical, because from there both call sites hand `TileScene`
 * nothing but a scene name and a feature.
 *
 * Only the two doors that HAD an illustration are listed. A door that draws a
 * glyph today keeps its glyph: adding art to it is an art decision, not this
 * fix. The tool ids are the product's and the scene names the art's, so the
 * hop goes through `tileSceneForTool` rather than naming a scene here.
 */
const HOME_DOOR_TOOL: Record<string, string | undefined> = {
  import: 'import',
  recordLecture: 'lecture',
};

/** The scene for a Home quick-action door, or `undefined` for a glyph door. */
export function homeDoorScene(doorId: string): TileSceneName | undefined {
  const tool = HOME_DOOR_TOOL[doorId];
  return tool ? tileSceneForTool(tool) : undefined;
}

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
