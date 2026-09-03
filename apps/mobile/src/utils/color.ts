/**
 * Colour compositing — pure helpers.
 *
 * This module imports NOTHING outside TypeScript itself, for the same reason as
 * `utils/chatWallpaper.ts`: `npx jest` runs it in a node environment with no
 * React Native runtime.
 *
 * WHY THIS EXISTS: several dark-palette tokens carry their own alpha
 * (`primaryBackground: '#6366f120'`, the `*Background` family — see
 * packages/shared/src/design/colorChannels.ts, which lists them as deliberately
 * alpha-baked). That is fine while the ground underneath is the theme's own
 * background, and NOT fine once a chat wallpaper is behind it: the photo shows
 * straight through the surface and the text on it loses its contrast. Flatten
 * such a token against the ground it is *meant* to sit on and the surface
 * becomes opaque while looking exactly as it does today.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseColor(value: string): Rgba | null {
  const input = (value || '').trim();
  if (!input) return null;

  if (input.startsWith('#')) {
    const raw = input.slice(1);
    const expand = (c: string) => parseInt(c + c, 16);
    if (raw.length === 3 || raw.length === 4) {
      const r = expand(raw[0]);
      const g = expand(raw[1]);
      const b = expand(raw[2]);
      const a = raw.length === 4 ? expand(raw[3]) / 255 : 1;
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    if (raw.length === 6 || raw.length === 8) {
      const r = parseInt(raw.slice(0, 2), 16);
      const g = parseInt(raw.slice(2, 4), 16);
      const b = parseInt(raw.slice(4, 6), 16);
      const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const match = /^rgba?\(([^)]+)\)$/i.exec(input);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => p.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => Number.parseFloat(p));
  const a = parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return { r, g, b, a };
}

function toHex(r: number, g: number, b: number): string {
  const hex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Composite `color` over the opaque `base` and return an opaque `#rrggbb`.
 *
 * An already-opaque `color` is returned unchanged, so this is safe to apply
 * unconditionally: in light mode `primaryBackground` is the opaque `#eef2ff`
 * and nothing moves. Anything unparseable is returned unchanged too — a
 * surface that renders as it did before beats a surface that renders as
 * `undefined`.
 */
export function flattenColor(color: string, base: string): string {
  const fg = parseColor(color);
  if (!fg) return color;
  if (fg.a >= 1) return color;
  const bg = parseColor(base);
  if (!bg) return color;
  const a = Math.max(0, Math.min(1, fg.a));
  return toHex(
    fg.r * a + bg.r * (1 - a),
    fg.g * a + bg.g * (1 - a),
    fg.b * a + bg.b * (1 - a),
  );
}
