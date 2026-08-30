import {
  applyReactionLocally,
  isSupportedReactionEmoji,
  normalizeReactions,
  sortedReactionEntries,
  totalReactionCount,
} from './reactions';

describe('normalizeReactions', () => {
  it('drops non-positive, non-numeric and malformed entries', () => {
    expect(normalizeReactions({ '👍': 3, '🔥': 0, '😂': -2, '🎉': 'x' })).toEqual({ '👍': 3 });
  });

  it('coerces numeric strings and floors fractions', () => {
    expect(normalizeReactions({ '👍': '2', '❤️': 1.9 })).toEqual({ '👍': 2, '❤️': 1 });
  });

  it('treats junk input as empty rather than throwing', () => {
    expect(normalizeReactions(null)).toEqual({});
    expect(normalizeReactions(['👍'])).toEqual({});
    expect(normalizeReactions('👍')).toEqual({});
  });
});

describe('applyReactionLocally', () => {
  it('adds and removes the viewer own reaction', () => {
    expect(applyReactionLocally({ '👍': 1 }, '👍', true)).toEqual({ '👍': 2 });
    expect(applyReactionLocally({ '👍': 2 }, '👍', false)).toEqual({ '👍': 1 });
  });

  it('removes the key entirely at zero, so no empty chips render', () => {
    expect(applyReactionLocally({ '👍': 1 }, '👍', false)).toEqual({});
  });

  it('never goes negative when the server already removed it', () => {
    expect(applyReactionLocally({}, '👍', false)).toEqual({});
  });
});

describe('sortedReactionEntries', () => {
  it('orders by count, then by the canonical emoji order', () => {
    expect(sortedReactionEntries({ '🔥': 1, '👍': 5, '❤️': 1 })).toEqual([
      ['👍', 5],
      ['❤️', 1],
      ['🔥', 1],
    ]);
  });
});

describe('misc', () => {
  it('totals across emoji', () => {
    expect(totalReactionCount({ '👍': 2, '🔥': 3 })).toBe(5);
  });

  it('gates unsupported emoji', () => {
    expect(isSupportedReactionEmoji('👍')).toBe(true);
    expect(isSupportedReactionEmoji('🦄')).toBe(false);
    expect(isSupportedReactionEmoji(null)).toBe(false);
  });
});
