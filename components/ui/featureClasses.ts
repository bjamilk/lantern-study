import { TILE_SHADE_INK_MIX, type FeatureKey } from '@lantern/shared/design';

/**
 * Tailwind cannot build a class name at runtime — `text-lantern-feature-${key}-ink`
 * compiles to nothing and, worse, fails silently. Every feature-accented class
 * this app uses is therefore spelled out once, here, so the scanner sees it and
 * so every screen reads the same pair from the same table.
 *
 * The values behind these classes are `--color-feature-<key>-ink/-tint`
 * (index.css `:root` and `.dark`), which are `featureAccentsLight` /
 * `featureAccentsDark` from `packages/shared/src/design/tokens.ts`. Both themes
 * come free: the class is the same, the variable changes.
 */

export type { FeatureKey };

/** Feature ink as a text/glyph colour. */
export const FEATURE_INK_TEXT: Record<FeatureKey, string> = {
  notes: 'text-lantern-feature-notes-ink',
  flashcards: 'text-lantern-feature-flashcards-ink',
  tests: 'text-lantern-feature-tests-ink',
  recording: 'text-lantern-feature-recording-ink',
  ai: 'text-lantern-feature-ai-ink',
  groups: 'text-lantern-feature-groups-ink',
  campus: 'text-lantern-feature-campus-ink',
  budget: 'text-lantern-feature-budget-ink',
  sets: 'text-lantern-feature-sets-ink',
};

/** Feature tint as a background — discs, hero bands, empty-state panels. */
export const FEATURE_TINT_BG: Record<FeatureKey, string> = {
  notes: 'bg-lantern-feature-notes-tint',
  flashcards: 'bg-lantern-feature-flashcards-tint',
  tests: 'bg-lantern-feature-tests-tint',
  recording: 'bg-lantern-feature-recording-tint',
  ai: 'bg-lantern-feature-ai-tint',
  groups: 'bg-lantern-feature-groups-tint',
  campus: 'bg-lantern-feature-campus-tint',
  budget: 'bg-lantern-feature-budget-tint',
  sets: 'bg-lantern-feature-sets-tint',
};

/** Feature ink as a 4 px rail / progress fill on a dense row. */
export const FEATURE_INK_BG: Record<FeatureKey, string> = {
  notes: 'bg-lantern-feature-notes-ink',
  flashcards: 'bg-lantern-feature-flashcards-ink',
  tests: 'bg-lantern-feature-tests-ink',
  recording: 'bg-lantern-feature-recording-ink',
  ai: 'bg-lantern-feature-ai-ink',
  groups: 'bg-lantern-feature-groups-ink',
  campus: 'bg-lantern-feature-campus-ink',
  budget: 'bg-lantern-feature-budget-ink',
  sets: 'bg-lantern-feature-sets-ink',
};

/**
 * Feature tint as an SVG `fill` — the one filled shape in a spot illustration
 * (§5.6: "monoline stroke 2 in currentColor plus one tint-filled ground
 * ellipse"). Spelled out for the same reason as the tables above: Tailwind
 * cannot build `fill-lantern-feature-${key}-tint` at runtime.
 */
export const FEATURE_TINT_FILL: Record<FeatureKey, string> = {
  notes: 'fill-lantern-feature-notes-tint',
  flashcards: 'fill-lantern-feature-flashcards-tint',
  tests: 'fill-lantern-feature-tests-tint',
  recording: 'fill-lantern-feature-recording-tint',
  ai: 'fill-lantern-feature-ai-tint',
  groups: 'fill-lantern-feature-groups-tint',
  campus: 'fill-lantern-feature-campus-tint',
  budget: 'fill-lantern-feature-budget-tint',
  sets: 'fill-lantern-feature-sets-tint',
};

/**
 * The glyph drawn ON a pastel panel — a hub tile's illustration, a type-icon
 * tile, a door's picture. StudyFetch sets these in flat black, which is right
 * on a pastel and wrong on the near-black that same panel becomes in dark
 * mode, so the class pairs the theme's strong ink with the feature's own ink
 * as the dark fallback. `--color-ink` already inverts, but on a dark TINT the
 * feature ink is the hue-carrying choice and the near-white is not.
 */
export const FEATURE_PANEL_INK_TEXT: Record<FeatureKey, string> = {
  notes: 'text-lantern-ink dark:text-lantern-feature-notes-ink',
  flashcards: 'text-lantern-ink dark:text-lantern-feature-flashcards-ink',
  tests: 'text-lantern-ink dark:text-lantern-feature-tests-ink',
  recording: 'text-lantern-ink dark:text-lantern-feature-recording-ink',
  ai: 'text-lantern-ink dark:text-lantern-feature-ai-ink',
  groups: 'text-lantern-ink dark:text-lantern-feature-groups-ink',
  campus: 'text-lantern-ink dark:text-lantern-feature-campus-ink',
  budget: 'text-lantern-ink dark:text-lantern-feature-budget-ink',
  sets: 'text-lantern-ink dark:text-lantern-feature-sets-ink',
};

/**
 * The same pairing as `FEATURE_PANEL_INK_TEXT`, as an `!important` override.
 *
 * `Illustration` sets its own `FEATURE_INK_TEXT[feature]` on the `<svg>` and
 * appends the caller's `className` after it. Two `text-*` utilities of equal
 * specificity are resolved by stylesheet ORDER, not by which one the markup
 * names last, so a plain class here would win or lose depending on how
 * Tailwind happened to sort its output that build. The `!` makes the override
 * deterministic — which matters, because losing it silently repaints every
 * door's drawing from black to a mid-tone hue on its own pastel.
 */
export const FEATURE_PANEL_INK_OVERRIDE: Record<FeatureKey, string> = {
  notes: '!text-lantern-ink dark:!text-lantern-feature-notes-ink',
  flashcards: '!text-lantern-ink dark:!text-lantern-feature-flashcards-ink',
  tests: '!text-lantern-ink dark:!text-lantern-feature-tests-ink',
  recording: '!text-lantern-ink dark:!text-lantern-feature-recording-ink',
  ai: '!text-lantern-ink dark:!text-lantern-feature-ai-ink',
  groups: '!text-lantern-ink dark:!text-lantern-feature-groups-ink',
  campus: '!text-lantern-ink dark:!text-lantern-feature-campus-ink',
  budget: '!text-lantern-ink dark:!text-lantern-feature-budget-ink',
  sets: '!text-lantern-ink dark:!text-lantern-feature-sets-ink',
};

/**
 * The two CSS variables a `TileScene` is painted with, per feature.
 *
 * These are CUSTOM PROPERTIES, not Tailwind utilities, so they are set as an
 * inline style rather than a class — which is also why building them at
 * runtime would be safe here. They are spelled out anyway, for the same reason
 * every table above is: a grep for a feature's name has to find every place
 * its colour is decided.
 *
 * `--tile-fill` is the SURFACE, never the tile's own pastel: a white sheet on
 * a pastel ground is the whole look, and a sheet filled with the ground's own
 * hue is invisible. `--color-surface` already inverts under `.dark`, so the
 * dark panel gets the dark card colour with no second table.
 *
 * `--tile-shade` is the cast shadow: the feature's tint carried
 * `TILE_SHADE_INK_MIX` of the way toward its own ink, so the shadow keeps the
 * tile's hue instead of going grey. It is `color-mix` rather than a token
 * because a token would have to be authored twice per feature per theme —
 * eighteen new values for a colour that is entirely derivable. Mobile derives
 * the same colour arithmetically through `tileSceneFills`, and `color-mix` in
 * sRGB is the same channel average, so the two platforms agree.
 *
 * Both variables are re-derived by the browser when `.dark` flips, because
 * both sides of the mix are theme variables. Nothing here is theme-specific.
 */
const TILE_SHADE_TINT_PERCENT = Math.round((1 - TILE_SHADE_INK_MIX) * 100);
const TILE_SHADE_INK_PERCENT = 100 - TILE_SHADE_TINT_PERCENT;

function tileSceneVars(key: FeatureKey): Record<string, string> {
  return {
    '--tile-fill': 'rgb(var(--color-surface))',
    '--tile-shade': `color-mix(in srgb, rgb(var(--color-feature-${key}-tint)) ${TILE_SHADE_TINT_PERCENT}%, rgb(var(--color-feature-${key}-ink)) ${TILE_SHADE_INK_PERCENT}%)`,
  };
}

export const FEATURE_TILE_SCENE_VARS: Record<FeatureKey, Record<string, string>> = {
  notes: tileSceneVars('notes'),
  flashcards: tileSceneVars('flashcards'),
  tests: tileSceneVars('tests'),
  recording: tileSceneVars('recording'),
  ai: tileSceneVars('ai'),
  groups: tileSceneVars('groups'),
  campus: tileSceneVars('campus'),
  budget: tileSceneVars('budget'),
  sets: tileSceneVars('sets'),
};
