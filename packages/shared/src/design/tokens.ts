// ===========================================
// Lantern Study - Shared Design Tokens
// ===========================================

export const lanternColors = {
  primary: '#4f46e5',
  primaryLight: '#6366f1',
  primaryDark: '#3730a3',
  // UI-02: amber-600 (#d97706) was 3.0-3.6:1 as text on white/cream and under
  // white button labels; amber-700 clears AA for both roles.
  accent: '#b45309',
  accentLight: '#f59e0b',
  accentDark: '#b45309',
} as const;

const lightBase = {
  // Warm off-white: hsl(30°, 50%, 96%) — easier on the eyes than cool alice-blue
  background: '#faf5f0',
  backgroundSecondary: '#f3ebe2',
  // Desktop destination rail. Darker brown than the page cream so the menu
  // column reads as chrome. Body and secondary ink clear AA; tertiary does not,
  // so that rail uses secondary for muted glyphs.
  navColumn: '#e4cab4',
  surface: '#ffffff',
  surfaceSecondary: '#f1f5f9',
  card: '#ffffff',
  cardSecondary: '#f1f5f9',
  text: '#0f172a',
  textSecondary: '#475569',
  // UI-02: #64748b was 4.39:1 on the warm background at the 10-12px sizes
  // this token styles; #5b6a7f clears 4.5:1 on cream and white.
  textTertiary: '#5b6a7f',
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
  primaryBackground: '#eef2ff',
  /**
   * Primary used as a FILL under WHITE text (buttons, badges, chips).
   * White on #4f46e5 is 6.29:1. Identical in both themes on purpose: a fill
   * that carries white has to be dark, and "dark mode" does not change that.
   */
  primaryFill: lanternColors.primary,
  /**
   * Primary used as TEXT or an icon glyph, on the surface, the card AND the
   * `primaryBackground` tint. Light: 6.29 on white, 5.80 on cream, 5.62 on
   * the #eef2ff tint.
   */
  primaryText: lanternColors.primary,
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
  border: '#c5cedd',
  borderLight: '#e2e8f0',
  tabBar: '#ffffff',
  tabBarBorder: '#c5cedd',
  tabBarActive: lanternColors.primary,
  tabBarInactive: '#5b6a7f',
  inputBackground: '#f1f5f9',
  inputBorder: '#c5cedd',
  inputText: '#0f172a',
  inputPlaceholder: '#5b6a7f',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#ffffff',
  switchTrackOn: '#4f46e580',
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
  navColumn: '#1c1814',
  surface: '#101214',
  surfaceSecondary: '#1a1d21',
  card: '#101214',
  cardSecondary: '#1a1d21',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  // UI-01: #64748b was ~3.5–3.9:1 on dark surfaces; #8494a8 clears 4.5:1 AA.
  textTertiary: '#8494a8',
  textInverse: '#0f172a',
  chatBackground: '#000000',
  chatBubbleOwn: '#005c4b',
  chatBubbleOther: '#202c33',
  // Pure white on the green own-bubble — #e9edef read as dull (user request).
  chatBubbleText: '#ffffff',
  chatBubbleMeta: '#b0c0c8',
  /** @deprecated See lightBase.primary. Dark's dominant role is TEXT, so this
   * equals `primaryText`; using it as a FILL under white is the 2.98:1 bug
   * found on build 153 (Home's "Review due cards"). Use `primaryFill`. */
  primary: '#818cf8',
  primaryLight: '#a5b4fc',
  primaryDark: '#6366f1',
  primaryBackground: '#6366f120',
  /**
   * Same value as light: white text needs a dark ground in either theme.
   * #818cf8 (the dark `primary`) under white is 2.98:1; #4f46e5 is 6.29:1.
   */
  primaryFill: lanternColors.primary,
  /**
   * Primary used as TEXT on the dark surface, the black page AND the
   * translucent #6366f120 tint composited over both: 6.29 / 7.04 / 5.58 /
   * 6.45. The raw #6366f1 is 4.20 on the surface and 4.07 on the tint.
   */
  primaryText: '#818cf8',
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
  tabBarActive: '#818cf8',
  tabBarInactive: '#8494a8',
  inputBackground: '#101214',
  inputBorder: '#2f3336',
  inputText: '#f8fafc',
  inputPlaceholder: '#8494a8',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: '#101214',
  switchTrackOn: '#818cf880',
  switchTrackOff: '#2f3336',
  switchThumbOn: '#818cf8',
  switchThumbOff: '#8494a8',
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
export const FEATURE_KEYS = [
  'notes',
  'flashcards',
  'tests',
  'recording',
  'ai',
  'groups',
  'campus',
  'budget',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureAccentPair = { ink: string; tint: string };

export const featureAccentsLight: Record<FeatureKey, FeatureAccentPair> = {
  notes: { ink: '#0f766e', tint: '#ccfbf1' },
  flashcards: { ink: '#4d7c0f', tint: '#ecfccb' },
  tests: { ink: '#0369a1', tint: '#e0f2fe' },
  recording: { ink: '#a21caf', tint: '#fae8ff' },
  ai: { ink: '#4f46e5', tint: '#eef2ff' },
  groups: { ink: '#047857', tint: '#d1fae5' },
  campus: { ink: '#6d28d9', tint: '#ede9fe' },
  budget: { ink: '#b45309', tint: '#fef3c7' },
};

export const featureAccentsDark: Record<FeatureKey, FeatureAccentPair> = {
  notes: { ink: '#5eead4', tint: '#0f2f2c' },
  flashcards: { ink: '#bef264', tint: '#1a2e0a' },
  tests: { ink: '#7dd3fc', tint: '#0c2a3b' },
  recording: { ink: '#f0abfc', tint: '#3b0f40' },
  ai: { ink: '#818cf8', tint: '#1c1c3a' },
  groups: { ink: '#6ee7b7', tint: '#0b2e22' },
  campus: { ink: '#c4b5fd', tint: '#2a1b4d' },
  budget: { ink: '#fbbf24', tint: '#3a2a08' },
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
  flashcards: '#3f6212',
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
export const cssVarNames = {
  background: '--color-background',
  backgroundSecondary: '--color-background-secondary',
  navColumn: '--color-nav-column',
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
