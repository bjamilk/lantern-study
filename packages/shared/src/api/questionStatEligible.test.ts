import { isQuestionStatEligible } from './endpoints';

describe('isQuestionStatEligible', () => {
  it('accepts a server question row id', () => {
    expect(isQuestionStatEligible('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('skips ids embedded in a personal test, which the server validator would 400', () => {
    expect(isQuestionStatEligible('q1')).toBe(false);
    expect(isQuestionStatEligible('')).toBe(false);
    expect(isQuestionStatEligible(undefined as unknown as string)).toBe(false);
  });
});
