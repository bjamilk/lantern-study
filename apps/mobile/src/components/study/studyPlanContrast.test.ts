/**
 * Contrast gate for the Study Plan spine (StudyPlanPanel.tsx).
 *
 * The panel is the one surface in the set room that says almost everything
 * with COLOUR rather than with words: how far through a unit you are is an arc,
 * whether a topic is finished is a grey dot, and how full the plan is, is a
 * bar. None of those carry a number beside them on screen, so every one of them
 * has to clear the non-text 3:1 floor or the panel is decoration.
 *
 * Two of these numbers were caught by this test rather than by the eye, and the
 * panel was changed to pass them:
 *
 *   - the bar drawn as StudyFetch draws it — pale lilac fill on the app's pale
 *     grey track — measures 1.21:1 light / 1.08:1 dark. The fill is now the
 *     same INK the rings use, on a lilac track.
 *   - a finished topic's dot on `surfaceSecondary` measures 1.10:1 against the
 *     card behind it. It is now `textTertiary`.
 *
 * Measured in both palettes and under high contrast, with the same helpers as
 * packages/shared/src/design/contrast.ts so this cannot disagree with the
 * palette gate.
 */
import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
} from '@lantern/shared/design';
import { applyHighContrastToColors } from '@lantern/shared/settings';

/** WCAG 1.4.11: a graphic that carries meaning needs 3:1. */
const NON_TEXT = 3;

const PALETTES = [
  { name: 'light', colors: lightTheme, accent: featureAccentsLight.ai },
  { name: 'dark', colors: darkTheme, accent: featureAccentsDark.ai },
  {
    name: 'light high contrast',
    colors: applyHighContrastToColors(lightTheme),
    accent: featureAccentsLight.ai,
  },
  {
    name: 'dark high contrast',
    colors: applyHighContrastToColors(darkTheme),
    accent: featureAccentsDark.ai,
  },
];

describe('study plan contrast', () => {
  it.each(PALETTES)('$name: a ring arc reads against its own track', ({ accent }) => {
    expect(contrastRatio(accent.ink, accent.tint)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(PALETTES)('$name: the progress bar fill reads against its track', ({ accent }) => {
    // Fill and track are the ring's two colours — asserted as the same pair so
    // a change to one drawing cannot silently break the other.
    expect(contrastRatio(accent.ink, accent.tint)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(PALETTES)('$name: a finished topic dot reads against the card', ({ colors }) => {
    expect(contrastRatio(colors.textTertiary, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(PALETTES)('$name: the head disc glyph reads on the lilac', ({ accent }) => {
    // The `send` glyph, the one thing drawn ON the tint rather than beside it.
    expect(contrastRatio(accent.ink, accent.tint)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(PALETTES)('$name: a struck-through topic is still readable', ({ colors }) => {
    // A done topic drops to `textSecondary` AND gains a line through it. Faded
    // plus struck is how a plan stops shouting about finished work; illegible
    // is how it stops being a record of what you did.
    expect(contrastRatio(colors.textSecondary, colors.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(PALETTES)('$name: the exam date and the unit count read', ({ colors }) => {
    // Both at the 11 sp caption step, which is why the normal floor applies
    // rather than the large one.
    expect(contrastRatio(colors.textTertiary, colors.surface)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(colors.textTertiary, colors.background)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(PALETTES)('$name: the next topic card separates from the page', ({ accent, colors }) => {
    // The lilac hairline around the Continue card is the only thing lifting it
    // off the surface — there is no shadow anywhere in this app.
    expect(contrastRatio(accent.tint, colors.surface)).toBeGreaterThanOrEqual(1.05);
  });

  it.each(PALETTES)('$name: the self-rating card reads on its lilac', ({ accent, colors }) => {
    // The one card in the panel drawn ON the tint rather than beside it, so
    // both of its lines and its glyph are measured against the tint and not
    // against the surface they would sit on anywhere else.
    expect(contrastRatio(colors.text, accent.tint)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(colors.textSecondary, accent.tint)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(accent.ink, accent.tint)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
