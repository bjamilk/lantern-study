/**
 * Where the floating AI credit badge sits, and how a drag resolves.
 *
 * The badge used to be pinned at `top: 50%, right: 16` — anchored to nothing,
 * so whether it covered a control depended entirely on what happened to sit at
 * that screen's vertical midpoint at that scroll position. That is why it felt
 * unpredictable. The defence was a hand-maintained list of routes to hide it
 * on, which can only ever be incomplete.
 *
 * Now the reader drags it and we remember where they put it.
 *
 * The position is stored as a SIDE plus a RATIO down the usable height, never
 * as raw pixels: a phone rotating, a keyboard opening, or the same account on a
 * different-sized device must not strand the badge off-screen or under the
 * status bar. Everything here is pure so it can be unit-tested — the component
 * that uses it cannot be, since jest has no react-native renderer here.
 */

/** Which edge the badge is parked against. */
export type BadgeSide = 'left' | 'right';

export interface BadgeAnchor {
  side: BadgeSide;
  /** 0 = as high as it may sit, 1 = as low. Always clamped before use. */
  topRatio: number;
}

/** Gap from the screen edge, matching the old `right: 16`. */
export const BADGE_EDGE_MARGIN = 16;
/**
 * Fallback size, used only for the very first frame before the badge has
 * measured itself. It is a pill (an icon plus "20/20"), not a square, so the
 * two axes differ and the real measurement replaces both.
 */
export const BADGE_SIZE = 28;
export const BADGE_WIDTH = 72;

/** Where a first-time reader finds it: right side, vertically centred, as before. */
export const DEFAULT_BADGE_ANCHOR: BadgeAnchor = { side: 'right', topRatio: 0.5 };

export interface BadgeBounds {
  width: number;
  height: number;
  topInset: number;
  /** Everything the badge must clear at the bottom: inset + tab bar. */
  bottomClearance: number;
  /** Measured badge height; falls back to BADGE_SIZE before first layout. */
  badgeSize?: number;
  /** Measured badge width; falls back to BADGE_WIDTH before first layout. */
  badgeWidth?: number;
  margin?: number;
}

/**
 * The vertical band the badge may occupy, in pixels from the top of the window.
 * Never lets the travel go negative: on a very short window (a split-screen or
 * a landscape phone) the clamp would otherwise invert and park the badge above
 * the status bar.
 */
export function badgeTravel(bounds: BadgeBounds): { min: number; max: number } {
  const size = bounds.badgeSize ?? BADGE_SIZE;
  const margin = bounds.margin ?? BADGE_EDGE_MARGIN;
  const min = bounds.topInset + margin;
  const max = bounds.height - bounds.bottomClearance - margin - size;
  return max <= min ? { min, max: min } : { min, max };
}

/** Clamp a ratio into 0..1, treating anything unusable as the default. */
export function clampTopRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_BADGE_ANCHOR.topRatio;
  return Math.min(1, Math.max(0, ratio));
}

/** Absolute top offset (px) for an anchor within the given bounds. */
export function anchorTop(anchor: BadgeAnchor, bounds: BadgeBounds): number {
  const { min, max } = badgeTravel(bounds);
  return Math.round(min + clampTopRatio(anchor.topRatio) * (max - min));
}

/** Absolute left offset (px) for an anchor within the given bounds. */
export function anchorLeft(anchor: BadgeAnchor, bounds: BadgeBounds): number {
  const width = bounds.badgeWidth ?? BADGE_WIDTH;
  const margin = bounds.margin ?? BADGE_EDGE_MARGIN;
  return anchor.side === 'left' ? margin : Math.round(bounds.width - margin - width);
}

/**
 * Turn the position a drag ended at into an anchor to store.
 *
 * Horizontally it snaps to whichever edge the badge's own CENTRE is nearer, so
 * a badge dragged just past the midpoint commits to the far side rather than
 * springing back. Vertically it keeps exactly where it was dropped, clamped
 * into the usable band.
 */
export function anchorFromDrop(
  drop: { left: number; top: number },
  bounds: BadgeBounds,
): BadgeAnchor {
  const width = bounds.badgeWidth ?? BADGE_WIDTH;
  const centreX = drop.left + width / 2;
  const side: BadgeSide = centreX < bounds.width / 2 ? 'left' : 'right';

  const { min, max } = badgeTravel(bounds);
  const span = max - min;
  const topRatio = span <= 0 ? 0 : clampTopRatio((drop.top - min) / span);

  return { side, topRatio };
}

/** Validate a value read back from storage; anything odd falls back to default. */
export function parseBadgeAnchor(raw: unknown): BadgeAnchor {
  if (!raw || typeof raw !== 'object') return DEFAULT_BADGE_ANCHOR;
  const candidate = raw as { side?: unknown; topRatio?: unknown };
  const side: BadgeSide = candidate.side === 'left' ? 'left' : 'right';
  const topRatio =
    typeof candidate.topRatio === 'number' && Number.isFinite(candidate.topRatio)
      ? clampTopRatio(candidate.topRatio)
      : DEFAULT_BADGE_ANCHOR.topRatio;
  return { side, topRatio };
}
