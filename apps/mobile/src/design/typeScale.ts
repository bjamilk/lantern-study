/**
 * The six-step mobile type scale (Wave T).
 *
 * One role per step, nothing below 11 sp (Material's floor — the app used to
 * set six strings at 9 sp). Sizes are PIXELS, not rem: NativeWind inlines rem
 * at 14 here, so `text-sm` was 12.25 sp and the whole Tailwind ladder ran a
 * step small. Expressing the scale in px makes `text-body` the same number on
 * mobile and web.
 *
 * `letterSpacing` in React Native is points, not em, so each tracking value
 * below is the spec's em figure multiplied by that step's size:
 *   display/title -0.02em, heading/body -0.011em, caption 0, label +0.04em.
 *
 * Font-scale (the appearance setting and OS Dynamic Type) is applied on top of
 * these by theme/installFontScale.tsx, which rescales any `fontSize` it finds
 * on a Text style — so a step spread into a StyleSheet still scales.
 *
 * Four lints guard the mobile design system (`npx jest src/design`). Each states
 * its own rule in full at the top of its file; in short:
 *   - typeScaleLint.test.ts — no NEW raw sizes. Every file's remaining count is
 *     budgeted in typeScaleAllowlist.ts (scan in typeScaleSources.ts). On
 *     failure, migrate the file to `text-body` / `<T.Body>`; never raise a
 *     number, and delete a row rather than editing it to zero.
 *   - typeFloorLint.test.ts — absolute 11 sp floor, no allowlist. On failure use
 *     `typeScale.label` / `text-label`, not a smaller step.
 *   - tailwindFeatureColors.test.ts — every feature colour in
 *     tailwind.config.js must stay an object carrying `ink` and `tint` (a
 *     duplicate bare-string key later in the literal silently wins and the
 *     `-ink`/`-tint` classes stop being generated).
 *   - flashcardGradeSkinContrast.test.ts — the four grade chips in
 *     flashcardGradeSkin.ts must meet AA in both palettes. Fix the skin, which
 *     is the single source both graders read.
 */
import type { TextStyle } from 'react-native';

export type TypeStepName = 'display' | 'title' | 'heading' | 'body' | 'caption' | 'label';

export interface TypeStep {
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle['fontWeight'];
  letterSpacing: number;
}

export const typeScale: Record<TypeStepName, TypeStep> = {
  /** Hero greeting, score numeral. */
  display: { fontSize: 28, lineHeight: 36, fontWeight: '500', letterSpacing: 0 },
  /** Every screen h1, modal title, section head. */
  title: { fontSize: 24, lineHeight: 32, fontWeight: '500', letterSpacing: 0 },
  /** Section eyebrow, card title, flashcard face. */
  heading: { fontSize: 18, lineHeight: 28, fontWeight: '500', letterSpacing: 0 },
  /** All prose, buttons, labels, chat, list titles. */
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0 },
  /** Meta: secondary copy, timestamps, stat labels. */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0 },
  /** Uppercase eyebrows, badges, tab labels. The floor: never go below this. */
  label: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.44 },
};

/** The smallest size any string in the app may use. */
export const MIN_FONT_SIZE = typeScale.label.fontSize;

/** Numerals that sit in a column or tick up in place must not jitter. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };
