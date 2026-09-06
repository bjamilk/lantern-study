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
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.56 },
  /** Every screen h1, modal title. */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.44 },
  /** Section h2, card title, flashcard face. */
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: -0.187 },
  /** All prose, chat, list titles. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: -0.165 },
  /** Secondary copy, timestamps, stat labels. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  /** Uppercase eyebrows, badges, tab labels. The floor: never go below this. */
  label: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.44 },
};

/** The smallest size any string in the app may use. */
export const MIN_FONT_SIZE = typeScale.label.fontSize;

/** Numerals that sit in a column or tick up in place must not jitter. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };
