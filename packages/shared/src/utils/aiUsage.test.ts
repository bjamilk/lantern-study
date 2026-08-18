import { DEFAULT_AI_DAILY_LIMIT } from './aiUsage';

describe('aiUsage', () => {
  it('defaults free daily credits to 20', () => {
    expect(DEFAULT_AI_DAILY_LIMIT).toBe(20);
  });
});
