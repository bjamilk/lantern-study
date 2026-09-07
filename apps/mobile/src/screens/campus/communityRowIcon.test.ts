import { COMMUNITY_KINDS } from '@lantern/shared/network';
import { communityRowIcon } from './communityRowIcon';

describe('communityRowIcon', () => {
  it('gives every kind its own glyph, so one violet still tells five things apart', () => {
    const icons = COMMUNITY_KINDS.map(communityRowIcon);
    expect(new Set(icons).size).toBe(COMMUNITY_KINDS.length);
  });

  it('names the course room with the book', () => {
    expect(communityRowIcon('course')).toBe('book');
  });

  it('falls back to the generic room rather than to a blank square', () => {
    expect(communityRowIcon('something-new')).toBe('people');
  });
});
