import { splitHeadcountLabel, splitPerPersonShare } from './expenseSplitPlanner';

describe('splitHeadcountLabel', () => {
  it('says "Just you" before anyone is added', () => {
    expect(splitHeadcountLabel(0)).toBe('Just you');
    expect(splitHeadcountLabel(-1)).toBe('Just you');
  });

  it('counts one other in the singular', () => {
    expect(splitHeadcountLabel(1)).toBe('Split between you and 1 other');
  });

  it('counts several others in the plural', () => {
    expect(splitHeadcountLabel(3)).toBe('Split between you and 3 others');
  });
});

describe('splitPerPersonShare', () => {
  it('is zero when there is no total', () => {
    expect(splitPerPersonShare(0, 2)).toBe(0);
  });

  it('divides across the creator plus others', () => {
    expect(splitPerPersonShare(900, 2)).toBe(300); // 3 heads
    expect(splitPerPersonShare(100, 0)).toBe(100); // just the creator
  });
});
