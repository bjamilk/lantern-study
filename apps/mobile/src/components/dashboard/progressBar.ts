/**
 * Progress bars on Home, and the one rule they all broke.
 *
 * A bar's width was set straight from a raw ratio, so an account that did 12
 * cards against a goal of 1 rendered `width: "1200%"` — a fill that ran off
 * the card and, on the level bar, an XP figure that could exceed the step it
 * was measured against. A bar can only ever be full; the OVERSHOOT is
 * information, and it belongs in the text beside it ("12 of 1"), not in a
 * geometry the layout cannot draw.
 */

/** Width for a bar fill, as a whole percent in [0, 100]. Never NaN. */
export function clampProgressPercent(percent: number | null | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** `done`/`goal` as prose: "12 of 1", not a 1200% bar. */
export function goalCountLabel(done: number, goal: number): string {
  return `${done} of ${goal}`;
}

/** True when the student is past the goal — the bar cannot say so, so text does. */
export function isGoalOvershot(done: number, goal: number): boolean {
  return goal > 0 && done > goal;
}
