// ===========================================
// Lantern Study - Spot illustrations (Wave V, spec v3 §5.6 "Imagery rule")
// ===========================================
//
// Ten inline-SVG spot illustrations, and only ten. Pure data: no React, no
// platform import, so mobile (`react-native-svg`) and web (inline `<svg>`)
// render the *same* asset rather than two drawings that drift apart.
//
// The rules this file exists to hold, from spec v3 §5.6:
//
//   - Monoline. Every path is stroked at `ILLUSTRATION_STROKE_WIDTH` (2) in
//     `currentColor`, round caps and joins, `fill="none"`. The renderer sets
//     `color` to the feature ink; the drawing follows.
//   - Exactly one filled shape per asset: the `ground` ellipse, filled with
//     the feature *tint* and never stroked. It is the only colour prop a
//     caller passes, which is why it is data here and not a path.
//   - Identical in both themes from one asset. Nothing in this file names a
//     light or dark value; the two `currentColor`/tint props do all the work,
//     so the light and dark renderings are the same geometry.
//   - Nothing is fetched. These are string literals in the bundle, so
//     `lowDataMode` changes nothing about them.
//   - Doors and empty states only. No photos, no mascot, no Lottie.
//
// Budget: `ILLUSTRATION_MAX_PATH_BYTES` per asset, asserted in the test beside
// this file. The budget is the reason the geometry is coarse (integers and
// halves, short relative segments) — it is deliberate, not unfinished.

/**
 * The ten illustration names. Doors first, then the generic empty state.
 *
 * This union — not the map's inferred keys — is what makes an unmapped name a
 * compile error at the call site. `ILLUSTRATIONS` is annotated as a
 * `Record<IllustrationName, Illustration>`, so a missing entry and a stray
 * entry both fail to build too.
 */
export type IllustrationName =
  | 'notes-stack' // Library
  | 'cards-fan' // Flashcards
  | 'test-sheet' // Tests
  | 'mic-wave' // Record
  | 'import-tray' // Import & study
  | 'readiness-ring' // Exam readiness
  | 'sparkles-book' // Lantern AI / smart notes
  | 'campus-hall' // Campus & Communities
  | 'download-phone' // Downloads / offline
  | 'empty-inbox'; // Generic empty state

/** The one filled shape in an asset: the ground the subject stands on. */
export interface IllustrationGround {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Illustration {
  /**
   * `d` attributes, drawn in order. Stroked in `currentColor` at
   * `ILLUSTRATION_STROKE_WIDTH`; never filled.
   */
  paths: string[];
  /** Filled with the feature tint, drawn *behind* `paths`; never stroked. */
  ground: IllustrationGround;
}

/** Every asset is authored on this square. Callers scale it; they never re-author it. */
export const ILLUSTRATION_VIEW_BOX = '0 0 96 96';

/** The side of `ILLUSTRATION_VIEW_BOX`, for renderers that want numbers. */
export const ILLUSTRATION_VIEW_BOX_SIZE = 96;

/** Monoline weight, in viewBox units. §5.6: "monoline stroke 2". */
export const ILLUSTRATION_STROKE_WIDTH = 2;

/** Per-asset path-data budget in bytes, asserted by the test beside this file. */
export const ILLUSTRATION_MAX_PATH_BYTES = 2048;

export const ILLUSTRATIONS: Record<IllustrationName, Illustration> = {
  // Library: three sheets stacked, ruled lines on the front one.
  'notes-stack': {
    paths: [
      'M34 28 h34 a3 3 0 0 1 3 3 v30',
      'M30 33 h36 a3 3 0 0 1 3 3 v30',
      'M25 38 h38 a3 3 0 0 1 3 3 v26 a3 3 0 0 1 -3 3 h-38 a3 3 0 0 1 -3 -3 v-26 a3 3 0 0 1 3 -3 z',
      'M32 47 h24',
      'M32 54 h24',
      'M32 61 h14',
    ],
    ground: { cx: 48, cy: 78, rx: 28, ry: 6 },
  },

  // Flashcards: one upright card with two more fanned out behind it.
  //
  // The two behind are OPEN paths that stop at the front card's edge (x 34 and
  // x 62, a round cap short of its 33/63 outline) rather than closed cards
  // drawn underneath. Nothing here is filled, so a card drawn underneath would
  // show its hidden edges straight through the front one — which turns the fan
  // into a tent. Drawing only the visible part is what buys the occlusion.
  'cards-fan': {
    paths: [
      'M34 32 L18 38 L26 66 L34 64',
      'M62 32 L78 38 L70 66 L62 64',
      'M36 26 h24 a3 3 0 0 1 3 3 v38 a3 3 0 0 1 -3 3 h-24 a3 3 0 0 1 -3 -3 v-38 a3 3 0 0 1 3 -3 z',
      'M40 40 h16',
      'M40 48 h16',
    ],
    ground: { cx: 48, cy: 78, rx: 28, ry: 6 },
  },

  // Tests: a folded-corner page, two blank rows and one ticked row.
  'test-sheet': {
    paths: [
      'M28 16 h30 l12 12 v44 a3 3 0 0 1 -3 3 h-39 a3 3 0 0 1 -3 -3 v-53 a3 3 0 0 1 3 -3 z',
      'M58 16 v12 h12',
      'M33 36 h7 v7 h-7 z',
      'M46 39.5 h16',
      'M33 49 h7 v7 h-7 z',
      'M46 52.5 h16',
      'M33 65 l3.5 3.5 l7 -8',
      'M46 65.5 h12',
    ],
    ground: { cx: 48, cy: 82, rx: 27, ry: 5 },
  },

  // Record: a capsule mic in its cradle, one sound arc each side.
  'mic-wave': {
    paths: [
      'M48 20 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -16 0 v-14 a8 8 0 0 1 8 -8 z',
      'M34 40 v3 a14 14 0 0 0 28 0 v-3',
      'M48 57 v9',
      'M39 66 h18',
      'M26 34 a10 10 0 0 0 0 14',
      'M70 34 a10 10 0 0 1 0 14',
    ],
    ground: { cx: 48, cy: 78, rx: 26, ry: 5 },
  },

  // Import & study: material dropping into an inbox tray.
  'import-tray': {
    paths: [
      'M22 54 h14 l4 7 h16 l4 -7 h14 v14 a4 4 0 0 1 -4 4 h-44 a4 4 0 0 1 -4 -4 z',
      'M48 20 v24',
      'M40 36 l8 8 l8 -8',
    ],
    ground: { cx: 48, cy: 80, rx: 27, ry: 5 },
  },

  // Readiness: a progress arc inside the ring, with the "ready" tick.
  'readiness-ring': {
    paths: [
      'M20 48 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0 z',
      'M48 28 a20 20 0 1 1 -20 20',
      'M40 48 l6 6 l12 -14',
    ],
    ground: { cx: 48, cy: 82, rx: 24, ry: 4 },
  },

  // Lantern AI: an open book with three sparkles above it.
  'sparkles-book': {
    paths: [
      'M48 38 c-6 -5 -14 -7 -22 -7 v30 c8 0 16 2 22 7 z',
      'M48 38 c6 -5 14 -7 22 -7 v30 c-8 0 -16 2 -22 7 z',
      'M48 11 l2.5 4.5 l4.5 2.5 l-4.5 2.5 l-2.5 4.5 l-2.5 -4.5 l-4.5 -2.5 l4.5 -2.5 z',
      'M24 15 l1.8 3.2 l3.2 1.8 l-3.2 1.8 l-1.8 3.2 l-1.8 -3.2 l-3.2 -1.8 l3.2 -1.8 z',
      'M72 19 l1.8 3.2 l3.2 1.8 l-3.2 1.8 l-1.8 3.2 l-1.8 -3.2 l-3.2 -1.8 l3.2 -1.8 z',
    ],
    ground: { cx: 48, cy: 80, rx: 28, ry: 5 },
  },

  // Campus: a pedimented hall, four columns, two steps.
  //
  // The columns start at y42, one stroke-width below the pediment's closing
  // base line at y40, so they read as standing under it rather than floating
  // clear of it. Two steps, not three: at this size three 4-unit-apart lines
  // stack into a bar, and the building loses its base.
  'campus-hall': {
    paths: [
      'M16 40 L48 20 L80 40 z',
      'M32 42 v20',
      'M42 42 v20',
      'M54 42 v20',
      'M64 42 v20',
      'M26 62 h44',
      'M20 69 h56',
    ],
    ground: { cx: 48, cy: 78, rx: 30, ry: 5 },
  },

  // Downloads: a phone with the material coming down onto its shelf.
  'download-phone': {
    paths: [
      'M34 12 h28 a5 5 0 0 1 5 5 v52 a5 5 0 0 1 -5 5 h-28 a5 5 0 0 1 -5 -5 v-52 a5 5 0 0 1 5 -5 z',
      'M42 19 h12',
      'M42 68 h12',
      'M48 30 v20',
      'M40 42 l8 8 l8 -8',
      'M38 58 h20',
    ],
    ground: { cx: 48, cy: 82, rx: 24, ry: 5 },
  },

  // Generic empty state: an open carton with nothing in it.
  'empty-inbox': {
    paths: [
      'M26 48 h44 v20 a4 4 0 0 1 -4 4 h-36 a4 4 0 0 1 -4 -4 z',
      'M20 48 l8 -12 h40 l8 12',
      'M20 48 h56',
      'M40 60 h16',
    ],
    ground: { cx: 48, cy: 80, rx: 28, ry: 6 },
  },
};

/**
 * The enumeration itself, in map order — for tests, for a gallery screen, and
 * so a caller can iterate without re-listing the names by hand.
 */
export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS) as IllustrationName[];

/** Narrow an untrusted string (a config value, a stored key) to a mapped name. */
export function isIllustrationName(value: unknown): value is IllustrationName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ILLUSTRATIONS, value);
}

/**
 * The bytes an asset's path data costs in the bundle. The budget is per asset
 * (§5.6, "≤2 KB each"), so this measures one asset, not the file.
 */
export function illustrationPathBytes(name: IllustrationName): number {
  return ILLUSTRATIONS[name].paths.reduce((sum, d) => sum + d.length, 0);
}

/**
 * WHERE THE INK ACTUALLY IS, per asset — and why this table exists.
 *
 * Every asset is authored on the same 96x96 square (`ILLUSTRATION_VIEW_BOX`),
 * but none of them USES that square: each drawing sits in the middle of it
 * with 25-45% of the canvas as padding. Rendered at `size` with the full
 * viewBox, a 56 dp tile picture therefore draws about 32 dp of ink — which is
 * the "reads as a tiny icon" finding from the build 166 device pass (Library
 * 32x34, Tests 32x42, Flashcards 36x35, Import 32x39 dp; the readiness ring
 * 44x50 against a 72 dp box).
 *
 * The box was never wrong: the renderers have always given the `<svg>` and its
 * wrapper `width = height = size`. What was wrong is that the PICTURE inside
 * that correct box was two thirds of it. So the fix is the viewBox, not the
 * layout: crop it to the drawing's own bounding box and the ink fills the size
 * the call site asked for.
 *
 * Each entry is the asset's ink bounds — every path extreme plus half the
 * stroke, unioned with the ground ellipse, which is the one shape whose
 * extremes are data rather than path syntax — then SQUARED about its own
 * centre so the drawing is never stretched: one square viewBox into one square
 * box is a 1:1 scale in both axes.
 *
 * The numbers are hand-derived from the geometry above because path bounds
 * cannot be computed from `d` strings without an arc solver
 * (`readiness-ring`'s circle reaches its extremes mid-arc, not at a segment
 * endpoint, so an endpoint-only parser would crop the ring in half). The test
 * beside this file pins them against the one part that IS data — the ground
 * ellipse must fall inside the box — so an asset whose ground moves cannot
 * silently drift out of frame.
 *
 * This table lives beside the asset data, not beside a renderer, because both
 * platforms must frame the ten drawings identically: web's inline `<svg>` and
 * mobile's `react-native-svg` read the same crop from here.
 */
export interface IllustrationContentBox {
  /** Left edge, in viewBox units. */
  x: number;
  /** Top edge, in viewBox units. */
  y: number;
  /** Side of the square, in viewBox units. */
  side: number;
}

export const ILLUSTRATION_CONTENT_BOXES: Record<IllustrationName, IllustrationContentBox> = {
  'notes-stack': { x: 19.5, y: 27, side: 57 },
  'cards-fan': { x: 17, y: 23.5, side: 62 },
  'test-sheet': { x: 12, y: 15, side: 72 },
  'mic-wave': { x: 16, y: 19, side: 64 },
  'import-tray': { x: 15, y: 19, side: 66 },
  'readiness-ring': { x: 14.5, y: 19, side: 67 },
  'sparkles-book': { x: 10.5, y: 10, side: 75 },
  'campus-hall': { x: 15, y: 18, side: 66 },
  'download-phone': { x: 10, y: 11, side: 76 },
  'empty-inbox': { x: 19, y: 31.5, side: 58 },
};

/**
 * One viewBox unit of air on every side of the ink box.
 *
 * The boxes above are the exact bounds, so a stroke's outer edge lands ON the
 * frame; at a rasteriser's mercy that shaves a hairline off a card's corner or
 * a pediment's apex. One unit is ~1 dp at the 56 size and costs nothing worth
 * measuring — the drawing still fills ~96% of the box it is given.
 */
export const ILLUSTRATION_FRAME_MARGIN = 1;

/**
 * The `viewBox` a renderer must use for an asset: its own ink bounds plus the
 * frame margin, rather than the authored 96-square it is drawn inside.
 *
 * Platform-free on purpose — this is the whole of "how big the drawing is
 * inside its box", and it is the one answer both renderers have to give.
 */
export function illustrationViewBox(name: IllustrationName): string {
  const { x, y, side } = ILLUSTRATION_CONTENT_BOXES[name];
  const m = ILLUSTRATION_FRAME_MARGIN;
  return `${x - m} ${y - m} ${side + m * 2} ${side + m * 2}`;
}

/**
 * The room tile SCENES, which are a different asset kind on a different
 * viewBox with per-path fills. Re-exported from here because `./tileScenes`
 * is where illustration-shaped things live and this is where callers look; the
 * file itself explains why it is not an eleventh entry in `ILLUSTRATIONS`.
 */
export * from './tileScenes';
