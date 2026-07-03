import {
  aiRateLimitForFeature,
  getFeatureAIUsage,
  resetAIUsageForUser,
} from '../middleware/aiRateLimit';

describe('companion AI usage', () => {
  const userId = 'test-user-companion-usage';

  beforeEach(async () => {
    await resetAIUsageForUser(userId, 'companion');
  });

  it('companion feature quota is unchanged when history would be read (no middleware)', async () => {
    const before = await getFeatureAIUsage(userId, 'companion');
    const after = await getFeatureAIUsage(userId, 'companion');
    expect(after.used).toBe(before.used);
    expect(after.used).toBe(0);
  });

  it('companion rate limit increments only on charged companion routes', async () => {
    const before = await getFeatureAIUsage(userId, 'companion');

    const req = { user: { id: userId } } as any;
    const res = {
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      },
      status() {
        return this;
      },
      json() {},
    } as any;

    await new Promise<void>((resolve, reject) => {
      aiRateLimitForFeature('companion')(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const after = await getFeatureAIUsage(userId, 'companion');
    expect(after.used).toBe(before.used + 1);
    expect(res.headers['x-ai-feature']).toBe('companion');
  });
});
