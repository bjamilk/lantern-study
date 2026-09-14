/**
 * EVERY accent a student can pick, in BOTH themes, gated at AA.
 *
 * The 2026-09-13 finding: in dark mode under any custom preset the primary
 * pair measured 3.65-3.79:1 — every primary button, the lit tab word and the
 * active pills — because `applyAccentToColors` derived the fill for a WHITE
 * label while dark paints `textInverse` (#191919) on it. The per-accent tests
 * that existed checked a hand-written list of hexes and asserted the buggy
 * rule ("a derived fill carries white"), so they passed throughout.
 *
 * This iterates the SHIPPED swatch list (`ACCENT_PRESET_HEXES`, which the
 * mobile settings grid is built from), so a sixth preset is gated the day it
 * is added rather than the day someone measures it.
 */
import { applyAccentToColors, applyHighContrastToColors } from './appearanceEffects';
import { ACCENT_PRESET_HEXES, DEFAULT_ACCENT_COLOR, LEGACY_DEFAULT_ACCENT_COLOR } from './appearanceEffects';
import { AA_NORMAL, contrastRatio, ensureAaPair } from '../design/contrast';
import { darkTheme, lightTheme, type ThemePalette } from '../design/tokens';

const THEMES: Array<[string, ThemePalette]> = [
  ['light', lightTheme],
  ['dark', darkTheme],
];

/** Reported as an object so a failure names the accent AND the theme. */
function pair(theme: ThemePalette, accent: string) {
  const out = applyAccentToColors({ ...theme } as Record<string, string>, accent);
  return {
    fill: out.primaryFill,
    ink: out.textInverse,
    ratio: Number(contrastRatio(out.textInverse, out.primaryFill).toFixed(2)),
  };
}

describe('the primary pair under every accent preset', () => {
  for (const [mode, theme] of THEMES) {
    for (const accent of [...ACCENT_PRESET_HEXES, LEGACY_DEFAULT_ACCENT_COLOR]) {
      it(`clears AA in ${mode} under ${accent}`, () => {
        const { ratio } = pair(theme, accent);
        expect({ mode, accent, ratio: expect.any(Number) }).toEqual({
          mode,
          accent,
          ratio: expect.any(Number),
        });
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  it('leaves the Default swatch byte-identical in both themes', () => {
    // Default (and the retired indigo it also owns) mean "no override": the
    // palette's own ink fill must ship untouched, at its 16:1.
    for (const [, theme] of THEMES) {
      for (const accent of [DEFAULT_ACCENT_COLOR, LEGACY_DEFAULT_ACCENT_COLOR]) {
        const out = applyAccentToColors({ ...theme } as Record<string, string>, accent);
        expect(out.primaryFill).toBe(theme.primaryFill);
        expect(out.textInverse).toBe(theme.textInverse);
      }
    }
  });

  it('keeps a custom accent on its own hue rather than repainting it', () => {
    // The fix must not "solve" contrast by walking a preset toward grey. Four
    // of the five hold #191919 on their RAW hue, so in dark the fill is now
    // the stored value exactly (it used to be darkened for a white label that
    // dark never paints); violet is 4.44:1 raw and takes ONE 5% step toward
    // white, which is still violet.
    expect(
      ACCENT_PRESET_HEXES.filter((h) => h !== DEFAULT_ACCENT_COLOR).map(
        (h) => pair(darkTheme, h).fill
      )
    ).toEqual(['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#976cf7']);
    for (const accent of ACCENT_PRESET_HEXES.filter((h) => h !== DEFAULT_ACCENT_COLOR)) {
      expect(pair(darkTheme, accent).ink).toBe(darkTheme.textInverse);
    }
  });

  it('leaves LIGHT byte-identical to what shipped', () => {
    // Light already cleared AA: its `textInverse` is white and the fill was
    // (and still is) darkened exactly far enough to hold it. The dark fix must
    // not disturb a single light value.
    expect(
      ACCENT_PRESET_HEXES.filter((h) => h !== DEFAULT_ACCENT_COLOR).map(
        (h) => pair(lightTheme, h).fill
      )
    ).toEqual(['#0b7caf', '#0b825a', '#9f6707', '#c93d82', '#8457ea']);
    for (const accent of ACCENT_PRESET_HEXES) {
      expect(pair(lightTheme, accent).ink).toBe(lightTheme.textInverse);
    }
  });

  it('survives high contrast, which is layered on top of the accent', () => {
    for (const [mode, theme] of THEMES) {
      for (const accent of ACCENT_PRESET_HEXES) {
        const out = applyHighContrastToColors(
          applyAccentToColors({ ...theme } as Record<string, string>, accent)
        );
        const ratio = contrastRatio(out.textInverse, out.primaryFill);
        expect({ mode, accent, pass: ratio >= AA_NORMAL }).toEqual({
          mode,
          accent,
          pass: true,
        });
      }
    }
  });
});

describe('ensureAaPair', () => {
  it('keeps the fill untouched when the preferred ink already reads on it', () => {
    expect(ensureAaPair('#0ea5e9', ['#191919', '#f5f5f5'])).toEqual({
      fill: '#0ea5e9',
      ink: '#191919',
    });
  });

  it('prefers the FIRST candidate over the higher-contrast one', () => {
    // The caller passes the theme's own `textInverse` first. Picking "the best
    // ink" instead would flip light mode's white button labels to near-black
    // the moment a bright accent happened to read better under black.
    const { ink, fill } = ensureAaPair('#0ea5e9', ['#ffffff', '#191919']);
    expect(ink).toBe('#ffffff');
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('moves the fill toward AA, in the hue family, when the ink cannot read', () => {
    const { fill, ink } = ensureAaPair('#6366f1', ['#191919', '#f5f5f5']);
    // #6366f1 is 3.94:1 under #191919 — it must lighten, not become white.
    expect(ink).toBe('#191919');
    expect(fill).not.toBe('#6366f1');
    expect(fill).not.toBe('#ffffff');
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('falls back to the other ink when the first would collapse the hue', () => {
    // Nothing readable can sit on pure white but near-black.
    const { ink } = ensureAaPair('#ffffff', ['#ffffff', '#191919']);
    expect(ink).toBe('#191919');
  });

  it('is a no-op with no candidates', () => {
    expect(ensureAaPair('#0ea5e9', []).fill).toBe('#0ea5e9');
  });
});
