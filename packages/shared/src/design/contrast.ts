/**
 * WCAG 2.1 contrast for the design tokens.
 *
 * WHY THIS EXISTS: spec v3 §6.4 found that every contrast failure in Lantern
 * is a colour used as TEXT on a ground nobody checked — feature accents, stat
 * numerals, chat meta. The palette itself is fine. So the gate is not "is the
 * palette accessible" but "is every ink legible on every ground it is painted
 * on", and it has to run in CI, not in a notebook.
 *
 * Two consumers share this module so they cannot disagree:
 *   - `contrast.test.ts` (jest, in this package) checks the TOKENS;
 *   - `scripts/design/contrast.mjs` checks what `index.css` actually ships
 *     and diffs it against the tokens.
 */

import {
  FEATURE_KEYS,
  type ThemePalette,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
} from './tokens';

export const AA_NORMAL = 4.5;
/** AA for large text only: >=24px, or >=18.66px at weight 700. */
export const AA_LARGE = 3;

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** '#0f766e' | '#f0a' -> [r, g, b]; an 8-digit hex keeps only its RGB. */
export function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3 || raw.length === 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type ContrastCheck = {
  /** e.g. 'light feature notes ink' */
  subject: string;
  /** e.g. 'own tint #ccfbf1' */
  ground: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
};

/**
 * Tokens whose 3:1 large-text threshold is accepted, with the reason each is
 * only ever painted at >=24px (or >=18.66px/700). EMPTY BY DESIGN: an entry
 * here is a promise about every call site of that token, so adding one is a
 * decision, not a convenience.
 */
export const LARGE_TEXT_ONLY: Record<string, string> = {};

/**
 * Palette keys that are FILL or CHROME roles and are never painted as text,
 * so a text threshold would be meaningless. Recorded here rather than
 * silently skipped.
 */
const NON_TEXT_ROLES: Record<string, string> = {
  primaryFill: 'fill only; gated below by WHITE on it, not by it as text',
  primaryLight: 'gradient/hover fill only; text uses `primaryText`',
  primaryDark: 'pressed-state fill and gradient stop only',
  textInverse: 'always paired with a saturated fill, checked at the fill',
};

/** The palette keys that DO carry text, and are therefore gated. */
export const TEXT_PALETTE_KEYS = [
  'text',
  'textSecondary',
  'textTertiary',
  'primary',
  'primaryText',
  'accent',
  'success',
  'warning',
  'error',
  'info',
] as const;

export type TextPaletteKey = (typeof TEXT_PALETTE_KEYS)[number];

function minFor(subject: string): number {
  return subject in LARGE_TEXT_ONLY ? AA_LARGE : AA_NORMAL;
}

function check(subject: string, ground: string, fg: string, bg: string): ContrastCheck {
  const ratio = contrastRatio(fg, bg);
  const min = minFor(subject);
  return { subject, ground, fg, bg, ratio, min, pass: ratio >= min };
}

/**
 * Every check the design system must pass.
 *
 * Feature inks are checked on the three grounds they are actually painted on
 * per theme (spec §5.6): their own tint, the card surface, and the page
 * ground. Body ink is checked on every tint, because a tinted card is a
 * reading surface. Palette text tokens are checked on the page ground and the
 * card surface.
 */
export function allContrastChecks(): ContrastCheck[] {
  const out: ContrastCheck[] = [];

  for (const key of FEATURE_KEYS) {
    const light = featureAccentsLight[key];
    out.push(
      check(`light feature ${key} ink`, `own tint ${light.tint}`, light.ink, light.tint),
      check(`light feature ${key} ink`, `surface ${lightTheme.surface}`, light.ink, lightTheme.surface),
      check(
        `light feature ${key} ink`,
        `page ${lightTheme.background}`,
        light.ink,
        lightTheme.background
      ),
      check(`light body ink`, `feature ${key} tint ${light.tint}`, lightTheme.text, light.tint)
    );

    const dark = featureAccentsDark[key];
    out.push(
      check(`dark feature ${key} ink`, `own tint ${dark.tint}`, dark.ink, dark.tint),
      check(`dark feature ${key} ink`, `surface ${darkTheme.surface}`, dark.ink, darkTheme.surface),
      check(`dark feature ${key} ink`, `page ${darkTheme.background}`, dark.ink, darkTheme.background),
      check(`dark body ink`, `feature ${key} tint ${dark.tint}`, darkTheme.text, dark.tint)
    );
  }

  for (const key of TEXT_PALETTE_KEYS) {
    out.push(
      check(`light ${key}`, `page ${lightTheme.background}`, lightTheme[key], lightTheme.background),
      check(`light ${key}`, `surface ${lightTheme.surface}`, lightTheme[key], lightTheme.surface),
      check(`dark ${key}`, `page ${darkTheme.background}`, darkTheme[key], darkTheme.background),
      check(`dark ${key}`, `surface ${darkTheme.surface}`, darkTheme[key], darkTheme.surface)
    );
  }

  out.push(...primarySplitChecks(lightTheme, 'light'), ...primarySplitChecks(darkTheme, 'dark'));

  return out;
}

/**
 * The `primaryFill` / `primaryText` split (build 153). One `primary` token was
 * serving both roles, so dark's text-first #818cf8 was also painting Home's
 * "Review due cards" — white on it is 2.98:1 — while the accent-derived text
 * ink was only ever checked against the surface and so failed on the
 * `primaryBackground` TINT (4.07 dark, 4.35 light).
 *
 * So: the fill is gated by WHITE on it, and the text ink by all four grounds
 * it is actually painted on — surface, card, page, and the tint composited
 * over the surface and over the page.
 */
export function primarySplitChecks(
  palette: Pick<
    ThemePalette,
    'primaryFill' | 'primaryText' | 'primaryBackground' | 'surface' | 'card' | 'background'
  >,
  label: string
): ContrastCheck[] {
  const tintOverSurface = compositeOver(palette.primaryBackground, palette.surface);
  const tintOverPage = compositeOver(palette.primaryBackground, palette.background);
  return [
    check(`${label} white on primaryFill`, `fill ${palette.primaryFill}`, '#ffffff', palette.primaryFill),
    check(`${label} primaryText`, `surface ${palette.surface}`, palette.primaryText, palette.surface),
    check(`${label} primaryText`, `card ${palette.card}`, palette.primaryText, palette.card),
    check(`${label} primaryText`, `page ${palette.background}`, palette.primaryText, palette.background),
    check(
      `${label} primaryText`,
      `primaryBackground ${palette.primaryBackground} over surface (${tintOverSurface})`,
      palette.primaryText,
      tintOverSurface
    ),
    check(
      `${label} primaryText`,
      `primaryBackground ${palette.primaryBackground} over page (${tintOverPage})`,
      palette.primaryText,
      tintOverPage
    ),
  ];
}

export function failingChecks(checks = allContrastChecks()): ContrastCheck[] {
  return checks.filter((c) => !c.pass);
}

export function formatCheck(c: ContrastCheck): string {
  return `${c.pass ? 'PASS' : 'FAIL'}  ${c.ratio.toFixed(2)}:1 (min ${c.min})  ${c.subject} ${c.fg} on ${c.ground}`;
}

export { NON_TEXT_ROLES };


function hexFromRgb(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Flatten a possibly-translucent `#RRGGBBAA` colour onto an opaque base.
 *
 * Dark's `primaryBackground` is `#6366f120` — a 12.5%-alpha tint. Measuring
 * an ink against the raw hex ignores the surface showing through and
 * overstates the ratio; this is the compositing the eye does.
 */
export function compositeOver(fg: string, base: string): string {
  const raw = fg.trim().replace('#', '');
  const alpha = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
  const [r, g, b] = parseHex(fg);
  if (alpha >= 1) return hexFromRgb(r, g, b);
  const [br, bg_, bb] = parseHex(base);
  return hexFromRgb(
    r * alpha + br * (1 - alpha),
    g * alpha + bg_ * (1 - alpha),
    b * alpha + bb * (1 - alpha)
  );
}

/**
 * Darken (or lighten) a FILL minimally until `on` — white, in practice —
 * reaches `ratio` against it. The counterpart of `ensureTextContrast`: there
 * the ink moves, here the ground does, because the label on a primary button
 * is white by definition.
 */
export function ensureFillContrast(
  fill: string,
  on = '#ffffff',
  ratio = AA_NORMAL
): string {
  if (contrastRatio(fill, on) >= ratio) return fill;
  // Move the fill AWAY from the label: white label -> darken.
  const towardWhite = relativeLuminance(on) < 0.5;
  const [r, g, b] = parseHex(fill);
  const [tr, tg, tb] = towardWhite ? [255, 255, 255] : [0, 0, 0];
  for (let i = 1; i <= 20; i += 1) {
    const t = i / 20;
    const candidate = hexFromRgb(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
    if (contrastRatio(candidate, on) >= ratio) return candidate;
  }
  return towardWhite ? '#ffffff' : '#000000';
}

/**
 * `ensureTextContrast` against SEVERAL grounds at once, returning the single
 * ink that clears `ratio` on all of them — i.e. the most-adjusted result,
 * found in one pass rather than by comparing per-ground answers.
 *
 * `grounds[0]` must be opaque; it sets the mix direction and is the base any
 * later `#RRGGBBAA` tint is composited over. Checking the surface alone is
 * what shipped a "Try Again" that passed on the card and failed on its own
 * tint (build 153).
 */
export function ensureTextContrastOn(
  fg: string,
  grounds: string[],
  ratio = AA_NORMAL
): string {
  const base = grounds[0];
  if (base === undefined) return fg;
  const flat = grounds.map((g) => compositeOver(g, base));
  const passes = (c: string) => flat.every((g) => contrastRatio(c, g) >= ratio);
  if (passes(fg)) return fg;
  const towardWhite = relativeLuminance(base) < 0.5;
  const [r, g, b] = parseHex(fg);
  const [tr, tg, tb] = towardWhite ? [255, 255, 255] : [0, 0, 0];
  for (let i = 1; i <= 20; i += 1) {
    const t = i / 20;
    const candidate = hexFromRgb(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
    if (passes(candidate)) return candidate;
  }
  return towardWhite ? '#ffffff' : '#000000';
}

/**
 * Return `fg` unchanged when it already reaches `ratio` on `bg`; otherwise mix
 * it step by step toward white (on dark grounds) or black (on light grounds)
 * until it does. Used for TEXT roles derived from a user-chosen accent: the
 * default accent #6366f1 is 4.20:1 on the dark surface, so "Retake" and
 * "Try Again" failed AA in dark mode (build 152). Fills keep the raw accent.
 * Single-ground form; prefer `ensureTextContrastOn` when a tint is involved.
 */
export function ensureTextContrast(fg: string, bg: string, ratio = AA_NORMAL): string {
  if (contrastRatio(fg, bg) >= ratio) return fg;
  const towardWhite = relativeLuminance(bg) < 0.5;
  const [r, g, b] = parseHex(fg);
  const [tr, tg, tb] = towardWhite ? [255, 255, 255] : [0, 0, 0];
  for (let i = 1; i <= 20; i += 1) {
    const t = i / 20;
    const candidate = hexFromRgb(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
    if (contrastRatio(candidate, bg) >= ratio) return candidate;
  }
  return towardWhite ? '#ffffff' : '#000000';
}
