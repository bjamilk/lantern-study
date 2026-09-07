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
 * Hover border for a door tile. At rest a feature card is neutral (§5.6:
 * "hue = identity, at rest, in tints" — the tint is in the band, not the
 * outline), so the ink only appears on pointer focus.
 */
