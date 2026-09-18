import { describe, expect, it } from 'vitest';
import { STUDY_SET_HOME_TOOLS } from '@lantern/shared';
import { buildSetRailModel } from '@lantern/shared/study';
import {
  OWN_WAY_FEATURED_IDS,
  OWN_WAY_OFF_WALL_IDS,
  OWN_WAY_TOOL_ORDER,
} from './OwnWayGrid';

describe('OwnWayGrid doors', () => {
  it('puts eight everyday doors on the wall, in the reference’s order', () => {
    // Measured 2026-09-17 (docs/studyfetch-mysets-2026-09-17/01-set-home.md):
    // Add More Materials, Take a Quiz, Create a Flashcard Set, Ask Sparky,
    // Start a Tutoring Session, Start Listening, Start Recording, Launch
    // Arcade. The reference's ninth cell is `Explore Mini Apps`, a community
    // app marketplace Lantern does not have; the founder's call is that the
    // cell stays EMPTY rather than being squared off with an unrelated door.
    expect([...OWN_WAY_FEATURED_IDS]).toEqual([
      'import',
      'quiz',
      'cards',
      'ask',
      'lesson',
      'recap',
      'lecture',
      'play',
    ]);
  });

  it('holds the wall at eight however the list is edited', () => {
    expect(OWN_WAY_FEATURED_IDS).toHaveLength(8);
    expect(new Set(OWN_WAY_FEATURED_IDS).size).toBe(8);
    // No `essay`: a grader is not a way to start studying a set.
    expect(OWN_WAY_FEATURED_IDS).not.toContain('essay');
  });

  it('loses no door from the ledger: the wall plus the rest is the registry', () => {
    expect([...OWN_WAY_TOOL_ORDER].sort()).toEqual(
      STUDY_SET_HOME_TOOLS.map((tool) => tool.id).sort()
    );
    expect([...OWN_WAY_OFF_WALL_IDS].sort()).toEqual(
      ['essay', 'notes', 'plan', 'test', 'walkthrough'].sort()
    );
  });

  /**
   * THE ASSERTION THAT REPLACES `More`.
   *
   * Dropping the overflow menu is only safe if every door it held is still
   * reachable, and the claim in OwnWayGrid.tsx is that they all live in the
   * set rail. That claim is checked here against the real rail model rather
   * than trusted: if someone reorders the rail's practice drawer and a door
   * falls out, this fails instead of the door quietly becoming unreachable.
   */
  it('leaves every door the wall no longer draws reachable from the set rail', () => {
    const rail = buildSetRailModel({ setId: 's1', setTitle: 'Set' });
    const railIds = new Set<string>([
      ...rail.primary.map((link) => link.id),
      ...rail.practice.items.map((link) => link.id),
      rail.upload.id,
      // The materials tree IS the `notes` door: it lists the set's notes and
      // its `View all` lands on the same route the `notes` tool opens.
      'notes',
    ]);
    for (const id of OWN_WAY_OFF_WALL_IDS) {
      expect(railIds.has(id), `"${id}" is on neither the wall nor the rail`).toBe(true);
    }
  });
});
