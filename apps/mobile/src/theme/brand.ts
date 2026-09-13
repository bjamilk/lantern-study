import { lightTheme, darkTheme, type ThemePalette } from '@lantern/shared/design';

/**
 * The brand ink, readable WITHOUT a hook.
 *
 * Round 2 colour pivot (2026-09-12): the phone's indigo (`#4f46e5` / `#6366f1`
 * / `#818cf8`) is gone. Every brand fill, border, tint and glyph is now the
 * theme's strong ink — near-black `#191919` on the light paper ground, near-
 * white `#f5f5f5` on the dark one — the same pair the StudyFetch-look pills in
 * `layout/BottomTabBar.tsx` already use. The values live in the shared palette
 * (`packages/shared/src/design/tokens.ts`); nothing is restated here.
 *
 * WHY a mutable module value rather than `useColors()`: roughly a hundred of
 * these call sites are `StyleSheet.create({...})` objects at module scope, or
 * `ActivityIndicator color=` / `RefreshControl tintColor=` props inside
 * components that never took the theme context. Those sites held a LITERAL
 * indigo hex, so they did not follow dark mode at all. Reading through this
 * object at render time is strictly better: a screen mounted in dark mode now
 * paints the light ink.
 *
 * The one thing it does NOT do is repaint a component that is already mounted
 * when the user flips the theme and that component consumes no context — RN
 * has nothing to re-render it. Prefer `useColors()` in anything new; this is
 * the bridge for the static sites, not a replacement for the context.
 */
let currentPalette: ThemePalette = lightTheme;

/** Called by ThemeProvider whenever the effective theme changes. */
export function setBrandPalette(isDark: boolean): void {
  currentPalette = isDark ? darkTheme : lightTheme;
}

/** Test seam: the palette the brand accessors are currently reading. */
export function getBrandPalette(): ThemePalette {
  return currentPalette;
}

export const brand = {
  /** The solid pill / filled-control ground. A ground, never text. */
  get ink(): string {
    return currentPalette.primaryFill;
  },
  /** The label or glyph that sits ON `ink`. Inverts with it. */
  get onInk(): string {
    return currentPalette.textInverse;
  },
  /** Brand-coloured TEXT or a glyph on the page ground. Never a fill. */
  get text(): string {
    return currentPalette.primaryText;
  },
  /** The soft brand ground behind brand text (putty in light). */
  get tint(): string {
    return currentPalette.primaryBackground;
  },
  /** A hairline in the brand colour. */
  get border(): string {
    return currentPalette.primaryText;
  },
} as const;

/**
 * The ink as a FIXED value, for the two places the live getters above cannot
 * reach:
 *
 *  1. `StyleSheet.create({...})` at module scope. It is evaluated once, at
 *     import time, so a getter would be frozen to whichever theme happened to
 *     be current then — worse than a literal, because it is non-obvious.
 *  2. A filled control whose LABEL is a hard-coded `#fff`. Inverting the
 *     ground without inverting the label is how you get white-on-white.
 *
 * These sites held a literal indigo before this pivot and so never followed
 * dark mode either; pinning them to the light ink keeps the pairing honest
 * while the pivot lands. Migrating them to `useColors()` is follow-up work.
 */
export const BRAND_INK = lightTheme.primaryFill;
/** The label on `BRAND_INK`. Fixed, for the same reason. */
export const BRAND_ON_INK = lightTheme.textInverse;
/** The soft brand ground (putty). Fixed, for module-scope StyleSheet. */
export const BRAND_TINT = lightTheme.primaryBackground;
