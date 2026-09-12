/**
 * The two type families, and the one rule about which string gets which.
 *
 * SANS is everything a student reads or types — body copy, list titles, chat,
 * labels. It is the platform's own face, so it renders at the weight the OS
 * hinted it for and costs nothing to load.
 *
 * SERIF is for DISPLAY only: the `display` and `title` steps, which is the
 * greeting on a hub, a screen's h1 and a bottom sheet's heading. Nothing
 * smaller is ever set in it — a serif at the 15 sp body step on a 420 dpi
 * phone loses its brackets and reads as a blurred sans.
 *
 * The face is Bitter (SIL Open Font License 1.1; the licence ships beside the
 * files in assets/fonts/OFL.txt). Upstream now publishes Bitter only as a
 * variable font, so the two static faces in assets/fonts are instances cut
 * from `ofl/bitter/Bitter[wght].ttf` at wght=400 and wght=600, with their name
 * records and `usWeightClass` set and the variation tables dropped — React
 * Native cannot drive a `wght` axis, so a variable TTF would have rendered
 * every heading at one weight.
 *
 * WHY TWO FAMILY NAMES AND NOT ONE FAMILY WITH `fontWeight`. Android resolves
 * a bundled font by FAMILY NAME alone; a `fontWeight: '600'` against a
 * single-face family is silently dropped, which is how a "semibold" heading
 * ships at regular on every Android phone and correct on every iPhone. So each
 * weight is its own family here and `fontWeight` is never set beside it.
 *
 * The files are embedded by the `expo-font` config plugin (app.config.ts), so
 * they arrive in the binary rather than being fetched at boot — there is no
 * loading state and no frame of fallback type. That also means a face only
 * exists after the next NATIVE build: an older binary falls back to the system
 * face, which is why nothing about the layout depends on the serif's metrics.
 */
import { Platform } from 'react-native';
import type { TextStyle } from 'react-native';

/** The embedded display faces, by the family name `expo-font` registers. */
export const SERIF_FAMILIES = {
  regular: 'Bitter-Regular',
  semibold: 'Bitter-SemiBold',
} as const;

export type SerifWeight = keyof typeof SERIF_FAMILIES;

/**
 * The platform's own serif, used ONLY as the last resort — it is what a binary
 * built before the fonts landed will draw anyway. Stated rather than left
 * implicit so the intent survives: when Bitter is missing the heading should
 * still be a serif if the platform has one.
 */
export const PLATFORM_SERIF = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
}) as string;

/**
 * The family a display string is set in.
 *
 * Returns a bare family name, never a stack: React Native's `fontFamily` takes
 * one family and ignores a comma list on Android.
 */
export function serifFamily(weight: SerifWeight = 'semibold'): string {
  return SERIF_FAMILIES[weight];
}

/**
 * The style to spread onto a `display` or `title` step.
 *
 * `fontWeight` is deliberately set to `'normal'` rather than left alone: the
 * type scale carries `fontWeight: '700'` for both display steps, and on iOS a
 * 700 against a single-weight custom family synthesises a smeared faux-bold on
 * top of a face that is already semibold. The weight lives in the family name.
 */
export function serifDisplayStyle(weight: SerifWeight = 'semibold'): TextStyle {
  return { fontFamily: serifFamily(weight), fontWeight: 'normal' };
}
