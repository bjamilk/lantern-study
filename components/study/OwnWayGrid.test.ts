import { describe, expect, it } from 'vitest';
import { STUDY_SET_HOME_TOOLS } from '@lantern/shared';
import { OWN_WAY_FEATURED_IDS, OWN_WAY_TOOL_ORDER } from './OwnWayGrid';

describe('OwnWayGrid doors', () => {
  it('keeps six everyday doors on the wall, in the order a student reaches for them', () => {
    expect([...OWN_WAY_FEATURED_IDS]).toEqual([
      'quiz',
      'cards',
      'ask',
      'lesson',
      'lecture',
      'import',
    ]);
  });

  it('caps the wall at six however the list is edited', () => {
    expect(OWN_WAY_FEATURED_IDS).toHaveLength(6);
    expect(new Set(OWN_WAY_FEATURED_IDS).size).toBe(6);
  });

  it('puts the rest behind More', () => {
    const more = OWN_WAY_TOOL_ORDER.filter((id) => !OWN_WAY_FEATURED_IDS.includes(id));
    expect(more).toEqual(['recap', 'play', 'essay', 'notes', 'walkthrough', 'test', 'plan']);
  });

  it('loses no door: the wall plus More is the whole registry', () => {
    expect([...OWN_WAY_TOOL_ORDER].sort()).toEqual(
      STUDY_SET_HOME_TOOLS.map((tool) => tool.id).sort()
    );
    for (const id of OWN_WAY_FEATURED_IDS) expect(OWN_WAY_TOOL_ORDER).toContain(id);
  });
});
