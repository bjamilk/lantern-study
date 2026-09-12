/**
 * X-axis labels for the dashboard group-performance chart.
 *
 * The shared series (`buildRolledUpGroupSeries`) emits honest point keys —
 * `Test 3 - 06/21` for a timeline point and `2026-W36` for a weekly bucket —
 * but the chart used to render them as `String(p.x).slice(-5)` and let
 * gifted-charts clip whatever did not fit its default label box. That produced
 * `0…` on the daily chart and `6-W36` on the weekly one: two labels that say
 * nothing and one that is actively wrong (there is no week "6").
 *
 * So the shortening happens here, deliberately, and the caller sizes the label
 * box to the string this produces.
 */

export type AxisGranularity = 'daily' | 'weekly';

/** Widest string this module emits (`06/21`, `W36`, `T12`), plus breathing room. */
export const AXIS_LABEL_WIDTH = 44;

const WEEK_KEY = /W(\d{1,2})$/i;
const SLASH_DATE = /(\d{1,2})\/(\d{1,2})(?!.*\d\/\d)/;
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;
const TEST_INDEX = /^\s*Test\s+(\d+)/i;

const pad = (n: string): string => n.padStart(2, '0');

/**
 * Shorten one point key to something that fits under a point and still means
 * what the full key meant.
 *
 * - weekly `2026-W36` -> `W36`
 * - daily `Test 3 - 06/21` or `2026-06-21` -> `06/21`
 * - a test point with no date -> `T3`
 *
 * Anything unrecognised is returned trimmed rather than silently truncated —
 * an over-long label is a visible bug; a clipped one looks like data.
 */
export function axisLabel(x: string | number, granularity: AxisGranularity): string {
  const raw = typeof x === 'number' ? String(x) : (x ?? '').trim();
  if (!raw) return '';

  if (granularity === 'weekly') {
    const week = WEEK_KEY.exec(raw);
    if (week) return `W${pad(week[1])}`;
  }

  const iso = ISO_DATE.exec(raw);
  if (iso) return `${iso[2]}/${iso[3]}`;

  const slash = SLASH_DATE.exec(raw);
  if (slash) return `${pad(slash[1])}/${pad(slash[2])}`;

  const test = TEST_INDEX.exec(raw);
  if (test) return `T${test[1]}`;

  const week = WEEK_KEY.exec(raw);
  if (week) return `W${pad(week[1])}`;

  return raw;
}

/**
 * How many points to skip between labels so two labels never overlap.
 *
 * Labels are centred on their point, so a label only fits when the horizontal
 * distance between two labelled points is at least the label box. The chart
 * width is the plot width, not the card width — the caller has already
 * subtracted the y-axis.
 */
export function axisLabelStride(
  count: number,
  plotWidth: number,
  labelWidth: number = AXIS_LABEL_WIDTH
): number {
  if (count <= 1) return 1;
  const width = Math.max(1, labelWidth);
  const usable = Math.max(1, plotWidth);
  // How many label boxes fit across the plot, and therefore how many of the
  // `count` points may carry one.
  const maxLabels = Math.max(1, Math.floor(usable / width));
  return Math.max(1, Math.ceil(count / maxLabels));
}

/**
 * Whether point `index` carries a label, given a stride.
 *
 * Anchored on the LAST point rather than the first: the end of the range is the
 * label a student actually looks for, and anchoring there means the final label
 * is never a half-stride away from its neighbour (which is exactly how labels
 * end up overlapping even when the stride is correct).
 */
export function shouldShowAxisLabel(index: number, count: number, stride: number): boolean {
  if (count <= 0 || index < 0 || index >= count) return false;
  const step = Math.max(1, Math.floor(stride));
  return (count - 1 - index) % step === 0;
}

/**
 * The style box one x-axis label needs.
 *
 * gifted-charts sizes each label's container to `spacing` — 14-21dp once a term
 * of tests is packed into a phone card — and renders the label in a
 * single-line, ellipsizing `Text`. That, not the string, is what turned `06/21`
 * into `0…`. The label text therefore gets its own width and is pulled left by
 * half the overhang so it stays centred on its point; the overhang is safe
 * because `axisLabelStride` already keeps labelled points a full box apart, and
 * the end labels spill into the chart's initial/end spacing.
 */
export function axisLabelBox(
  spacing: number,
  labelWidth: number = AXIS_LABEL_WIDTH
): { width: number; marginLeft: number } {
  const box = Math.max(1, labelWidth, spacing);
  const overhang = box - Math.max(0, spacing);
  return { width: box, marginLeft: overhang > 0 ? -overhang / 2 : 0 };
}

/**
 * Convenience wrapper: the label for every point, blank where one is skipped.
 */
export function buildAxisLabels(
  xs: Array<string | number>,
  granularity: AxisGranularity,
  plotWidth: number,
  labelWidth: number = AXIS_LABEL_WIDTH
): string[] {
  const stride = axisLabelStride(xs.length, plotWidth, labelWidth);
  return xs.map((x, i) =>
    shouldShowAxisLabel(i, xs.length, stride) ? axisLabel(x, granularity) : ''
  );
}
