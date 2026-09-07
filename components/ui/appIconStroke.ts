/**
 * How heavy an icon's outline is drawn, by its size. This is THE ramp — the
 * one place the web app's icon weight is decided, and a byte-for-byte port of
 * apps/mobile/src/components/ui/appIconStroke.ts so the two platforms draw the
 * same glyph at the same weight.
 *
 * lucide draws on a 24px grid at stroke 2 and scales the stroke down with the
 * icon, so a 14px glyph lands at ~1.17px: a hairline, which is exactly the
 * "their outline feels too thin" complaint. We compensate by going HEAVIER as
 * the icon gets smaller, and lighter on the big decorative glyphs where 2.5
 * would read like a marker pen.
 *
 * This replaces the flat `svg[data-slot="icon"] { stroke-width: 1.85 }` rule
 * in index.css, which lifted every heroicon by the same amount regardless of
 * how large it was drawn. That rule stays only while heroicons are still on
 * screen; see heroiconsMigration.ts.
 *
 * Pure and import-free so it can be unit-tested; AppIcon.tsx is the only
 * consumer and re-exports it.
 */
export function strokeWidthForSize(size: number): number {
  if (size <= 14) return 2.5;
  if (size <= 20) return 2.25;
  if (size <= 28) return 2.1;
  return 1.9;
}

/** lucide's own default, for comparison. Every step of the ramp beats it. */
export const LUCIDE_DEFAULT_STROKE_WIDTH = 2;
