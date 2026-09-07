import type { FeatureKey } from '@lantern/shared/design';

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
};
