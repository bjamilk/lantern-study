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
 * One of the six pairs does NOT clear AA and is recorded rather than relaxed:
 * see the dark-accent note below. It predates this bar.
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
   * A KNOWN SHORTFALL, recorded rather than relaxed away — and NOT introduced
   * by this bar.
   *
   * In DARK mode a custom accent rewrites `primaryFill` to a mid-tone
   * (#0b7caf, #0b825a, #9f6707, #c93d82, #8457ea) while `textInverse` stays
   * the near-black #191919. That pair measures 3.65–3.79:1 — over the 3:1
   * non-text threshold, under the 4.5:1 AA_NORMAL one, and 15 sp semibold is
   * not WCAG "large text" (which starts at 18.66 px bold).
   *
   * It predates the hugging pill: the lit tab already drew an 11 sp bold word
   * in exactly this pair, as does EVERY primary button in the app, so the fix
   * belongs in the accent rewrite (packages/shared/src/settings) where one
   * change reaches all of them — not in this bar, which would only paper over
   * its own instance. The default palette and the default accent are unaffected
   * (17.58:1 light, 16.13:1 dark), as is high contrast.
   *
   * Asserted at the floor it actually holds, so the day someone darkens an
   * accent further this fails instead of shipping quietly.
   */
  it('records the dark-accent shortfall at the floor it really holds', () => {
    for (const accent of ACCENT_PRESETS) {
      const ratio = pillRatio(applyAccentToColors(darkTheme, accent) as BarInks);
      expect(report(`dark · ${accent}`, 'pill label on primaryFill', ratio)).toEqual({
        label: `dark · ${accent}`,
        what: 'pill label on primaryFill',
        ratio: expect.any(Number),
      });
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
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
