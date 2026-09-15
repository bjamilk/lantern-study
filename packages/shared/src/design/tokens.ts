// ===========================================
// Lantern Study - Shared Design Tokens
// ===========================================
//
// PURPOSE
//   The single palette, type scale, spacing and radius set for the whole
//   product. Everything visual on both platforms resolves back to a value in
//   this file, so a colour is changed here once rather than in two apps.
//
// CONSUMERS
//   web    — `utils/applyDesignTokens.ts` turns these into CSS custom
//            properties on <html>; `index.css` holds the light/dark `:root`
//            and `.dark` blocks; `tailwind.config.js` reads them as
//            `rgb(var(--x) / <alpha-value>)`.
//   mobile — `src/theme/*` consumes the objects directly.
//   api    — no.
//
// THE RULE THAT KEEPS DARK MODE ALIVE
//   Dark mode was once dead because an INLINE light palette was written onto
//   <html>, and an inline custom property outranks the `.dark` stylesheet. A
//   token must never get its only definition from an inline style or from
//   inside a media query. web's applyDesignTokens keeps a purge list of legacy
//   inline vars for exactly this reason — do not reintroduce them.
//
// CONTRAST IS A GATE, NOT A PREFERENCE
//   Every ink here has been checked against every ground it is painted on by
//   ./contrast.ts, which runs in jest AND in `npm run design:contrast` against
//   what index.css actually ships. Changing a colour means re-running both.
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT: run `npm run build` in
//     packages/shared before typechecking or running web/mobile, or consumers
//     resolve a stale `dist/`.
//   - A NEW subpath under src/ needs the file, a `packages/shared/package.json`
//     "exports" entry, AND an `apps/api-server/tsconfig.json` "paths" entry.
//     Mobile jest maps `@lantern/shared/*` subpaths separately, so a subpath
//     imported only by a test fails CI-only with TS2307 (`jest --no-cache`).
//   - The web turbo build compiles with strict `noUncheckedIndexedAccess`.

export const lanternColors = {
  // 2026-09-12 colour pivot: the brand's primary is no longer indigo. A
  // primary control is the theme's INK — the same near-black pill the
  // StudyFetch-look primitives already use — so `primary`, `primaryLight`
  // (hover) and `primaryDark` (pressed) are the light theme's ink and its two
  // neighbours. Dark's values live in `darkBase`, which inverts the ink.
  primary: '#191919',
  primaryLight: '#333333',
  primaryDark: '#000000',
  // UI-02: amber-600 (#d97706) was 3.0-3.6:1 as text on white/cream and under
  // white button labels; amber-700 clears AA for both roles.
  accent: '#b45309',
  accentLight: '#f59e0b',
  accentDark: '#b45309',
} as const;

// NOTE: every value below is a LITERAL hex on purpose. `scripts/design/
// contrast.mjs` PARSES this file rather than importing it (so the gate can run
// before a build), and an identifier here reads to it as a missing token.
const lightBase = {
  // Paper ground, measured off StudyFetch (2026-09-11 direction): a warm
  // near-neutral rather than the old peachy cream, so the pastel panels on
  // top of it read as the only colour on the screen.
  background: '#f7f6ef',
  backgroundSecondary: '#f2f0e8',
  // Desktop destination rail: near-black charcoal, not navy. Its glyphs are
  // light-grey outlines (`navColumnTextSecondary`), the lit one sits in a grey
  // pill (`navColumnActive`) with a white glyph — no hue anywhere on the rail.
  navColumn: '#171717',
  navColumnText: '#f5f5f5',
  navColumnTextSecondary: '#a3a3a3',
  /** The grey pill behind the lit rail item. A ground, never text. */
  navColumnActive: '#383838',
  /**
   * The STRONG ink of the current theme — the solid button pill, the line
   * illustration on a pastel panel, the hard offset shadow under a hub tile.
   * It inverts between themes on purpose: a black pill on a black page is a
   * hole, so dark gets a near-white pill with a dark label. Whatever sits ON
   * it is `surface`, which inverts with it.
   *
   * Near-black rather than #000 in light: pure black against a warm paper
   * ground reads as a cut-out.
   */
  ink: '#191919',
  surface: '#ffffff',
  surfaceSecondary: '#f1f5f9',
  card: '#ffffff',
  cardSecondary: '#f1f5f9',
  // 2026-09-12 one-ink pass: body copy and glyphs ship in the SAME near-black
  // as the filled controls (`ink` / `primaryFill` = #191919). Before this the
  // app shipped two dark inks at once — #191919 pills beside #0f172a
  // (slate-900) glyphs — which read as a printing error on the device pass.
  // 17.58:1 on white, 16.56 on cream: one step off the old slate.
  text: '#191919',
  // Derived as NEUTRAL greys of that ink, not slate-tinted: StudyFetch's body
  // copy is a neutral near-black, and a slate secondary under a neutral
  // primary is the same two-ink tell one level down. Both land ABOVE the
  // slate values they replace (7.81 vs 7.58 on white).
  textSecondary: '#525252',
  // UI-02: #64748b was 4.39:1 on the warm background at the 10-12px sizes
  // this token styles; the neutral #666666 clears AA everywhere the old
  // #5b6a7f did (5.74 white / 5.41 cream / 4.53 on the putty tint).
  textTertiary: '#666666',
  textInverse: '#ffffff',
  /**
   * @deprecated The legacy DUAL-ROLE token. It is the value each theme
   * already used for its dominant role — light `primary` is the fill,
   * dark `primary` is the text ink — so it stays byte-identical while the
   * ~1300 un-migrated call sites move to `primaryFill` / `primaryText`.
   * New code must pick one of those two; never this.
   */
  primary: lanternColors.primary,
  primaryLight: lanternColors.primaryLight,
  primaryDark: lanternColors.primaryDark,
  // Neutral putty, not an indigo wash: the tint a primary-coloured chip or
  // callout sits in now that primary is ink.
  //
  // One step DARKER than `backgroundSecondary` (#f2f0e8) on purpose. The pivot
  // first set them to the same value, which made all 118
  // `bg-lantern-primary-background` panels vanish wherever the second plane is
  // the ground. #e9e4d8 is 1.11:1 against #f2f0e8 — a visible edge — and still
  // carries the ink above at 13.9:1.
  primaryBackground: '#e9e4d8',
  /**
   * Primary used as a FILL under INVERSE text (buttons, badges, chips). It is
   * the theme's `ink`, so it INVERTS with the theme — near-black under white
   * in light, near-white under near-black in dark. What sits on it is
   * `textInverse`, never a hardcoded white.
   */
  primaryFill: '#191919',
  /**
   * Primary used as TEXT or an icon glyph, on the surface, the card AND the
   * `primaryBackground` tint. #191919 is 16.9 on white, 15.6 on cream, 13.9
   * on the putty tint.
   */
  primaryText: '#191919',
  accent: lanternColors.accent,
  accentBackground: '#fff7ed',
  // UI-02: 700-weight for AA as small text on white/cream (see accent above).
  success: '#047857',
  successBackground: '#d1fae5',
  warning: '#b45309',
  warningBackground: '#fff7ed',
  // UI-03: red-600 (#dc2626) was 4.46:1 on the warm page ground — 0.04 short
  // of AA for the field-error copy that renders there. #d42323 is the
  // smallest step that clears it (4.77 cream / 5.17 white) and also lifts
  // white labels on error fills from 4.83 to 5.17. Visually indistinguishable.
  // NOTE: 13 hardcoded '#dc2626' literals remain in apps/mobile; they are
  // pre-existing drift for the Wave T/V1 call-site migration to fold in.
  error: '#d42323',
  errorBackground: '#fee2e2',
  // A red that carries WHITE text on top of it — count badges, destructive
  // fills. `error` itself is tuned to be readable AS text on the page ground,
  // which in dark mode makes it too light to sit under a white numeral
  // (#ef4444 + white is 3.76:1). Light needs no separate value.
  errorStrong: '#d42323',
  // UI-03: sky-500 (#0ea5e9) was 2.63:1 on cream as text. sky-700 clears AA
  // on cream (5.48) and white (5.93) and is the value `--color-info` carries.
  info: '#0369a1',
  infoBackground: '#e0f2fe',
  // Hairline, not a rule: StudyFetch separates planes with a warm grey one
  // step off the second plane, which is why its cards float without shadows.
  border: '#eceae0',
  borderLight: '#f0eee6',
  tabBar: '#ffffff',
  tabBarBorder: '#eceae0',
  tabBarActive: lanternColors.primary,
  tabBarInactive: '#666666',
  inputBackground: '#f1f5f9',
  inputBorder: '#c5cedd',
  inputText: '#191919',
  // Neutral twin of `textTertiary` (same one-ink rule).
  inputPlaceholder: '#666666',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#ffffff',
  switchTrackOn: '#19191980',
  // WhatsApp-style chat surface: warm paper ground, green own-bubble,
  // white peer bubble, muted slate meta text.
  chatBackground: '#efeae2',
  chatBubbleOwn: '#d9fdd3',
  chatBubbleOther: '#ffffff',
  chatBubbleText: '#111b21',
  chatBubbleMeta: '#667781',
  switchTrackOff: '#c5cedd',
  switchThumbOn: lanternColors.primary,
  switchThumbOff: '#64748b',
} as const;

const darkBase = {
  // X-style "lights out": pure-black ground, near-black surfaces (#101214),
  // X border gray (#2f3336). Chosen over the old navy family on user request.
  background: '#000000',
  backgroundSecondary: '#16181c',
  navColumn: '#171717',
  navColumnText: '#f5f5f5',
  navColumnTextSecondary: '#a3a3a3',
  navColumnActive: '#383838',
  /** See lightBase.ink — the pill inverts, the label on it is `surface`. */
  ink: '#f5f5f5',
  surface: '#101214',
  surfaceSecondary: '#1a1d21',
  card: '#101214',
  cardSecondary: '#1a1d21',
  // One ink, both themes. Dark's ink ramp is the NEUTRAL twin of light's
  // (#191919 / #525252 / #666666), not slate: #f8fafc / #94a3b8 / #8494a8 are
  // blue-tinted, so a dark screen read cooler than the light one it mirrors
  // and `text` differed from `primary` (#f5f5f5) by a hair nobody chose.
  // `text` IS dark's primary ink now, and the two greys below are plain greys.
  text: '#f5f5f5',
  textSecondary: '#b3b3b3',
  // UI-01 still holds: this must clear 4.5:1 on every dark surface, which
  // #8c8c8c does (6.25:1 on #000, 5.6:1 on #101214); #64748b did not.
  textTertiary: '#8c8c8c',
  // Dark's inverted pill is near-white, and the glyph on it is the SAME dark
  // ink light mode paints text in (#191919, 16.13:1 on #f5f5f5) — not slate
  // #0f172a. One dark ink across both themes.
  textInverse: '#191919',
  chatBackground: '#000000',
  chatBubbleOwn: '#005c4b',
  chatBubbleOther: '#202c33',
  // Pure white on the green own-bubble — #e9edef read as dull (user request).
  chatBubbleText: '#ffffff',
  chatBubbleMeta: '#b0c0c8',
  /** @deprecated See lightBase.primary. Dark's dominant role is TEXT, so this
   * equals `primaryText`; using it as a FILL under white is the 2.98:1 bug
   * found on build 153 (Home's "Review due cards"). Use `primaryFill`. */
  primary: '#f5f5f5',
  primaryLight: '#ffffff',
  primaryDark: '#d4d4d4',
  /** The putty tint's dark twin: a translucent wash of the ink itself, which
   * composites to a near-black plane over either the surface or the page. */
  primaryBackground: '#f5f5f512',
  /**
   * The ink INVERTS here — a near-black pill on a black page is a hole. What
   * sits on it is `textInverse` (#191919), which inverts with it: 16.1:1.
   * A white label on this fill would be 1.04:1, so `.dark` in index.css
   * forces the inverse ink onto the un-migrated `text-white` call sites.
   */
  primaryFill: '#f5f5f5',
  /**
   * Primary used as TEXT on the dark surface, the black page AND the
   * translucent tint composited over both — all above 15:1.
   */
  primaryText: '#f5f5f5',
  accent: '#fbbf24',
  accentBackground: '#f59e0b20',
  success: '#10b981',
  successBackground: '#10b98120',
  warning: '#fbbf24',
  warningBackground: '#f59e0b20',
  error: '#ef4444',
  errorBackground: '#ef444420',
  // red-600: white on it is 4.83:1 (AA), where white on `error` (#ef4444) is
  // 3.76:1 — the due-count badge failed on every screen. Fill only; red TEXT
  // on the dark ground stays `error`, which is the lighter of the two there.
  errorStrong: '#dc2626',
  // UI-03: sky-300 on the lights-out ground — 12.60:1 on #000, 11.26:1 on
  // #101214. sky-500 sat at 6.3:1 and dropped under 4.5 on the info tint.
  info: '#7dd3fc',
  infoBackground: '#0ea5e920',
  border: '#2f3336',
  borderLight: '#26292d',
  tabBar: '#000000',
  tabBarBorder: '#2f3336',
  tabBarActive: '#f5f5f5',
  tabBarInactive: '#8c8c8c',
  inputBackground: '#101214',
  inputBorder: '#2f3336',
  inputText: '#f5f5f5',
  inputPlaceholder: '#8c8c8c',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#101214',
  switchTrackOn: '#f5f5f580',
  switchTrackOff: '#2f3336',
  switchThumbOn: '#f5f5f5',
  switchThumbOff: '#8c8c8c',
} as const;

export const lightTheme = lightBase;
export const darkTheme = darkBase;
// Widen values to `string` so both palettes (and accent/contrast-adjusted
// copies) are assignable; `typeof lightBase` would pin the light literals.
export type ThemePalette = { [K in keyof typeof lightBase]: string };

/** Backwards-compatible exports for mobile ThemeContext */
export const lightColors = lightTheme;
export const darkColors = darkTheme;

/**
 * The eight feature identities (spec v3 §5.6). Hue = identity, at rest, in
 * tints; state stays saturated, small and always paired with icon and text.
 *
 * `ink` is the only value allowed to carry text or a glyph; `tint` is a
 * ground. Every pair clears WCAG AA (≥4.5:1) with its ink on its own tint,
 * on the surface and on the page ground — asserted by
 * `contrast.test.ts` and by `scripts/design/contrast.mjs`, which is the
 * gate that must pass before either map changes.
 *
 * Two inks are tight: lime (4.60 on tint) and amber (4.51). Per the spec,
 * use `#3f6212` for lime text under 12px, and never set body copy in an ink.
 */
// ---------------------------------------------------------------------------
// Feature accents
// ---------------------------------------------------------------------------
// Each product area gets an ink/tint pair, per theme. `ink` is for text and
// strokes, `tint` for fills — they are not interchangeable, and the small-text
// overrides exist because a hue legible at 18px is not always legible at 12px.

export const FEATURE_KEYS = [
  'notes',
  'flashcards',
  'tests',
  'recording',
  'ai',
  'groups',
  'campus',
  'budget',
  // Ninth identity, added with the 2026-09-11 StudyFetch pass: a study SET is
  // a container for the other eight, so it could not borrow one of their hues
  // without claiming to be that kind of object. Mint — the cyan family the
  // tests/quiz pastel comes from, one step green.
  'sets',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureAccentPair = { ink: string; tint: string };

export const featureAccentsLight: Record<FeatureKey, FeatureAccentPair> = {
  // 2026-09-11: the tints are StudyFetch's own pastels, measured off the
  // product — cyan #bbeef0 (test/quiz/sets), green #bcf887 (cards/match),
  // yellow #f9f284 (lecture), violet #f5d5ff (recap/tutor/chat). The INKS are
  // not StudyFetch's: it sets its glyphs in black, which is legal on a panel
  // and illegal as the count-pill text those same inks carry here. Each is
  // the darkest step of the pastel's own hue that clears AA on the pastel, on
  // white and on the paper ground.
  notes: { ink: '#6b6031', tint: '#efebdd' },
  flashcards: { ink: '#3f6212', tint: '#bcf887' },
  tests: { ink: '#0b5a61', tint: '#bbeef0' },
  recording: { ink: '#5c5200', tint: '#f9f284' },
  ai: { ink: '#7b2cab', tint: '#f5d5ff' },
  groups: { ink: '#047857', tint: '#d1fae5' },
  campus: { ink: '#6d28d9', tint: '#ede9fe' },
  budget: { ink: '#b45309', tint: '#fef3c7' },
  sets: { ink: '#0b5f50', tint: '#b9f0e2' },
};

export const featureAccentsDark: Record<FeatureKey, FeatureAccentPair> = {
  // Dark keeps the light column's HUE and inverts the roles: the pastel
  // becomes the ink and a near-black of the same hue becomes the tint. Five
  // moved with the light column (notes teal -> warm grey, flashcards lime ->
  // green, tests sky -> cyan, recording fuchsia -> yellow, ai indigo ->
  // violet) so a lecture is yellow in both themes, not yellow and magenta.
  notes: { ink: '#e2dac2', tint: '#2a2620' },
  flashcards: { ink: '#b8f07a', tint: '#1c2e0e' },
  tests: { ink: '#8ae6ec', tint: '#0c2a2e' },
  recording: { ink: '#f7ee7a', tint: '#3a3408' },
  ai: { ink: '#e9b8ff', tint: '#2f1b3d' },
  groups: { ink: '#6ee7b7', tint: '#0b2e22' },
  campus: { ink: '#c4b5fd', tint: '#2a1b4d' },
  budget: { ink: '#fbbf24', tint: '#3a2a08' },
  sets: { ink: '#7fe8d0', tint: '#0d2e28' },
};

/**
 * Small-text ink overrides (spec v3 §5.6). An `ink` that clears AA on its own
 * tint by a hair is still legal at body size and NOT legal at the 11 px
 * `label` step, where the spec forbids the raw hue. Light lime is the one such
 * case: `#4d7c0f` is 4.60:1 on `#ecfccb`, so anything under 12 px darkens to
 * `#3f6212`. Every other feature — and every dark ink, all of which are light
 * hues far above the bar — falls through to its own `ink`.
 *
 * This map, not a literal at a call site, is the single source: `smallTextInk`
 * in apps/mobile/src/components/ui/FeatureDisc.tsx reads it, the CSS bridge
 * emits it as `--color-feature-<key>-small-ink`, and `scripts/design/
 * contrast.mjs` parses it out of this file to gate the substitute.
 */
export const featureSmallTextInkLight: Partial<Record<FeatureKey, string>> = {
  // Empty since 2026-09-11: lime #4d7c0f was the one ink tight enough on its
  // own tint (4.60:1) to need a darker substitute under 12 px, and the
  // StudyFetch pass replaced it with #3f6212 — the substitute itself — as the
  // base ink. Every ink now clears AA on its own tint by at least 0.7.
};

/** Dark needs no override; kept so the two themes stay symmetric. */
export const featureSmallTextInkDark: Partial<Record<FeatureKey, string>> = {};

/** The ink to set text UNDER 12 px in, for one feature in one theme. */
export function featureSmallTextInk(feature: FeatureKey, mode: 'light' | 'dark'): string {
  const overrides = mode === 'dark' ? featureSmallTextInkDark : featureSmallTextInkLight;
  const base = mode === 'dark' ? featureAccentsDark : featureAccentsLight;
  return overrides[feature] ?? base[feature].ink;
}

/**
 * @deprecated Use `featureAccentsLight` / `featureAccentsDark` and their
 * `{ ink, tint }` pairs. Kept for ONE release so the ~38 existing call sites
 * keep compiling; delete with the Wave V1 call-site migration.
 *
 * Each old key maps to the light `ink` of the new pair that carries the same
 * meaning:
 *
 * - `dashboard` -> `ai`         — identical hex (#4f46e5); dashboard was the
 *                                 indigo primary and Lantern AI now owns it,
 *                                 so nothing on screen changes.
 * - `library`   -> `notes`      — the spec names the family "Notes & Library".
 *                                 CHANGES rose #f43f5e -> teal #0f766e.
 * - `flashcards`-> `flashcards` — CHANGES rose #f43f5e -> lime #4d7c0f. Rose
 *                                 sat 10 degrees from `error`, which is why
 *                                 the spec moved it.
 * - `tests`     -> `tests`      — CHANGES sky-500 #0ea5e9 -> sky-700 #0369a1
 *                                 (the old value failed AA as text).
 * - `groups`    -> `groups`     — CHANGES emerald-500 -> emerald-700.
 * - `campus`-family: `admin` and `marketplace` both -> `campus` violet
 *                                 #6d28d9. Admin was neutral slate and
 *                                 marketplace violet-500; both are
 *                                 campus-scoped surfaces, and the spec gives
 *                                 the campus/communities family one hue.
 * - `offline`   -> `budget`     — amber. Spec §5.7 puts Downloads on an amber
 *                                 disc, and decision 4 gives money the amber
 *                                 family; #f59e0b -> #b45309 also fixes the
 *                                 old value's 2.9:1 as text.
 * - `budget`    -> `budget`     — CHANGES teal #14b8a6 -> amber #b45309 per
 *                                 decision 4 (teal now means Notes).
 *
 * `recording` has no legacy key: it is new in this wave.
 */
export const featureAccents = {
  dashboard: featureAccentsLight.ai.ink,
  library: featureAccentsLight.notes.ink,
  admin: featureAccentsLight.campus.ink,
  flashcards: featureAccentsLight.flashcards.ink,
  groups: featureAccentsLight.groups.ink,
  marketplace: featureAccentsLight.campus.ink,
  offline: featureAccentsLight.budget.ink,
  tests: featureAccentsLight.tests.ink,
  budget: featureAccentsLight.budget.ink,
};

/** @deprecated Alias of `featureAccents`'s key set; use `FeatureKey`. */
export type LegacyFeatureKey = keyof typeof featureAccents;

// ---------------------------------------------------------------------------
// Spacing, radius, type
// ---------------------------------------------------------------------------
// The type scale is a closed set of named steps (TYPE_STEP_NAMES). Web lints
// against an allowlist so an ad-hoc font size cannot creep in; keep new sizes
// as named steps rather than one-off numbers.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
} as const;

/**
 * The six type steps (spec v3 §6.5). One role each, nothing below 11px.
 *
 * Sizes are PIXELS on BOTH platforms this wave (founder decision 2): mobile's
 * NativeWind rem is 14, so a rem ladder renders 12.5% smaller than its own
 * names — px until that root cause is fixed.
 *
 * `letterSpacing` is the em value CSS wants; `letterSpacingPx` is the same
 * tracking pre-multiplied for React Native, which takes points only — the
 * exact product, unrounded, so it equals apps/mobile/src/design/typeScale.ts
 * and apps/mobile/tailwind.config.js digit for digit.
 */
export type TypeStep = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
  letterSpacing: string;
  letterSpacingPx: number;
};

export type TypeStepName =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'caption'
  | 'label';

export const TYPE_STEP_NAMES = [
  'display',
  'title',
  'heading',
  'body',
  'caption',
  'label',
] as const;

export const type: Record<TypeStepName, TypeStep> = {
  /** hero greeting, score numeral */
  display: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: '-0.02em',
    letterSpacingPx: -0.56,
  },
  /** every screen h1, modal title */
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: '-0.02em',
    letterSpacingPx: -0.44,
  },
  /** section h2, card title, flashcard face */
  heading: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: '-0.011em',
    letterSpacingPx: -0.187,
  },
  /** all prose, chat, list titles (which take weight 600) */
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: '-0.011em',
    letterSpacingPx: -0.165,
  },
  /** secondary copy, timestamps, stat labels */
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    letterSpacing: '0',
    letterSpacingPx: 0,
  },
  /** uppercase eyebrows, badges, tab labels — the 11px floor */
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: '0.04em',
    letterSpacingPx: 0.44,
  },
};

export const typeStack = {
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /**
   * System serif only. A real display face (Crimson Pro) is a Wave V3
   * decision scoped to web `.prose` and page `h1`; it is deliberately not
   * bundled on mobile, where it would cost 40-60 KB per weight.
   */
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
} as const;

/**
 * @deprecated Use `type`. Kept for one release as a DERIVED alias so it can
 * never describe a different product than the one that ships (the failure
 * mode called out in spec v3 §6.2). `subtitle` maps to the `heading` step.
 * It has no call sites today; delete with Wave T.
 */
export const typography = {
  display: {
    size: type.display.fontSize,
    lineHeight: type.display.lineHeight,
    weight: type.display.fontWeight,
  },
  title: {
    size: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    weight: type.title.fontWeight,
  },
  subtitle: {
    size: type.heading.fontSize,
    lineHeight: type.heading.lineHeight,
    weight: type.heading.fontWeight,
  },
  body: {
    size: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    weight: type.body.fontWeight,
  },
  caption: {
    size: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    weight: type.caption.fontWeight,
  },
  label: {
    size: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    weight: type.label.fontWeight,
  },
} as const;

export const fontStacks = {
  full: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  display: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  lowData: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

/** CSS custom property names for web */
// ---------------------------------------------------------------------------
// CSS variable bridge (web)
// ---------------------------------------------------------------------------
// Names and the palette -> custom-property conversion. Values are emitted as
// RGB channel triples, not hex, so Tailwind can apply an alpha to them.

export const cssVarNames = {
  background: '--color-background',
  backgroundSecondary: '--color-background-secondary',
  navColumn: '--color-nav-column',
  navColumnText: '--color-nav-column-text',
  navColumnTextSecondary: '--color-nav-column-text-secondary',
  navColumnActive: '--color-nav-column-active',
  ink: '--color-ink',
  surface: '--color-surface',
  surfaceSecondary: '--color-surface-secondary',
  text: '--color-text',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  primary: '--color-primary',
  primaryLight: '--color-primary-light',
  primaryDark: '--color-primary-dark',
  primaryBackground: '--color-primary-background',
  primaryFill: '--color-primary-fill',
  primaryText: '--color-primary-text',
  accent: '--color-accent',
  accentBackground: '--color-accent-background',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
  // Fill-role red: the one a white numeral/label sits on. See `errorStrong`.
  errorStrong: '--color-error-strong',
  info: '--color-info',
  border: '--color-border',
  radiusLg: '--radius-lg',
  radiusXl: '--radius-xl',
  fontSans: '--font-sans',
} as const;

/**
 * CSS-variable values for a palette. Colour vars hold RGB CHANNELS
 * ("79 70 229") because Tailwind declares them as
 * `rgb(var(--x) / <alpha-value>)`; primaryBackground / accentBackground stay
 * whole colours because their dark values carry their own alpha.
 * See design/colorChannels.ts.
 */
export function paletteToCssVars(palette: ThemePalette): Record<string, string> {
  const ch = (hex: string): string => {
    const raw = hex.trim().replace("#", "");
    const full =
      raw.length === 3 || raw.length === 4
        ? raw
            .split("")
            .map((c) => c + c)
            .join("")
        : raw;
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return hex;
    return `${parseInt(full.slice(0, 2), 16)} ${parseInt(full.slice(2, 4), 16)} ${parseInt(full.slice(4, 6), 16)}`;
  };
  return {
    [cssVarNames.background]: ch(palette.background),
    [cssVarNames.backgroundSecondary]: ch(palette.backgroundSecondary),
    [cssVarNames.navColumn]: ch(palette.navColumn),
    [cssVarNames.navColumnText]: ch(palette.navColumnText),
    [cssVarNames.navColumnTextSecondary]: ch(palette.navColumnTextSecondary),
    [cssVarNames.surface]: ch(palette.surface),
    [cssVarNames.surfaceSecondary]: ch(palette.surfaceSecondary),
    [cssVarNames.text]: ch(palette.text),
    [cssVarNames.textSecondary]: ch(palette.textSecondary),
    [cssVarNames.textTertiary]: ch(palette.textTertiary),
    [cssVarNames.primary]: ch(palette.primary),
    [cssVarNames.primaryLight]: ch(palette.primaryLight),
    [cssVarNames.primaryDark]: ch(palette.primaryDark),
    [cssVarNames.primaryBackground]: palette.primaryBackground,
    [cssVarNames.primaryFill]: ch(palette.primaryFill),
    [cssVarNames.primaryText]: ch(palette.primaryText),
    [cssVarNames.accent]: ch(palette.accent),
    [cssVarNames.accentBackground]: palette.accentBackground,
    [cssVarNames.success]: ch(palette.success),
    [cssVarNames.warning]: ch(palette.warning),
    [cssVarNames.error]: ch(palette.error),
    [cssVarNames.errorStrong]: ch(palette.errorStrong),
    [cssVarNames.info]: ch(palette.info),
    [cssVarNames.border]: ch(palette.border),
    [cssVarNames.radiusLg]: `${radius.lg}px`,
    [cssVarNames.radiusXl]: `${radius.xl}px`,
  };
}

// ===========================================
// CSS-variable bridge (web `index.css` <-> mobile theme vars)
// ===========================================
//
// One source for both platforms. `index.css` `:root` / `.dark` and the mobile
// `lanternCssVars.ts` must both be expressible as the output of these
// functions; `scripts/design/contrast.mjs` diffs the CSS file against these
// values and fails on drift.

/** `--color-feature-<key>-ink` / `-tint` for one theme, as RGB CHANNELS. */
export function featureAccentPairsToCssVars(
  pairs: Record<FeatureKey, FeatureAccentPair>,
  prefix = '--color-feature'
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FEATURE_KEYS) {
    out[`${prefix}-${key}-ink`] = hexChannels(pairs[key].ink);
    out[`${prefix}-${key}-tint`] = hexChannels(pairs[key].tint);
  }
  return out;
}

/**
 * `--color-feature-<key>-small-ink` for one theme, as RGB CHANNELS.
 *
 * Separate from `featureAccentPairsToCssVars` on purpose: that function's
 * output is exactly two vars per feature and a test pins that shape.
 */
export function featureSmallTextInkCssVars(
  mode: 'light' | 'dark',
  prefix = '--color-feature'
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FEATURE_KEYS) {
    out[`${prefix}-${key}-small-ink`] = hexChannels(featureSmallTextInk(key, mode));
  }
  return out;
}

/**
 * `--type-<step>-size/-lh/-weight/-tracking`, plus the family stacks that are
 * theme-independent. `--font-sans` is NOT emitted here: it is owned by the
 * user's font-mode setting (`useFontMode`), which would fight this.
 */
export function typeScaleToCssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of TYPE_STEP_NAMES) {
    const step = type[name];
    out[`--type-${name}-size`] = `${step.fontSize}px`;
    out[`--type-${name}-lh`] = `${step.lineHeight}px`;
    out[`--type-${name}-weight`] = step.fontWeight;
    out[`--type-${name}-tracking`] = step.letterSpacing;
  }
  out['--font-serif'] = typeStack.serif;
  out['--font-mono'] = typeStack.mono;
  return out;
}

/** Everything one theme needs: palette + feature pairs + (light only) type. */
export function lanternCssVars(mode: 'light' | 'dark'): Record<string, string> {
  return {
    ...paletteToCssVars(mode === 'dark' ? darkTheme : lightTheme),
    ...featureAccentPairsToCssVars(mode === 'dark' ? featureAccentsDark : featureAccentsLight),
    ...featureSmallTextInkCssVars(mode),
    ...typeScaleToCssVars(),
  };
}

/** Local copy of the hex -> "R G B" conversion (see design/colorChannels.ts). */
function hexChannels(hex: string): string {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3 || raw.length === 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return hex;
  return `${parseInt(full.slice(0, 2), 16)} ${parseInt(full.slice(2, 4), 16)} ${parseInt(full.slice(4, 6), 16)}`;
}
