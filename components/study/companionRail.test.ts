/**
 * The companion rail's decision, at the widths that matter.
 *
 * The numbers here are not invented: they are the rooms the founder's Chrome
 * actually produces at 125% zoom, where a 1258 device-px window is a 1006 CSS-px
 * viewport. The shell takes 608px of that on the set home (224px sidebar +
 * 384px chats flyout, which defaults to open) and 64px in focus, where the nav
 * is stood down — so "the viewport is 1280" tells you nothing about whether the
 * companion fits, which is the whole point of issue #105.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANION_RAIL_DEFAULTS,
  COMPANION_RAIL_DOCK_MIN_ROW,
  COMPANION_RAIL_MIN_ROW,
  COMPANION_RAIL_STUDIO_MIN,
  companionRailFit,
  decideCompanionRail,
  sameCompanionRailFit,
} from './companionRail';

const decide = (rowWidth: number, preference: 'open' | 'collapsed', request?: 'expand' | null) =>
  decideCompanionRail({ rowWidth, preference, request });

describe('decideCompanionRail', () => {
  it('docks on a roomy row when the student wants it open', () => {
    expect(decide(1200, 'open')).toBe('docked');
  });

  it('honours a collapsed preference however much room there is', () => {
    expect(decide(2000, 'collapsed')).toBe('collapsed');
  });

  it('refuses to dock one pixel below the threshold, and docks at it', () => {
    expect(COMPANION_RAIL_DOCK_MIN_ROW).toBe(944);
    expect(decide(COMPANION_RAIL_DOCK_MIN_ROW - 1, 'open')).toBe('collapsed');
    expect(decide(COMPANION_RAIL_DOCK_MIN_ROW, 'open')).toBe('docked');
  });

  it('draws no rail at all on a row that cannot spare 48px', () => {
    expect(COMPANION_RAIL_MIN_ROW).toBe(608);
    expect(decide(COMPANION_RAIL_MIN_ROW - 1, 'open')).toBe('none');
    expect(decide(COMPANION_RAIL_MIN_ROW - 1, 'collapsed')).toBe('none');
    // Not even an explicit expand conjures a rail there: the overlay is the
    // companion on a room this narrow, and the header keeps its Chat button.
    expect(decide(400, 'collapsed', 'expand')).toBe('none');
  });

  it('lets a session-only request override a collapsed preference', () => {
    expect(decide(1200, 'collapsed', 'expand')).toBe('docked');
    // …but only as far as the row allows. Below the dock threshold the rail
    // stays collapsed and the button opens the overlay instead.
    expect(decide(800, 'collapsed', 'expand')).toBe('collapsed');
  });

  it('leaves a stored `open` collapsed rather than throwing a sheet over the studio', () => {
    expect(decide(800, 'open')).toBe('collapsed');
  });

  it('is the 1030px viewport from the issue: docking there left the studio ~100px', () => {
    // 1030 viewport − 608 of shell chrome = a 422px row. The old media query
    // docked a 384px rail into it.
    expect(decide(1030 - 608, 'open')).toBe('none');
  });

  it('is the 1006px focus room from the issue: the nav is down, the room is wide', () => {
    // The media query said "under lg, no rail". The row is 942px.
    const row = 1006 - 64;
    expect(companionRailFit(row).fits).toBe(true);
    // Two pixels under the dock threshold, so it collapses — and the founder's
    // window is the one that proves the threshold is doing real work.
    expect(decide(row, 'open')).toBe('collapsed');
  });
});

describe('companionRailFit', () => {
  it('always leaves the studio its minimum at every docked width', () => {
    for (const row of [944, 1007, 1008, 1071, 1072, 1600, 2400]) {
      const fit = companionRailFit(row);
      expect(fit.canDock).toBe(true);
      expect(row - fit.dockWidth).toBeGreaterThanOrEqual(COMPANION_RAIL_STUDIO_MIN);
    }
  });

  it('grows the rail in three steps as the row gets roomier', () => {
    expect(companionRailFit(1000).dockWidth).toBe(384);
    expect(companionRailFit(1008).dockWidth).toBe(448);
    expect(companionRailFit(1072).dockWidth).toBe(512);
  });

  it('compares two fits by the answer, not by the pixel', () => {
    expect(sameCompanionRailFit(companionRailFit(1200), companionRailFit(1250))).toBe(true);
    expect(sameCompanionRailFit(companionRailFit(1000), companionRailFit(1100))).toBe(false);
  });
});

describe('defaults', () => {
  it('keeps the companion on the set home and out of the way in a studio', () => {
    expect(COMPANION_RAIL_DEFAULTS).toEqual({ home: 'open', focus: 'collapsed' });
  });
});
