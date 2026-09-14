import { describe, expect, it } from 'vitest';
import { OWN_WAY_FEATURED_IDS, OWN_WAY_TOOL_ORDER } from './OwnWayGrid';

describe('OwnWayGrid doors', () => {
  it('keeps the seven everyday doors on the wall', () => {
    expect([...OWN_WAY_FEATURED_IDS]).toEqual([
      'import',
      'quiz',
      'cards',
      'ask',
      'lesson',
      'recap',
      'lecture',
    ]);
  });

  it('puts the rest behind Show all', () => {
    const more = OWN_WAY_TOOL_ORDER.filter((id) => !OWN_WAY_FEATURED_IDS.includes(id));
    expect(more).toEqual(['play', 'essay', 'notes', 'walkthrough', 'test', 'plan']);
  });
});
