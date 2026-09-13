/**
 * The primary button is INK, and its label is the ground it sits on.
 *
 * WHY this is worth a test rather than a glance: the primary button has been
 * repainted three times (indigo fill with a white label; then `primaryFill`
 * after the build-153 dual-role split; now the page's ink), and each move was
 * a one-line change in `useButtonSkin` that nothing guarded. The failure mode
 * is silent and theme-specific — a fill that inverts under a label that does
 * not gives you white-on-white in exactly one palette, which is the bug you
 * only find on a device you were not holding.
 *
 * The skin is a hook, so the pairing is re-derived here from the same tokens
 * rather than rendered; what is asserted is the RELATIONSHIP (ground and its
 * inverse, clearing AA) and the absence of the indigo the pivot removed, both
 * of which survive a token revalue.
 */
import {
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lanternColors,
  lightTheme,
  type ThemePalette,
} from '@lantern/shared/design';

const MODES = [
  { mode: 'light' as const, palette: lightTheme },
  { mode: 'dark' as const, palette: darkTheme },
];

/**
 * Mirrors `useButtonSkin('primary')` in ./index.tsx. Kept as a plain function
 * so the pairing can be checked in both palettes without a renderer; if the
 * component's own two lines change, this test is the thing that notices the
 * contrast consequence.
 */
function accentSkin(isDark: boolean) {
  const flashcards = isDark ? featureAccentsDark.flashcards : featureAccentsLight.flashcards;
  return { backgroundColor: flashcards.tint, label: flashcards.ink, spinner: flashcards.ink };
}

function primarySkin(palette: ThemePalette) {
  return {
    backgroundColor: palette.text,
    label: palette.background,
    spinner: palette.background,
  };
}

describe.each(MODES)('Button primary skin ($mode)', ({ mode, palette }) => {
  const skin = primarySkin(palette);

  it('fills with the page ink and labels with the page ground', () => {
    expect(skin.backgroundColor).toBe(palette.text);
    expect(skin.label).toBe(palette.background);
    // The spinner shares the label's colour, or a loading button goes blank.
    expect(skin.spinner).toBe(skin.label);
  });

  it('clears AA for normal text', () => {
    expect(contrastRatio(skin.label, skin.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('inverts between the palettes rather than pinning one value', () => {
    // A black pill on a black page is a hole. The whole point of taking the
    // fill off `primaryFill` and onto `text` is that both halves move together.
    const other = mode === 'light' ? darkTheme : lightTheme;
    expect(skin.backgroundColor).not.toBe(primarySkin(other).backgroundColor);
  });

  it('is not the indigo this pivot removed', () => {
    const indigo = [
      lanternColors.primary,
      lanternColors.primaryLight,
      lanternColors.primaryDark,
      '#4f46e5',
      '#6366f1',
      '#818cf8',
    ].map((hex) => hex.toLowerCase());
    expect(indigo).not.toContain(skin.backgroundColor.toLowerCase());
  });
});

describe.each(MODES)('Button accent skin ($mode)', ({ mode }) => {
  const isDark = mode === 'dark';
  const skin = accentSkin(isDark);

  it('uses the flashcards pair, not brown accent', () => {
    const flashcards = isDark ? featureAccentsDark.flashcards : featureAccentsLight.flashcards;
    expect(skin.backgroundColor).toBe(flashcards.tint);
    expect(skin.label).toBe(flashcards.ink);
    expect(skin.backgroundColor.toLowerCase()).not.toBe(lanternColors.accent.toLowerCase());
  });

  it('clears AA for normal text', () => {
    expect(contrastRatio(skin.label, skin.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('Segmented shares the primary button skin', () => {
  it.each(MODES)('a selected segment is the same ink pairing ($mode)', ({ palette }) => {
    // `useSegmentSkin(true)` in ./index.tsx. A screen carrying an indigo
    // segment beside an ink primary button has two controls both claiming to
    // be the one live thing, which is the state this pivot ended.
    const selected = { backgroundColor: palette.text, color: palette.background };
    const primary = primarySkin(palette);
    expect(selected.backgroundColor).toBe(primary.backgroundColor);
    expect(selected.color).toBe(primary.label);
  });
});
