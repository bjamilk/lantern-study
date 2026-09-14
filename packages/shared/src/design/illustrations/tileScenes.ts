// ===========================================
// Lantern Study - Room tile scenes (StudyFetch parity, SF7)
// ===========================================
//
// Twelve flat two-tone SCENES for the study room's tiles. They are NOT the ten
// spot illustrations beside them in `./index.ts`, and the difference is the
// reason they need their own record rather than a wider `Illustration`:
//
//   - `ILLUSTRATIONS` is a 96-SQUARE with exactly one filled shape (the ground
//     ellipse the caller tints) and every path stroked, never filled. It is a
//     spot drawing centred in a box.
//   - A `TileScene` is LANDSCAPE (`0 0 160 120`), because the surface it fills
//     is landscape: `RoomRecommendationCard`'s `h-32` pastel band and the
//     mobile tile's panel. It has SEVERAL filled shapes — the object bodies,
//     a cast shadow, one solid accent — so "which fill" has to be per path.
//
// Forcing these into `Illustration` would mean giving every one of the ten a
// `fill` role they do not have and a viewBox they do not use, so instead the
// asset kinds sit side by side and callers pick the one their surface wants.
//
// THE TWO COLOURS, AND ONLY TWO (the art lane's contract, `art/tiles/README.md`):
//
//   `fill`  — the object bodies. The SURFACE colour, not the pastel: an object
//             filled with the tile's own hue vanishes into it. White on the
//             pastel in light, the dark surface token in dark.
//   `shade` — the cast shadow and the one solid accent. A darker shade of the
//             tile's own hue, derived from the feature tint and ink tokens by
//             `tileSceneFills` below. No new token: it is a mix of two that
//             already exist, so it follows the theme for free.
//   strokes — `currentColor`, which the call site sets to the tile's ink,
//             exactly as `Illustration` already does.
//
// Nothing here names a light or dark value, and nothing is fetched: these are
// string literals compiled into the bundle on both platforms.

import { parseHex } from '../contrast';

/** The twelve scenes. A name not in this union is a compile error at the map. */
export type TileSceneName =
  | 'materials'
  | 'quiz'
  | 'flashcards'
  | 'lectures'
  | 'tests'
  | 'ask'
  | 'tutor'
  | 'listen'
  | 'arcade'
  | 'plan'
  | 'essay'
  | 'record';

/** Which of the two colours a path is filled with. `none` is an ink-only line. */
export type TileSceneFillRole = 'fill' | 'shade' | 'none';

export interface TileScenePath {
  /** The `d` attribute, ported verbatim from the approved draft. */
  d: string;
  fill: TileSceneFillRole;
  /**
   * Stroked in `currentColor` at `TILE_SCENE_STROKE_WIDTH`. Defaults to true —
   * only the cast shadow opts out, because a shadow with an outline is a
   * shape, not a shadow.
   */
  stroke?: boolean;
  /** An SVG transform, where the draft rotated a card rather than re-drawing it. */
  transform?: string;
}

export interface TileScene {
  viewBox: string;
  paths: readonly TileScenePath[];
}

/** Landscape, because the panel it fills is. See the note at the top. */
export const TILE_SCENE_VIEW_BOX = '0 0 160 120';

/** Same monoline weight as the spot illustrations, in viewBox units. */
export const TILE_SCENE_STROKE_WIDTH = 2;

/**
 * The most path commands any one path may carry. The scenes are drawn coarse
 * on purpose — the budget is what keeps them flat two-tone shapes rather than
 * traced artwork that would not read at 64px.
 */
export const TILE_SCENE_MAX_PATH_COMMANDS = 40;

export const TILE_SCENES: Record<TileSceneName, TileScene> = {
  materials: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M54 97 a34 6.5 0 1 0 68 0 a34 6.5 0 1 0 -68 0 Z', fill: 'shade', stroke: false },
      { d: 'M70 18 h36 a4 4 0 0 1 4 4 v54 h-40 z', fill: 'fill' },
      { d: 'M63 25 h36 a4 4 0 0 1 4 4 v54 h-40 z', fill: 'fill' },
      { d: 'M52 32 h40 a4 4 0 0 1 4 4 v36 l-16 16 h-28 a4 4 0 0 1 -4 -4 v-48 a4 4 0 0 1 4 -4 z', fill: 'fill' },
      { d: 'M96 72 h-12 a4 4 0 0 0 -4 4 v12', fill: 'none' },
      { d: 'M60 46 h28', fill: 'none' },
      { d: 'M60 56 h28', fill: 'none' },
      { d: 'M60 66 h16', fill: 'none' },
    ],
  },
  quiz: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M56 99 a32 6.5 0 1 0 64 0 a32 6.5 0 1 0 -64 0 Z', fill: 'shade', stroke: false },
      { d: 'M56 16 h46 a4 4 0 0 1 4 4 v70 a4 4 0 0 1 -4 4 h-46 a4 4 0 0 1 -4 -4 v-70 a4 4 0 0 1 4 -4 z', fill: 'fill' },
      { d: 'M67 30 H74 A3 3 0 0 1 77 33 V40 A3 3 0 0 1 74 43 H67 A3 3 0 0 1 64 40 V33 A3 3 0 0 1 67 30 Z', fill: 'fill' },
      { d: 'M67 50 H74 A3 3 0 0 1 77 53 V60 A3 3 0 0 1 74 63 H67 A3 3 0 0 1 64 60 V53 A3 3 0 0 1 67 50 Z', fill: 'fill' },
      { d: 'M67 70 H74 A3 3 0 0 1 77 73 V80 A3 3 0 0 1 74 83 H67 A3 3 0 0 1 64 80 V73 A3 3 0 0 1 67 70 Z', fill: 'fill' },
      { d: 'M67.5 36.5 l3 3 l5.5 -6', fill: 'none' },
      { d: 'M67.5 56.5 l3 3 l5.5 -6', fill: 'none' },
      { d: 'M67.5 76.5 l3 3 l5.5 -6', fill: 'none' },
      { d: 'M85 36 h14', fill: 'none' },
      { d: 'M85 56 h14', fill: 'none' },
      { d: 'M85 76 h10', fill: 'none' },
    ],
  },
  flashcards: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M52 92 a34 6.5 0 1 0 68 0 a34 6.5 0 1 0 -68 0 Z', fill: 'shade', stroke: false },
      { d: 'M30 28 H66 A4 4 0 0 1 70 32 V56 A4 4 0 0 1 66 60 H30 A4 4 0 0 1 26 56 V32 A4 4 0 0 1 30 28 Z', fill: 'fill', transform: 'rotate(-12 48 44)' },
      { d: 'M96 24 H130 A4 4 0 0 1 134 28 V50 A4 4 0 0 1 130 54 H96 A4 4 0 0 1 92 50 V28 A4 4 0 0 1 96 24 Z', fill: 'fill', transform: 'rotate(11 113 39)' },
      { d: 'M58 44 H102 A4 4 0 0 1 106 48 V78 A4 4 0 0 1 102 82 H58 A4 4 0 0 1 54 78 V48 A4 4 0 0 1 58 44 Z', fill: 'fill', transform: 'rotate(-3 80 63)' },
      { d: 'M34 40 h18', fill: 'none', transform: 'rotate(-12 48 44)' },
      { d: 'M34 48 h12', fill: 'none', transform: 'rotate(-12 48 44)' },
      { d: 'M100 36 h18', fill: 'none', transform: 'rotate(11 113 39)' },
      { d: 'M73 55 a7 7 0 1 1 7 7 v3', fill: 'none' },
      { d: 'M80 69 v1', fill: 'none' },
    ],
  },
  lectures: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M57 98 a27 6 0 1 0 54 0 a27 6 0 1 0 -54 0 Z', fill: 'shade', stroke: false },
      { d: 'M76 16 A10 10 0 0 1 86 26 V40 A10 10 0 0 1 76 50 A10 10 0 0 1 66 40 V26 A10 10 0 0 1 76 16 Z', fill: 'fill' },
      { d: 'M60 86 a16 5 0 1 0 32 0 a16 5 0 1 0 -32 0 Z', fill: 'fill' },
      { d: 'M70 26 h12', fill: 'none' },
      { d: 'M70 33 h12', fill: 'none' },
      { d: 'M70 40 h12', fill: 'none' },
      { d: 'M58 44 a18 18 0 0 0 36 0', fill: 'none' },
      { d: 'M76 62 v22', fill: 'none' },
      { d: 'M106 32 a18 18 0 0 1 0 26', fill: 'none' },
      { d: 'M118 24 a28 28 0 0 1 0 42', fill: 'none' },
    ],
  },
  tests: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M54 99 a30 6 0 1 0 60 0 a30 6 0 1 0 -60 0 Z', fill: 'shade', stroke: false },
      { d: 'M50 22 h44 a4 4 0 0 1 4 4 v62 a4 4 0 0 1 -4 4 h-44 a4 4 0 0 1 -4 -4 v-62 a4 4 0 0 1 4 -4 z', fill: 'fill' },
      { d: 'M65 14 H79 A3 3 0 0 1 82 17 V24 A3 3 0 0 1 79 27 H65 A3 3 0 0 1 62 24 V17 A3 3 0 0 1 65 14 Z', fill: 'fill' },
      { d: 'M118 34 l10 10 l-28 28 l-14 4 l4 -14 z', fill: 'fill' },
      { d: 'M56 44 h26', fill: 'none' },
      { d: 'M56 56 h26', fill: 'none' },
      { d: 'M56 68 h16', fill: 'none' },
      { d: 'M112 40 l10 10', fill: 'none' },
      { d: 'M90 62 l10 10', fill: 'none' },
    ],
  },
  ask: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M54 99 a32 6.5 0 1 0 64 0 a32 6.5 0 1 0 -64 0 Z', fill: 'shade', stroke: false },
      { d: 'M34 18 h58 a6 6 0 0 1 6 6 v30 a6 6 0 0 1 -6 6 h-34 l-14 12 v-12 h-10 a6 6 0 0 1 -6 -6 v-30 a6 6 0 0 1 6 -6 z', fill: 'fill' },
      { d: 'M88 46 h26 a6 6 0 0 1 6 6 v22 a6 6 0 0 1 -6 6 h-2 v10 l-12 -10 h-12 a6 6 0 0 1 -6 -6 v-22 a6 6 0 0 1 6 -6 z', fill: 'fill' },
      { d: 'M44 32 h38', fill: 'none' },
      { d: 'M44 44 h24', fill: 'none' },
      { d: 'M94 64 v1', fill: 'none' },
      { d: 'M102 64 v1', fill: 'none' },
      { d: 'M110 64 v1', fill: 'none' },
    ],
  },
  tutor: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M44 96 a38 6 0 1 0 76 0 a38 6 0 1 0 -76 0 Z', fill: 'shade', stroke: false },
      { d: 'M78 32 c-10 -8 -22 -10 -32 -8 v44 c10 -2 22 0 32 8 z', fill: 'fill' },
      { d: 'M78 32 c10 -8 22 -10 32 -8 v44 c-10 -2 -22 0 -32 8 z', fill: 'fill' },
      { d: 'M126 18 c1.5 7 3.5 9 10.5 10.5 c-7 1.5 -9 3.5 -10.5 10.5 c-1.5 -7 -3.5 -9 -10.5 -10.5 c7 -1.5 9 -3.5 10.5 -10.5 z', fill: 'fill' },
      { d: 'M78 32 v44', fill: 'none' },
      { d: 'M54 40 h16', fill: 'none' },
      { d: 'M54 50 h16', fill: 'none' },
      { d: 'M86 40 h16', fill: 'none' },
      { d: 'M86 50 h16', fill: 'none' },
    ],
  },
  listen: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M30 98 a36 6 0 1 0 72 0 a36 6 0 1 0 -72 0 Z', fill: 'shade', stroke: false },
      { d: 'M30.5 58 A8.5 8.5 0 0 1 39 66.5 V77.5 A8.5 8.5 0 0 1 30.5 86 A8.5 8.5 0 0 1 22 77.5 V66.5 A8.5 8.5 0 0 1 30.5 58 Z', fill: 'fill' },
      { d: 'M92.5 58 A8.5 8.5 0 0 1 101 66.5 V77.5 A8.5 8.5 0 0 1 92.5 86 A8.5 8.5 0 0 1 84 77.5 V66.5 A8.5 8.5 0 0 1 92.5 58 Z', fill: 'fill' },
      { d: 'M30 64 v-14 a31 31 0 0 1 62 0 v14', fill: 'none' },
      { d: 'M112 62 v16', fill: 'none' },
      { d: 'M121 52 v36', fill: 'none' },
      { d: 'M130 58 v24', fill: 'none' },
      { d: 'M139 66 v8', fill: 'none' },
    ],
  },
  arcade: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M42 94 a42 6.5 0 1 0 84 0 a42 6.5 0 1 0 -84 0 Z', fill: 'shade', stroke: false },
      { d: 'M46 36 h68 a19 19 0 0 1 15 30 l-8 11 a10 10 0 0 1 -16 -1 l-6 -8 h-38 l-6 8 a10 10 0 0 1 -16 1 l-8 -11 a19 19 0 0 1 15 -30 z', fill: 'fill' },
      { d: 'M99.5 54 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0 Z', fill: 'shade' },
      { d: 'M111.5 64 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0 Z', fill: 'fill' },
      { d: 'M56 58 h18', fill: 'none' },
      { d: 'M65 49 v18', fill: 'none' },
    ],
  },
  plan: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M44 99 a34 6 0 1 0 68 0 a34 6 0 1 0 -68 0 Z', fill: 'shade', stroke: false },
      { d: 'M36 24 h72 a5 5 0 0 1 5 5 v52 a5 5 0 0 1 -5 5 h-72 a5 5 0 0 1 -5 -5 v-52 a5 5 0 0 1 5 -5 z', fill: 'fill' },
      { d: 'M101 78 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0 Z', fill: 'fill' },
      { d: 'M31 42 h82', fill: 'none' },
      { d: 'M52 16 v14', fill: 'none' },
      { d: 'M92 16 v14', fill: 'none' },
      { d: 'M46 56 v1', fill: 'none' },
      { d: 'M62 56 v1', fill: 'none' },
      { d: 'M78 56 v1', fill: 'none' },
      { d: 'M46 70 v1', fill: 'none' },
      { d: 'M62 70 v1', fill: 'none' },
      { d: 'M118 67 a11 11 0 1 1 -7.8 3.2', fill: 'none' },
    ],
  },
  essay: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M48 99 a34 6 0 1 0 68 0 a34 6 0 1 0 -68 0 Z', fill: 'shade', stroke: false },
      { d: 'M38 18 h58 a5 5 0 0 1 5 5 v62 a5 5 0 0 1 -5 5 h-58 a5 5 0 0 1 -5 -5 v-62 a5 5 0 0 1 5 -5 z', fill: 'fill' },
      { d: 'M124 20 l14 14 l-38 38 l-18 4 l4 -18 z', fill: 'fill' },
      { d: 'M46 32 h42', fill: 'none' },
      { d: 'M46 44 h42', fill: 'none' },
      { d: 'M46 56 h30', fill: 'none' },
      { d: 'M116 28 l14 14', fill: 'none' },
      { d: 'M86 62 l10 10', fill: 'none' },
      { d: 'M82 76 l7 -7', fill: 'none' },
    ],
  },
  record: {
    viewBox: '0 0 160 120',
    paths: [
      { d: 'M53 98 a27 6 0 1 0 54 0 a27 6 0 1 0 -54 0 Z', fill: 'shade', stroke: false },
      { d: 'M73 16 A11 11 0 0 1 84 27 V43 A11 11 0 0 1 73 54 A11 11 0 0 1 62 43 V27 A11 11 0 0 1 73 16 Z', fill: 'fill' },
      { d: 'M57 86 a16 5 0 1 0 32 0 a16 5 0 1 0 -32 0 Z', fill: 'fill' },
      { d: 'M112 34 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 Z', fill: 'shade' },
      { d: 'M66 26 h14', fill: 'none' },
      { d: 'M66 34 h14', fill: 'none' },
      { d: 'M66 42 h14', fill: 'none' },
      { d: 'M54 48 a19 19 0 0 0 38 0', fill: 'none' },
      { d: 'M73 67 v14', fill: 'none' },
      { d: 'M106 34 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 Z', fill: 'none' },
    ],
  },
};

export const TILE_SCENE_NAMES = Object.keys(TILE_SCENES) as TileSceneName[];

/* -------------------------------------------------------------- the mapping */

/**
 * The tool ids that have a scene.
 *
 * These are `StudySetHomeToolId`s, but the union is spelled out here rather
 * than imported: `design` is the leaf both platforms' theming sits on, and
 * making it depend on `learning` would invert that. The two are held together
 * by tests at the call sites instead — mobile asserts this covers every
 * `SET_ROOM_TILE_ID`, web asserts every `OWN_WAY_TOOL_ORDER` id either has a
 * scene or is one of the two that deliberately does not.
 */
export type TileSceneToolId =
  | 'import'
  | 'quiz'
  | 'cards'
  | 'lecture'
  | 'test'
  | 'ask'
  | 'lesson'
  | 'recap'
  | 'play'
  | 'plan'
  | 'essay';

/**
 * Tool id -> scene. The ids are the product's; the scene names are the art's,
 * and they do not always match (`import` is drawn as `materials`, `lesson` as
 * `tutor`, `recap` as `listen`, `play` as `arcade`), which is exactly why this
 * table exists instead of a string cast.
 *
 * NOT HERE: `notes` and `walkthrough`. They are web-only ids in
 * `OWN_WAY_TOOL_ORDER` with no scene in the approved set, so they keep their
 * `AppIcon` until someone decides they are rooms. Their absence is asserted,
 * so adding art for them is a deliberate diff rather than a silent fallback.
 */
export const TILE_SCENE_FOR_TOOL: Record<TileSceneToolId, TileSceneName> = {
  import: 'materials',
  quiz: 'quiz',
  cards: 'flashcards',
  lecture: 'lectures',
  test: 'tests',
  ask: 'ask',
  lesson: 'tutor',
  recap: 'listen',
  play: 'arcade',
  plan: 'plan',
  essay: 'essay',
};

/**
 * The scene for a tool id, or `undefined` where that id has no art.
 *
 * Takes a plain string so a call site can hand it any tool id without first
 * narrowing: "does this door have a picture" is the question, and `undefined`
 * is a real answer that the renderers fall back to a glyph on.
 */
export function tileSceneForTool(toolId: string): TileSceneName | undefined {
  return (TILE_SCENE_FOR_TOOL as Record<string, TileSceneName | undefined>)[toolId];
}

/* ---------------------------------------------------------------- the fills */

/**
 * How much of the feature's INK is mixed into its TINT to make the shade.
 *
 * One number, shared, because web mixes in CSS (`color-mix(in srgb, ...)`) and
 * mobile mixes in TypeScript — two implementations of the same formula, and
 * `color-mix` in the sRGB space is the same plain channel average `mixHex` is,
 * so the two platforms land on the same colour rather than drifting a shade
 * apart. Picked so the shadow is a clear step off the pastel without reading
 * as a second object; `tileScenes.test.ts` pins that as a contrast band rather
 * than as a hex, so a token can move without silently flattening the shadow.
 */
export const TILE_SHADE_INK_MIX = 0.26;

/**
 * Channel-average two hex colours. `t` is how much of `b` ends up in the
 * result. Uses `parseHex` from the contrast module beside this one, so there
 * is one hex parser in the design system and not two.
 */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/**
 * The two colours a scene is drawn in, as data.
 *
 * Pure, and beside the geometry rather than in a renderer, for the same reason
 * `illustrationFills` is: the interesting decision here is "what is the shade",
 * and it has to be assertable without mounting anything. Mobile calls this
 * with the live theme; web spells the same formula as `color-mix` over the CSS
 * variables so the browser re-derives it when the theme flips.
 */
export function tileSceneFills({
  tint,
  ink,
  surface,
}: {
  /** The feature's tint — the pastel the tile panel is painted. */
  tint: string;
  /** The feature's ink, which is also what the strokes are drawn in. */
  ink: string;
  /** The theme's surface: white in light, the near-black card in dark. */
  surface: string;
}): { fill: string; shade: string } {
  return { fill: surface, shade: mixHex(tint, ink, TILE_SHADE_INK_MIX) };
}
