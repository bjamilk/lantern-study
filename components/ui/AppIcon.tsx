import React from 'react';
import { APP_ICONS, type AppIconName } from './appIconMap';
import { strokeWidthForSize } from './appIconStroke';

export type { AppIconName };
export { strokeWidthForSize, LUCIDE_DEFAULT_STROKE_WIDTH } from './appIconStroke';
export { APP_ICONS, isAppIconName } from './appIconMap';

/** Matches the call sites this replaces, which overwhelmingly drew at 24. */
export const APP_ICON_DEFAULT_SIZE = 24;

/**
 * Catches `w-5`, `h-6`, `size-4` and their responsive/state variants, which
 * are how every heroicon call site was sized. See the `size` prop.
 */
const TAILWIND_SIZING_CLASS = /(?:^|\s|:)(?:w|h|size)-(?:\d|\[)/;

/**
 * Vite's `import.meta.env.DEV`, read defensively. The web app's tsconfig does
 * not pull in vite/client, so `import.meta.env` is not on the ambient
 * ImportMeta type; narrowing it here keeps this file type-clean anywhere it is
 * compiled, and folds to `false` under any bundler that does not define it.
 */
const IS_DEV =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

export interface AppIconProps {
  name: AppIconName;
  /**
   * Raw pixels. This is the ONE dimension prop: it sets the SVG box AND picks
   * the stroke weight off the ramp.
   *
   * Do not size an AppIcon with `w-5 h-5` the way the heroicons call sites
   * did. A CSS class beats lucide's width/height attributes, so the glyph
   * would shrink while the stroke stayed at whatever weight `size` implied —
   * a hairline at a small box, which is the exact bug this component exists to
   * end. Translate `w-N h-N` to `size={N * 4}` instead; a dev build warns if
   * you forget.
   */
  size?: number;
  /** Colour, spacing, transitions. Never sizing — see `size`. */
  className?: string;
  /**
   * Paints the glyph solid in its own colour. This is how every heroicons
   * 24/outline + 24/solid pair collapses to a single name: a saved bookmark is
   * `name="bookmark" filled`, an unsaved one is the same name without it.
   *
   * Not every heroicons pair was a fill state. `CheckCircleIcon`/`XCircleIcon`
   * and friends carry interior detail a fill paints flat; those keep the
   * outline and change colour instead.
   */
  filled?: boolean;
  /** Escape hatch. Leave unset so appIconStroke.ts stays the single source. */
  strokeWidth?: number;
  /** Screen-reader label, for the rare icon that carries meaning on its own. */
  'aria-label'?: string;
  /** Set false only when a label above is the icon's whole meaning. */
  'aria-hidden'?: boolean;
  title?: string;
  onClick?: React.MouseEventHandler<SVGSVGElement>;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

/**
 * The web app's only icon primitive, and the twin of
 * apps/mobile/src/components/ui/AppIcon.tsx.
 *
 * Which glyph, how heavy its stroke, whether it is filled — all decided here,
 * so "make the icons bolder" is one edit rather than six hundred and seventy.
 */
export function AppIcon({
  name,
  size = APP_ICON_DEFAULT_SIZE,
  className,
  filled = false,
  strokeWidth,
  title,
  onClick,
  style,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  'data-testid': dataTestId,
}: AppIconProps) {
  if (IS_DEV && className && TAILWIND_SIZING_CLASS.test(className)) {
    console.warn(
      `[AppIcon] "${name}" was given a sizing class (${className}). Pass size={n} ` +
        'instead — a class overrides the SVG box but not the stroke, which is how ' +
        'an icon ends up drawn small with a hairline outline.'
    );
  }

  const Glyph = APP_ICONS[name];
  return (
    <Glyph
      size={size}
      className={className}
      // lucide paints `fill: none` by default. A solid glyph is the same path
      // filled in its own stroke colour; `currentColor` keeps it inheriting
      // from whatever text colour the call site already set.
      fill={filled ? 'currentColor' : 'none'}
      strokeWidth={strokeWidth ?? strokeWidthForSize(size)}
      absoluteStrokeWidth={false}
      style={style}
      onClick={onClick}
      // Decorative by default: nearly every one of these sits beside a label,
      // and an unlabelled glyph in the accessibility tree is noise.
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      data-testid={dataTestId}
    >
      {title ? <title>{title}</title> : null}
    </Glyph>
  );
}

export default AppIcon;
