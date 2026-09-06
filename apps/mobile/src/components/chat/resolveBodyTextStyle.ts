/**
 * The one place chat/board message bodies get their size, and the one place
 * meta ink (timestamps, "edited", "Sending…") is checked for contrast.
 *
 * Why this exists: `installFontScale.tsx` swaps React Native's `Text` export so
 * the in-app font-size setting can scale every string. That swap stamps
 * `fontSize: round(14 * fontScale)` on any Text with no explicit size, which is
 * exactly what a nested `<Text>` span inside a message body is — so mention
 * spans stopped inheriting their parent's resolved size and the body rendered
 * at RN's 14 sp default instead of the class it was given. The fix is to resolve
 * the size ONCE per body here and pass the resolved style down to every span
 * explicitly, rather than relying on inheritance the swap cannot preserve.
 *
 * Pure by design: no React, no react-native, no stores — so it is unit-testable
 * and the sizes can be asserted at several font scales.
 */

import { MIN_FONT_SIZE, typeScale, type TypeStep, type TypeStepName } from '../../design/typeScale';

export type { TypeStep, TypeStepName };

export interface ResolvedTextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: TypeStep['fontWeight'];
  letterSpacing: number;
}

/**
 * The steps chat surfaces use, named so a call site reads as a decision. They
 * are the shared six-step scale — this module does not invent sizes, it only
 * resolves them at the current font scale.
 */
export const CHAT_TYPE_STEPS = {
  /** All message prose. */
  body: typeScale.body,
  /** Secondary lines inside a bubble. */
  caption: typeScale.caption,
  /** Timestamps, badges, delivery state. */
  label: typeScale.label,
} as const;

export type ChatTypeStepName = keyof typeof CHAT_TYPE_STEPS;

const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeScale(fontScale: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 0) return 1;
  return clamp(fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
}

/**
 * Resolve a type step at the current app font scale.
 *
 * The returned style is FINAL — it must be handed to an unpatched Text (see
 * `RawText` in `installFontScale.tsx`), because the patched export would scale
 * the already-scaled size a second time.
 */
export function resolveBodyTextStyle(
  fontScale: number,
  step: ChatTypeStepName | TypeStep = 'body'
): ResolvedTextStyle {
  const base: TypeStep = typeof step === 'string' ? CHAT_TYPE_STEPS[step] : step;
  const scale = sanitizeScale(fontScale);
  const fontSize = Math.max(MIN_FONT_SIZE, Math.round(base.fontSize * scale));
  // Keep leading readable when the 11 sp floor lifts a small step: never let a
  // scaled line box collapse onto the glyphs.
  const lineHeight = Math.max(Math.round(base.lineHeight * scale), fontSize + 4);
  // Tracking is points in React Native, so it scales with the text.
  const letterSpacing = Number(((base.letterSpacing ?? 0) * scale).toFixed(2));
  return { fontSize, lineHeight, fontWeight: base.fontWeight, letterSpacing };
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio. Returns 1 for anything unparseable (fail closed). */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return 1;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

export const AA_NORMAL_TEXT = 4.5;

/**
 * Inks tried, in order, when the themed meta colour fails AA on the bubble it
 * sits on. `#54656f` clears 5.46:1 on the light own-bubble green (`#d9fdd3`);
 * `#d7e3e8` clears 6.09:1 on the dark one (`#005c4b`). Both are drawn from the
 * same muted-slate family the chat surface already uses, so nothing changes
 * character — only the two failing pairs move.
 */
export const META_INK_FALLBACKS = ['#54656f', '#3f5560', '#d7e3e8', '#ffffff'] as const;

/**
 * Pick meta ink that clears AA on `background`.
 *
 * The themed `chatBubbleMeta` measured 4.19:1 on the light own-bubble green and
 * 4.26:1 on the dark one — the smallest text in the app carrying the worst
 * contrast. This keeps the token wherever it passes and substitutes only where
 * it does not, so the fix cannot silently rot if the token changes.
 */
export function resolveMetaTextColor(
  background: string,
  preferred: string,
  fallbacks: readonly string[] = META_INK_FALLBACKS,
  minRatio: number = AA_NORMAL_TEXT
): string {
  if (contrastRatio(preferred, background) >= minRatio) return preferred;
  let best = preferred;
  let bestRatio = contrastRatio(preferred, background);
  for (const candidate of fallbacks) {
    const ratio = contrastRatio(candidate, background);
    if (ratio >= minRatio) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
