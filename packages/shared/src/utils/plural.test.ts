import { pluralize, pluralUnit } from './plural';

describe('pluralize', () => {
  it('says "1 question", the thing three screens got wrong', () => {
    expect(pluralize(1, 'question')).toBe('1 question');
    expect(pluralize(1, 'member')).toBe('1 member');
  });

  it('pluralises everything that is not exactly one, zero included', () => {
    expect(pluralize(0, 'member')).toBe('0 members');
    expect(pluralize(2, 'member')).toBe('2 members');
  });

  it('groups big counts the way the rest of the app prints numbers', () => {
    expect(pluralize(1200, 'member')).toBe('1,200 members');
  });

  it('adds "es" where "s" alone would be unreadable', () => {
    expect(pluralize(2, 'class')).toBe('2 classes');
    expect(pluralize(1, 'class')).toBe('1 class');
  });

  it('turns a consonant + y into "ies"', () => {
    expect(pluralize(3, 'category')).toBe('3 categories');
    expect(pluralize(3, 'day')).toBe('3 days');
  });

  it('takes an irregular plural when the caller supplies one', () => {
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
    expect(pluralize(1, 'person', 'people')).toBe('1 person');
  });

  it('never prints NaN at a student', () => {
    expect(pluralize(Number.NaN, 'question')).toBe('0 questions');
    expect(pluralize(Number.POSITIVE_INFINITY, 'question')).toBe('0 questions');
  });

  it('exposes the bare noun for callers that lay out the number themselves', () => {
    expect(pluralUnit(1, 'card')).toBe('card');
    expect(pluralUnit(9, 'card')).toBe('cards');
  });
});
