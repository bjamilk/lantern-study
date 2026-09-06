import { applyAccentToColors } from './appearanceEffects';
import {
  AA_LARGE,
  compositeOver,
  contrastRatio,
  ensureFillContrast,
  ensureTextContrast,
  ensureTextContrastOn,
} from '../design/contrast';
import { darkTheme, lightTheme, type ThemePalette } from '../design/tokens';

const AA = 4.5;

/** Every ground a text ink is painted on in one theme. */
function textGrounds(theme: ThemePalette) {
  return {
    surface: theme.surface,
    card: theme.card,
    page: theme.background,
    'tint over surface': compositeOver(theme.primaryBackground, theme.surface),
    'tint over page': compositeOver(theme.primaryBackground, theme.background),
  };
}

describe('the primaryFill / primaryText split', () => {
  it('carries a fill that holds a WHITE label in BOTH themes', () => {
    // Build 153: Home's "Review due cards" was the dark `primary` (#818cf8)
    // used as a fill — white on it is 2.98:1.
    expect(contrastRatio('#ffffff', lightTheme.primaryFill)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio('#ffffff', darkTheme.primaryFill)).toBeGreaterThanOrEqual(AA);
    expect(darkTheme.primaryFill).toBe(lightTheme.primaryFill);
  });

  it('carries a text ink that clears AA on every ground it is painted on', () => {
    const failures: string[] = [];
    const themes: Array<[string, ThemePalette]> = [
      ['light', lightTheme],
      ['dark', darkTheme],
    ];
    for (const [mode, theme] of themes) {
      for (const [name, ground] of Object.entries(textGrounds(theme))) {
        const ratio = contrastRatio(theme.primaryText, ground);
        if (ratio < AA) {
          failures.push(`${mode} primaryText on ${name} (${ground}): ${ratio.toFixed(2)}:1`);
        }
      }
    }
    // The message is the report; a bare length assertion would say nothing.
    expect(failures).toEqual([]);
  });

  it('keeps the deprecated `primary` byte-identical to each theme dominant role', () => {
    // Nothing un-migrated may shift: light `primary` was the fill, dark
    // `primary` was the text ink, and both keep their exact value.
    expect(lightTheme.primary).toBe(lightTheme.primaryFill);
    expect(darkTheme.primary).toBe(darkTheme.primaryText);
  });
});

describe('compositeOver', () => {
  it('flattens an 8-digit tint onto its base', () => {
    // #6366f120 is 12.5% alpha over the near-black surface.
    expect(compositeOver('#6366f120', '#101214')).toBe('#1a1d30');
    expect(compositeOver('#6366f120', '#000000')).toBe('#0c0d1e');
  });

  it('returns an opaque colour unchanged', () => {
    expect(compositeOver('#eef2ff', '#ffffff')).toBe('#eef2ff');
  });
});

describe('ensureFillContrast', () => {
  it('returns the fill untouched when white already clears AA on it', () => {
    expect(ensureFillContrast('#4f46e5')).toBe('#4f46e5');
  });

  it('darkens the DEFAULT accent, which is 4.47:1 under white — just short', () => {
    const fill = ensureFillContrast('#6366f1');
    expect(fill).not.toBe('#6366f1');
    expect(contrastRatio('#ffffff', fill)).toBeGreaterThanOrEqual(AA);
  });

  it('darkens any accent enough for a white label', () => {
    for (const accent of ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#ffffff']) {
      expect(contrastRatio('#ffffff', ensureFillContrast(accent))).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('ensureTextContrastOn', () => {
  it('satisfies EVERY ground, not just the first', () => {
    // The build-153 failure: #6b6ef2 passes on the dark card (4.59) and fails
    // on the tint (4.07). One ground is not a gate.
    const surface = darkTheme.surface;
    const tint = darkTheme.primaryBackground;
    const surfaceOnly = ensureTextContrast('#6366f1', surface);
    expect(contrastRatio(surfaceOnly, compositeOver(tint, surface))).toBeLessThan(AA);

    const both = ensureTextContrastOn('#6366f1', [surface, tint]);
    expect(contrastRatio(both, surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(both, compositeOver(tint, surface))).toBeGreaterThanOrEqual(AA);
  });

  it('returns the ink unchanged when it already passes everywhere', () => {
    expect(ensureTextContrastOn('#000000', ['#ffffff', '#eef2ff'])).toBe('#000000');
  });

  it('is a no-op on an empty ground list', () => {
    expect(ensureTextContrastOn('#6366f1', [])).toBe('#6366f1');
  });
});

describe('applyAccentToColors', () => {
  const accents = ['#6366f1', '#4f46e5', '#0ea5e9', '#f59e0b', '#22c55e', '#ec4899'];

  it.each(accents)('keeps a white label legible on the fill: %s', (accent) => {
    for (const theme of [lightTheme, darkTheme] as ThemePalette[]) {
      const out = applyAccentToColors({ ...theme } as Record<string, string>, accent);
      expect(contrastRatio('#ffffff', out.primaryFill)).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(accents)('keeps the text ink legible on surface AND tint: %s', (accent) => {
    for (const theme of [lightTheme, darkTheme] as ThemePalette[]) {
      const out = applyAccentToColors({ ...theme } as Record<string, string>, accent);
      expect(contrastRatio(out.primaryText, theme.surface)).toBeGreaterThanOrEqual(AA);
      expect(
        contrastRatio(out.primaryText, compositeOver(theme.primaryBackground, theme.surface))
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('fixes the exact build-153 readings', () => {
    // (a) dark "Try Again" was #6b6ef2 at 4.07:1 on the tint.
    const dark = applyAccentToColors({ ...darkTheme } as Record<string, string>, '#6366f1');
    expect(dark.primaryText).not.toBe('#6b6ef2');
    // (b) light "Try Again" was #5e61e5 at 4.35:1 on #eef2ff.
    const light = applyAccentToColors({ ...lightTheme } as Record<string, string>, '#6366f1');
    expect(light.primaryText).not.toBe('#5e61e5');
    expect(contrastRatio(light.primaryText, '#eef2ff')).toBeGreaterThanOrEqual(AA);
    // (c) Home's filled CTA in dark: white on the fill, not on #818cf8.
    expect(contrastRatio('#ffffff', dark.primaryFill)).toBeGreaterThanOrEqual(AA);
  });

  it('gives `primary` each theme dominant role, so un-migrated call sites do not shift', () => {
    const light = applyAccentToColors({ ...lightTheme } as Record<string, string>, '#6366f1');
    const dark = applyAccentToColors({ ...darkTheme } as Record<string, string>, '#6366f1');
    expect(light.primary).toBe(light.primaryFill);
    expect(dark.primary).toBe(dark.primaryText);
  });

  it('keeps the tab bar active colour at the 3:1 non-text bar', () => {
    for (const theme of [lightTheme, darkTheme] as ThemePalette[]) {
      const out = applyAccentToColors({ ...theme } as Record<string, string>, '#6366f1');
      expect(contrastRatio(out.tabBarActive, theme.tabBar)).toBeGreaterThanOrEqual(AA_LARGE);
    }
    // The default accent already clears 3:1 on both bars, so the semantics
    // (and the shipped colour) are unchanged.
    const dark = applyAccentToColors({ ...darkTheme } as Record<string, string>, '#6366f1');
    // Default accent = no override, so the palette's own dark tab colour ships (#818cf8, 7.04:1 on the bar).
    expect(dark.tabBarActive).toBe(darkTheme.tabBarActive);
    expect(contrastRatio(dark.tabBarActive, darkTheme.tabBar || darkTheme.surface)).toBeGreaterThanOrEqual(3);
  });

  it('base palettes carry a compliant primaryText', () => {
    expect(contrastRatio(lightTheme.primaryText, lightTheme.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(darkTheme.primaryText, darkTheme.surface)).toBeGreaterThanOrEqual(AA);
  });
});
