/**
 * Types for lucide-react's per-icon deep imports.
 *
 * lucide-react 1.41 ships one `.mjs` per glyph under dist/esm/icons/ but puts
 * every type in a single 316KB dist/lucide-react.d.ts barrel, with no
 * declaration file beside the glyph modules. So `import Trash from
 * 'lucide-react/dist/esm/icons/trash.mjs'` resolves at build time and is
 * `any` at type time — which would quietly turn all ~194 glyphs in
 * appIconMap.ts into `any` and make AppIcon's props unchecked.
 *
 * This declares the shape once for the whole pattern. It is written with
 * inline `import(...)` types and no top-level import on purpose: a `.d.ts`
 * with a top-level import is a module, and `declare module` inside a module is
 * an augmentation, which cannot introduce a new wildcard pattern. Keeping the
 * file a global script is what makes the wildcard work.
 *
 * Declaring it structurally also keeps that 316KB barrel out of the program.
 */
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  const Icon: import('react').ForwardRefExoticComponent<
    Omit<import('react').SVGProps<SVGSVGElement>, 'ref'> & {
      /** Pixels. Sets width and height; lucide's own default is 24. */
      size?: string | number;
      /** Rescales strokeWidth by size. AppIcon keeps this false — see appIconStroke.ts. */
      absoluteStrokeWidth?: boolean;
    } & import('react').RefAttributes<SVGSVGElement>
  >;
  export default Icon;
}
