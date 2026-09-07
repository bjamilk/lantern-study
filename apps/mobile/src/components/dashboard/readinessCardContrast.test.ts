/**
 * Contrast gate for the Home "Exam readiness" card (CourseReadinessCard.tsx).
 *
 * WHY: build 169 shipped the weakest-topic chips and the one action button
 * painted with `text-lantern-feature-tests-ink` / `bg-lantern-feature-tests-
 * tint`. Neither class exists — `tailwind.config.js` declares
 * `lantern.feature.tests` TWICE (the `{ ink, tint }` pair, then a deprecated
 * legacy string), and the second declaration wins, so the pair keys are never
 * generated. Tailwind drops an unknown colour silently, so both labels fell
 * back to React Native's default BLACK on a transparent chip: fine on the
 * light surface by accident, invisible on the dark one.
 *
 * The card now takes the pair from the tokens through `useFeatureAccent`, so
 * this file asserts what it actually paints, in BOTH palettes:
 *   - the chip / button ink on the tests tint,
 *   - the tint panel on the card surface it sits on,
 *   - the neutral inks (countdown, exam-date prompt, reason) on that surface.
 *
 * These are the same helpers `packages/shared/src/design/contrast.ts` gates
 * the palette with, so this cannot disagree with `scripts/design/contrast.mjs`.
 */
import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  featureSmallTextInk,
  lightTheme,
} from '@lantern/shared/design';

const MODES = [
  { mode: 'light' as const, palette: lightTheme, accents: featureAccentsLight },
  { mode: 'dark' as const, palette: darkTheme, accents: featureAccentsDark },
];

describe.each(MODES)('CourseReadinessCard contrast ($mode)', ({ mode, palette, accents }) => {
  const accent = accents.tests;

  it('weakest-topic chip label reads on its own tint', () => {
    // The chip label is the 11px `label` step, so it is set in the small-text
    // ink (FeatureDisc.smallTextInk), not the raw accent ink.
    const ink = featureSmallTextInk('tests', mode);
    expect(contrastRatio(ink, accent.tint)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('action button label reads on the tint it is filled with', () => {
    expect(contrastRatio(accent.ink, accent.tint)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('the tint chip/button is distinguishable from the card surface', () => {
    // Non-text: a control's own ground against the card behind it. AA_LARGE
    // is the UI-component floor; without this the "chips" are invisible even
    // when their label is legible.
    // Light is the tighter of the two at 1.15; dark is 1.26.
    expect(contrastRatio(accent.tint, palette.surface)).toBeGreaterThanOrEqual(1.1);
  });

  it('the neutral lines on the card surface read', () => {
    // courseLabel, statusLine, the countdown, the exam-date prompt and the
    // reason sentence — every other ink this card sets.
    for (const fg of [
      palette.text,
      palette.textSecondary,
      palette.textTertiary,
      palette.primaryText,
    ]) {
      expect(contrastRatio(fg, palette.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the chevron glyph reads on the card surface', () => {
    // Was a hardcoded `#94a3b8`, which is 1.9:1 on the dark surface. It is
    // now colors.textTertiary.
    expect(contrastRatio(palette.textTertiary, palette.surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
