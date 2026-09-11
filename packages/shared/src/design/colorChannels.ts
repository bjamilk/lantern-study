/**
 * Hex → "R G B" channel strings for the Tailwind `<alpha-value>` pattern.
 *
 * WHY THIS EXISTS: the palettes reach Tailwind as CSS variables. When a
 * variable holds a whole colour (`#4f46e5`), Tailwind cannot parse it, so it
 * SILENTLY DROPS every `/opacity` utility built on it — no rule, no warning.
 * That is why `bg-lantern-primary/10` rendered nothing on either platform
 * (418 such classes on web, 93 on mobile).
 *
 * Declaring the colour as `rgb(var(--x) / <alpha-value>)` fixes it, but only
 * if the variable holds the three channels on their own.
 *
 * ALL-OR-NOTHING: a variable still holding hex inside `rgb(var(--x) / a)`
 * computes to transparent on web, and returns undefined in NativeWind's
 * runtime — killing even the plain, non-alpha classes. The variable producer
 * and the Tailwind declaration must therefore change together.
 */

/** True for an 8-digit hex, i.e. one carrying its own alpha (#6366f120). */
export function hexHasAlpha(hex: string): boolean {
  const raw = (hex || '').trim().replace('#', '');
  return raw.length === 8 || raw.length === 4;
}

/**
 * '#4f46e5' → '79 70 229'. Returns null when the input is not a hex colour, so
 * callers can pass the original value through untouched rather than emitting
 * something that silently renders as transparent.
 *
 * An alpha-carrying hex returns its RGB channels only; the alpha is NOT
 * representable here, so such tokens must keep their whole-colour form.
 */
export function hexToRgbChannels(hex: string): string | null {
  const raw = (hex || '').trim().replace('#', '');
  const expanded =
    raw.length === 3 || raw.length === 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) return null;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return `${r} ${g} ${b}`;
}

/**
 * The palette keys exposed to Tailwind as CSS variables, in one place so web
 * and mobile cannot drift. Anything not listed here is consumed as a whole
 * colour in style props and is unaffected by the channel conversion.
 */
export const LANTERN_CSS_VAR_PALETTE_KEYS = [
  'background',
  'backgroundSecondary',
  'navColumn',
  'navColumnText',
  'navColumnTextSecondary',
  'surface',
  'surfaceSecondary',
  'text',
  'textSecondary',
  'textTertiary',
  'primary',
  'primaryLight',
  'primaryDark',
  'primaryBackground',
  'accent',
  'accentBackground',
  'success',
  'warning',
  'error',
  'border',
] as const;

export type LanternCssVarPaletteKey = (typeof LANTERN_CSS_VAR_PALETTE_KEYS)[number];

/**
 * Palette keys whose value carries its own alpha and must therefore stay a
 * whole colour (declared in Tailwind as a bare `var()`, without
 * `<alpha-value>`). Converting these to channels would silently make two
 * translucent dark-mode surfaces fully opaque.
 */
export const ALPHA_BAKED_PALETTE_KEYS = ['primaryBackground', 'accentBackground'] as const;

export type AlphaBakedPaletteKey = (typeof ALPHA_BAKED_PALETTE_KEYS)[number];

export function isAlphaBakedPaletteKey(key: string): key is AlphaBakedPaletteKey {
  return (ALPHA_BAKED_PALETTE_KEYS as readonly string[]).includes(key);
}
