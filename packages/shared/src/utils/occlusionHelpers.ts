import type { OcclusionData } from '../types';

export type OcclusionPoint = { x: number; y: number };

/** Collect freeform paths from legacy `freeform` or newer `freeforms` array. */
export function getFreeformPaths(data?: OcclusionData | null): { points: OcclusionPoint[] }[] {
  if (!data || data.type !== 'freeform') return [];
  if (data.freeforms?.length) return data.freeforms.filter((p) => p.points?.length);
  if (data.freeform?.points?.length) return [{ points: data.freeform.points }];
  return [];
}

/** Normalize blur entries to an array. */
export function getBlurRegions(data?: OcclusionData | null) {
  if (!data || data.type !== 'blur' || !data.blur) return [];
  return Array.isArray(data.blur) ? data.blur : [data.blur];
}

/** Format normalized 0–1 points for SVG polygon in viewBox 0 0 1 1. */
export function formatFreeformPointsForSvg(points: OcclusionPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Migrate legacy occlusion payloads to the current shape. */
export function normalizeOcclusionData(data?: OcclusionData | null): OcclusionData | undefined {
  if (!data) return undefined;

  if (data.type === 'blur' && data.blur) {
    const blurArr = Array.isArray(data.blur) ? data.blur : [data.blur];
    return {
      ...data,
      blur: blurArr.map((b) => ({ ...b, opacity: b.opacity ?? 0.4 })),
    };
  }

  if (data.type === 'freeform') {
    return {
      type: 'freeform',
      freeforms: getFreeformPaths(data),
    };
  }

  return data;
}
