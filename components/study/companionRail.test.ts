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
  COMPANION_RAIL_REFERENCE_WIDTH,
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
    expect(COMPANION_RAIL_DOCK_MIN_ROW).toBe(924);
    expect(decide(COMPANION_RAIL_DOCK_MIN_ROW - 1, 'open')).toBe('collapsed');
    expect(decide(COMPANION_RAIL_DOCK_MIN_ROW, 'open')).toBe('docked');
  });

  it('draws no rail at all on a row that cannot spare 48px', () => {
    expect(COMPANION_RAIL_MIN_ROW).toBe(588);
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
    // The founder's own window, and the case the old media query got backwards:
    // "under lg, no rail", on a 942px room. It docks now, leaving a 558px
    // studio — which is why STUDIO_MIN is 540 and not the 560 it started at.
    const row = 1006 - 64;
    expect(companionRailFit(row).fits).toBe(true);
    expect(companionRailFit(row).canDock).toBe(true);
    expect(row - companionRailFit(row).dockWidth).toBe(558);
    // A studio still starts collapsed there — the screen goes to studying —
    // but the button now docks rather than throwing a sheet over the studio.
    expect(decide(row, 'collapsed')).toBe('collapsed');
    expect(decide(row, 'collapsed', 'expand')).toBe('docked');
  });
});

describe('companionRailFit', () => {
  it('always leaves the studio its minimum at every docked width', () => {
    for (const row of [924, 987, 988, 1051, 1052, 1600, 2400]) {
      const fit = companionRailFit(row);
      expect(fit.canDock).toBe(true);
      expect(row - fit.dockWidth).toBeGreaterThanOrEqual(COMPANION_RAIL_STUDIO_MIN);
    }
  });

  it('docks at the reference 400 on an ordinary room, and grows only when earned', () => {
    // WAVE 4 changed these numbers deliberately. The ladder used to spend every
    // spare pixel on the chat, so Lantern's own 1440 window — a 1216px row once
    // the 224px sidebar is out — docked 512px beside the studio, 28% wider than
    // the product being matched at the window it was measured at. Each step now
    // names the studio it insists on leaving behind, and 400 is the default.
    expect(companionRailFit(1440 - 224).dockWidth).toBe(COMPANION_RAIL_REFERENCE_WIDTH);
    // On the floor itself, still the narrowest panel.
    expect(companionRailFit(924).dockWidth).toBe(384);
    expect(companionRailFit(960).dockWidth).toBe(400);
    // 448 wants the reference's own 976px main column behind it…
    expect(companionRailFit(1423).dockWidth).toBe(400);
    expect(companionRailFit(1424).dockWidth).toBe(448);
    // …and 512 a studio past anything the reference lays out.
    expect(companionRailFit(1600).dockWidth).toBe(512);
  });

  it('compares two fits by the answer, not by the pixel', () => {
    expect(sameCompanionRailFit(companionRailFit(1200), companionRailFit(1250))).toBe(true);
    // 980 and 1100 are the SAME answer since wave 4 — both dock at 400 — so
    // the crossing this asserts is the one that survived: 400 → 448.
    expect(sameCompanionRailFit(companionRailFit(980), companionRailFit(1100))).toBe(true);
    expect(sameCompanionRailFit(companionRailFit(1100), companionRailFit(1424))).toBe(false);
    expect(sameCompanionRailFit(companionRailFit(900), companionRailFit(1100))).toBe(false);
  });
});

describe('defaults', () => {
  it('keeps the companion on the set home and out of the way in a studio', () => {
    expect(COMPANION_RAIL_DEFAULTS).toEqual({ home: 'open', focus: 'collapsed' });
  });
});
