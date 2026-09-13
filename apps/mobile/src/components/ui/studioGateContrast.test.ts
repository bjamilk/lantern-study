/**
 * Contrast gate for `<StudioGate/>` (StudioGate.tsx).
 *
 * The gate paints four things and every one of them is a string a blocked
 * student has to read to get unblocked:
 *
 *   title      colors.text          (T.Title, on colors.surface)
 *   body       colors.textSecondary (T.Body,  on colors.surface)
 *   cost line  colors.textTertiary  (T.Caption, on colors.surface)
 *   disc glyph colors.text          (FeatureDisc `tint` variant: the page ink
 *                                    ON the feature's pastel, not on surface)
 *
 * The tertiary ink is the one worth gating: it is the app's faintest, it is
 * set at the 11 sp `caption` step, and it carries the only honest statement of
 * what the next tap costs. A price nobody can read is not an honest price.
 *
 * Measured in both palettes, under high contrast, and under every accent a
 * student can pick — the same rewrites ThemeContext applies — with the same
 * helpers as packages/shared/src/design/contrast.ts, so this cannot disagree
 * with the palette gate.
 */
import {
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
  FEATURE_KEYS,
} from '@lantern/shared/design';
import { applyAccentToColors, applyHighContrastToColors } from '@lantern/shared/settings';

import { ACCENT_PRESETS as ACCENT_PRESET_ENTRIES } from '../../screens/settings/accentPresets';
import { LEGACY_DEFAULT_ACCENT_COLOR } from '@lantern/shared/settings';

const ACCENT_PRESETS = [
  ...ACCENT_PRESET_ENTRIES.map((p) => p.hex),
  LEGACY_DEFAULT_ACCENT_COLOR,
];

/** The five studios that have a gate, and the hue each one's disc carries. */
const GATE_FEATURES = ['tests', 'notes', 'ai', 'flashcards'] as const;

type Inks = Record<'text' | 'textSecondary' | 'textTertiary' | 'surface', string>;

function expectGateInksRead(colors: Inks, label: string) {
  for (const ink of ['text', 'textSecondary', 'textTertiary'] as const) {
    const ratio = contrastRatio(colors[ink], colors.surface);
    // Reported as an object so a failure names WHICH palette and which ink,
    // rather than printing two bare numbers.
    expect({ label, ink, passes: ratio >= AA_NORMAL, ratio: Number(ratio.toFixed(2)) }).toEqual({
      label,
      ink,
      passes: true,
      ratio: Number(ratio.toFixed(2)),
    });
  }
}

describe('StudioGate contrast', () => {
  const MODES = [
    { mode: 'light' as const, palette: lightTheme },
    { mode: 'dark' as const, palette: darkTheme },
  ];

  it.each(MODES)('reads on the card in $mode', ({ mode, palette }) => {
    expectGateInksRead(palette as unknown as Inks, mode);
    expectGateInksRead(applyHighContrastToColors(palette) as unknown as Inks, `${mode} hc`);
  });

  it('reads under every accent a student can pick', () => {
    for (const { mode, palette } of MODES) {
      for (const accent of ACCENT_PRESETS) {
        expectGateInksRead(
          applyAccentToColors(palette, accent) as unknown as Inks,
          `${mode} ${accent}`
        );
      }
    }
  });

  it('draws the disc glyph legibly on its own pastel', () => {
    // `FeatureDisc` variant="tint" sets the glyph in `colors.text` on the
    // feature's tint. At 28 px (half of the 56 disc) this is a large graphic,
    // but the gate is the studio's only mark and a smudge is not a mark.
    for (const feature of GATE_FEATURES) {
      expect(
        contrastRatio(lightTheme.text, featureAccentsLight[feature].tint)
      ).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(
        contrastRatio(darkTheme.text, featureAccentsDark[feature].tint)
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('covers only hues the token set actually defines', () => {
    for (const feature of GATE_FEATURES) {
      expect(FEATURE_KEYS).toContain(feature);
    }
  });
});
