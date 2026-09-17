import { describe, expect, it } from 'vitest';
import { OWN_WAY_FEATURED_IDS, OWN_WAY_TOOL_ORDER } from './OwnWayGrid';

describe('OwnWayGrid doors', () => {
  it('keeps six everyday doors on the wall', () => {
    expect([...OWN_WAY_FEATURED_IDS]).toEqual([
      'import',
      'quiz',
      'cards',
      'ask',
      'lesson',
      'recap',
    ]);
  });

  it('puts the rest behind More', () => {
    const more = OWN_WAY_TOOL_ORDER.filter((id) => !OWN_WAY_FEATURED_IDS.includes(id));
    expect(more).toEqual(['lecture', 'play', 'essay', 'notes', 'walkthrough', 'test', 'plan']);
  });
});
