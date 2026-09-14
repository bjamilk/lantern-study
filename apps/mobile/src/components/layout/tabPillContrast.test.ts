/**
 * Contrast gate for the bottom bar's HUGGING PILL (BottomTabBar.tsx and the
 * set row in ContextualBar.tsx).
 *
 * WHY THIS FILE EXISTS NOW. Until 2026-09-13 the lit tab's word was an 11 sp
 * `label` step and every idle tab carried one too, so the pill's word was one
 * of five and no single string was load-bearing. It is now the ONLY word on the
 * bar: four destinations are nameless glyphs, and the fifth names itself in
 * `textInverse` on `primaryFill`. If that pair ever fell under AA the bar would
 * have no readable text at all.
 *
 * Three things are measured, in both palettes, under high contrast and under
 * every accent a student can pick — the same rewrites ThemeContext applies, and
 * the same helpers as packages/shared/src/design/contrast.ts so this cannot
 * disagree with the palette gate:
 *
 *   pill word   colors.textInverse   on colors.primaryFill  (the lit tab)
 *   pill glyph  colors.textInverse   on colors.primaryFill  (same pair)
 *   idle glyph  colors.tabBarInactive on colors.background   (the four others)
 *
 * All six pairs clear AA. Until 2026-09-13 the dark-accent one did not (3.65-
 * 3.79:1) and was recorded here at the floor it held; the cause was in the
 * accent rewrite, not in this bar, and is fixed there — see
 * `packages/shared/src/settings/appearanceEffects.ts`.
 *
 * The idle glyph is gated at AA LARGE, not AA normal: it is an 18 dp icon, not
 * a string — the icon-contrast threshold (3:1, WCAG 1.4.11 non-text contrast)
 * is what applies, and `AA_LARGE` is the 3:1 constant this codebase already
 * has. Its name is announced regardless; what this asserts is that the glyph
 * is SEEN, which since the word went is the only thing distinguishing it from
 * empty bar.
 */
import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  lightTheme,
} from '@lantern/shared/design';
import { applyAccentToColors, applyHighContrastToColors } from '@lantern/shared/settings';

import { ACCENT_PRESETS as ACCENT_PRESET_ENTRIES } from '../../screens/settings/accentPresets';
import { LEGACY_DEFAULT_ACCENT_COLOR } from '@lantern/shared/settings';

const ACCENT_PRESETS = [
  ...ACCENT_PRESET_ENTRIES.map((p) => p.hex),
  LEGACY_DEFAULT_ACCENT_COLOR,
];

type BarInks = {
  textInverse: string;
  primaryFill: string;
  tabBarInactive: string;
  background: string;
};

function pillRatio(colors: BarInks): number {
  return contrastRatio(colors.textInverse, colors.primaryFill);
}

function idleRatio(colors: BarInks): number {
  return contrastRatio(colors.tabBarInactive, colors.background);
}

/** Reported as an object so a failure names WHICH palette, not two bare numbers. */
function report(label: string, what: string, ratio: number) {
  return { label, what, ratio: Number(ratio.toFixed(2)) };
}

describe('the lit tab’s word reads', () => {
  it('clears AA in the shipped palettes, light and dark', () => {
    for (const [label, colors] of [
      ['light', lightTheme],
      ['dark', darkTheme],
      ['light · high contrast', applyHighContrastToColors(lightTheme)],
      ['dark · high contrast', applyHighContrastToColors(darkTheme)],
    ] as const) {
      const ratio = pillRatio(colors as BarInks);
      expect(report(label, 'pill label on primaryFill', ratio)).toEqual({
        label,
        what: 'pill label on primaryFill',
        ratio: expect.any(Number),
      });
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('clears AA in LIGHT under every accent a student can pick', () => {
    // An accent rewrite that reached `primaryFill` without its paired ink is
    // how a lit tab ends up with a word nobody can read — and this bar is on
    // screen in every route, so it would be everywhere.
    for (const accent of ACCENT_PRESETS) {
      const ratio = pillRatio(applyAccentToColors(lightTheme, accent) as BarInks);
      expect(report(`light · ${accent}`, 'pill label on primaryFill', ratio)).toEqual({
        label: `light · ${accent}`,
        what: 'pill label on primaryFill',
        ratio: expect.any(Number),
      });
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  /**
   * WAS a known shortfall, FIXED 2026-09-13 in the accent rewrite.
   *
   * In dark mode a custom accent rewrote `primaryFill` to a mid-tone darkened
   * for a WHITE label (#0b7caf, #0b825a, #9f6707, #c93d82, #8457ea) while the
   * label actually painted is `textInverse` = #191919. That pair measured
   * 3.65-3.79:1 — over the 3:1 non-text bar, under AA, and 15 sp semibold is
   * not WCAG "large text" (which starts at 18.66 px bold).
   *
   * `applyAccentToColors` now derives the fill against the ink that sits on
   * it, so each preset keeps its stored hue in dark and the pair reads
   * 4.86-8.19:1. Asserted at AA, where it belongs: the floor-holding
   * assertion this replaces is exactly how the shortfall survived a release.
   */
  it('clears AA in DARK under every accent a student can pick', () => {
    for (const accent of ACCENT_PRESETS) {
      const ratio = pillRatio(applyAccentToColors(darkTheme, accent) as BarInks);
      expect(report(`dark · ${accent}`, 'pill label on primaryFill', ratio)).toEqual({
        label: `dark · ${accent}`,
        what: 'pill label on primaryFill',
        ratio: expect.any(Number),
      });
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

describe('the four nameless glyphs are SEEN', () => {
  /**
   * Gated at AA LARGE (3:1), not AA normal: an idle tab is an 18 dp icon, not
   * a string, so WCAG 1.4.11 non-text contrast is what applies and `AA_LARGE`
   * is the 3:1 constant this codebase already has. Its NAME is announced
   * regardless; what this asserts is that the glyph is visible at all — which,
   * since the word went, is the only thing separating an idle tab from empty
   * bar.
   */
  it('clears the non-text threshold on the bare page ground, everywhere', () => {
    const palettes: Array<readonly [string, BarInks]> = [
      ['light', lightTheme as BarInks],
      ['dark', darkTheme as BarInks],
      ['light · high contrast', applyHighContrastToColors(lightTheme) as BarInks],
      ['dark · high contrast', applyHighContrastToColors(darkTheme) as BarInks],
    ];
    for (const accent of ACCENT_PRESETS) {
      palettes.push([`light · ${accent}`, applyAccentToColors(lightTheme, accent) as BarInks]);
      palettes.push([`dark · ${accent}`, applyAccentToColors(darkTheme, accent) as BarInks]);
    }
    for (const [label, colors] of palettes) {
      const ratio = idleRatio(colors);
      expect(report(label, 'idle glyph on background', ratio)).toEqual({
        label,
        what: 'idle glyph on background',
        ratio: expect.any(Number),
      });
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });
});
