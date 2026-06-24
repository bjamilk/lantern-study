import { validationResult } from 'express-validator';
import { validateUserStatsUpsert } from '../middleware/validation';

async function runValidators(body: Record<string, unknown>) {
  const req = { body } as any;
  for (const validator of validateUserStatsUpsert) {
    await validator.run(req);
  }
  return validationResult(req);
}

describe('validateUserStatsUpsert', () => {
  const validBody = {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    questionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    correctAttempts: 1,
    incorrectAttempts: 0,
  };

  it('accepts valid upsert payload', async () => {
    const result = await runValidators(validBody);
    expect(result.isEmpty()).toBe(true);
  });

  it('rejects invalid userId', async () => {
    const result = await runValidators({ ...validBody, userId: 'not-a-uuid' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => 'path' in e && e.path === 'userId')).toBe(true);
  });

  it('rejects negative attempt counts', async () => {
    const result = await runValidators({ ...validBody, correctAttempts: -1 });
    expect(result.isEmpty()).toBe(false);
  });
});
