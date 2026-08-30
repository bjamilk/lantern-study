export { ThemeProvider, useAppTheme } from './ThemeProvider';
export { useTheme, useColors, lightColors, darkColors, ColorsThemeProvider } from './ThemeContext';
export type { ThemeColors, ThemeMode } from './ThemeContext';
export { ThemeScope } from './ThemeScope';
export { lightLanternVars, darkLanternVars } from './lanternCssVars';

/**
 * Blend a theme hex colour with alpha for inline styles.
 *
 * NativeWind CANNOT do this with class names here: the lantern-* palette is
 * exposed to Tailwind as bare `var(--color-lantern-*)` strings, and Tailwind v3
 * silently DROPS any `/opacity` modifier on a colour it cannot parse — so
 * `bg-lantern-primary/15` compiles to no rule at all and renders nothing.
 * Use this with a `style` prop instead of an opacity class on any lantern
 * colour.
 */
export function withAlpha(hex: string, alpha: number): string {
  const raw = (hex || '').replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.slice(0, 6);
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
