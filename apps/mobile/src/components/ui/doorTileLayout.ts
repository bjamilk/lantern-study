/**
 * How big a door is, from the width the grid gives it.
 *
 * A door (`DoorTile.tsx`) is the hub's unit: a pastel PANEL carrying a black
 * line illustration over the top two thirds, a white FOOTER underneath with
 * the title and a small tinted glyph, and a hard black shadow offset down and
 * right with no blur at all — the shadow is a drawn edge, not depth.
 *
 * WHY THE HEIGHT IS ARITHMETIC. Exactly the reason `featureTileLayout.ts`
 * exists next door: a tile whose panel is "66% of whatever the content turned
 * out to be" measures 0 on the app's first layout pass, because the
 * illustration's `Svg` has no native view yet — which is how every Home door
 * on build 166 shipped clipped at its floor while the identical tile on the
 * Study hub was correct. So the panel does not ask; it is told. Give this the
 * column width and it returns every box the tile draws.
 *
 * Pure, importing only the measured constants, so it runs in the node jest
 * environment beside `doorTileLayout.test.ts`.
 */
import { DOOR_TILE } from '../../theme/surfaceMetrics';

export interface DoorTileLayout {
  /** The column width, echoed back so a caller has one object to spread. */
  width: number;
  /** Total tile height, including the footer. Never measured. */
  height: number;
  /** The pastel panel: full width, the top `panelHeightFraction` of height. */
  panelHeight: number;
  /** The white strip under the panel, carrying the title and its glyph. */
  footerHeight: number;
  /** The illustration's box inside the panel, once its top padding is paid. */
  illustrationSize: number;
  /** Padding above the illustration inside the panel. */
  panelPaddingTop: number;
  /** Corner radius of the whole tile. */
  radius: number;
  /** The hard shadow's offset — the same value down and right, blur 0. */
  shadowOffset: number;
}

/** A door may never be narrower than this and still read as a target. */
export const DOOR_TILE_MIN_WIDTH = 120;

/**
 * The width of one door in an `columns`-wide grid on a screen of `screenWidth`,
 * once the page margins and the gutters between them are paid.
 *
 * Floored at {@link DOOR_TILE_MIN_WIDTH} rather than allowed to go negative on
 * a narrow screen or a silly column count: a door that has collapsed is worse
 * than one that overflows, because an overflowing one is visible in review.
 */
export function doorTileColumnWidth({
  screenWidth,
  columns = 2,
  pageMargin = DOOR_TILE.pageMargin,
  gutter = DOOR_TILE.gridGutter,
}: {
  screenWidth: number;
  columns?: number;
  pageMargin?: number;
  gutter?: number;
}): number {
  const safeColumns = Math.max(1, Math.floor(columns));
  const usable = screenWidth - pageMargin * 2 - gutter * (safeColumns - 1);
  return Math.max(DOOR_TILE_MIN_WIDTH, Math.round((usable / safeColumns) * 10) / 10);
}

/**
 * Every box a door draws, from its width alone.
 *
 * The height comes from the measured 503/493 aspect ratio, so a door is
 * slightly portrait at any column width; the panel takes the top 66% of that
 * and the footer takes what is left. The illustration fills the panel minus
 * its top padding, squared off and floored at 0 so a pathologically narrow
 * tile returns a drawable (if useless) box rather than a negative one that
 * Yoga would reject.
 */
export function doorTileLayout({
  width,
  aspectRatio = DOOR_TILE.aspectRatio,
  panelFraction = DOOR_TILE.panelHeightFraction,
}: {
  width: number;
  aspectRatio?: number;
  panelFraction?: number;
}): DoorTileLayout {
  const safeWidth = Math.max(0, width);
  const height = Math.round(safeWidth * aspectRatio);
  const panelHeight = Math.round(height * panelFraction);
  const illustrationSize = Math.max(
    0,
    Math.min(
      panelHeight - DOOR_TILE.panelPaddingTop * 2,
      safeWidth - DOOR_TILE.panelPaddingTop * 2
    )
  );
  return {
    width: safeWidth,
    height,
    panelHeight,
    footerHeight: height - panelHeight,
    illustrationSize,
    panelPaddingTop: DOOR_TILE.panelPaddingTop,
    radius: DOOR_TILE.radius,
    shadowOffset: DOOR_TILE.shadowOffset,
  };
}
