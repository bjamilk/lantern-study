/**
 * Contrast gate for `<AppDialogHost/>` (AppDialogHost.tsx).
 *
 * The stock Material dialog the founder rejected was the one surface that
 * ignored the theme entirely. The replacement paints every string with a
 * theme ink on `colors.card`, so this asserts — in BOTH palettes, under the
 * high-contrast setting, and under every accent a student can pick — that
 * each of those inks reads at AA on that card:
 *
 *   title        colors.text            (Heading)
 *   message      colors.textSecondary   (Body tone="secondary")
 *   cancel       colors.textSecondary
 *   confirm      colors.primaryText     (default / isPreferred)
 *   destructive  colors.error
 *
 * `card` is `surface` on mobile (theme/ThemeContext.tsx), and the accent and
 * high-contrast rewrites are the same functions ThemeContext applies, so this
 * measures what the dialog actually paints. Same helpers as
 * packages/shared/src/design/contrast.ts, so it cannot disagree with the
 * palette gate.
 */
import { AA_NORMAL, contrastRatio, darkTheme, lightTheme } from '@lantern/shared/design';
import { applyAccentToColors, applyHighContrastToColors } from '@lantern/shared/settings';

/** Mirrors SettingsScreen.tsx ACCENT_PRESETS; the first is the default. */
const ACCENT_PRESETS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

function toMobile<T extends Record<string, string>>(palette: T) {
  return { ...palette, card: palette.surface };
}

const MODES = [
  { mode: 'light' as const, palette: toMobile(lightTheme) },
  { mode: 'dark' as const, palette: toMobile(darkTheme) },
];

type Inks = Record<'text' | 'textSecondary' | 'primaryText' | 'error' | 'card', string>;

function expectDialogInksRead(colors: Inks) {
  const roles: Array<[string, string]> = [
    ['title (text)', colors.text],
    ['message / cancel (textSecondary)', colors.textSecondary],
    ['confirm (primaryText)', colors.primaryText],
    ['destructive (error)', colors.error],
  ];
  const failing = roles
    .map(([role, ink]) => ({ role, ink, ratio: contrastRatio(ink, colors.card) }))
    .filter((r) => r.ratio < AA_NORMAL)
    .map((r) => `${r.role} ${r.ink} on card ${colors.card}: ${r.ratio.toFixed(2)}:1`);
  expect(failing).toEqual([]);
}

describe.each(MODES)('AppDialogHost contrast ($mode)', ({ palette }) => {
  it('title, message, cancel, confirm and destructive inks read on the card', () => {
    expectDialogInksRead(palette);
  });

  it('still reads with the high-contrast setting on', () => {
    expectDialogInksRead(applyHighContrastToColors(palette));
  });

  it.each(ACCENT_PRESETS)('confirm ink reads on the card under accent %s', (accent) => {
    expectDialogInksRead(applyAccentToColors(palette, accent));
  });

  it('destructive and confirm are distinguishable from the cancel ink', () => {
    // Not a text threshold — the three roles are told apart by hue and
    // weight, but the error ink must at least not collapse into the
    // secondary ink on either palette.
    expect(palette.error.toLowerCase()).not.toBe(palette.textSecondary.toLowerCase());
    expect(palette.primaryText.toLowerCase()).not.toBe(palette.textSecondary.toLowerCase());
  });
});
