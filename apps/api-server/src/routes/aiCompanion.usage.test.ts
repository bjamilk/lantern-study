import {
  aiRateLimitForFeature,
  getAIUsage,
  getFeatureAIUsage,
  resetAIUsageForUser,
} from '../middleware/aiRateLimit';

describe('companion AI usage', () => {
  const userId = 'test-user-companion-usage';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  it('companion feature quota is unchanged when history would be read (no middleware)', async () => {
    const before = await getFeatureAIUsage(userId, 'companion');
    const after = await getFeatureAIUsage(userId, 'companion');
    expect(after.used).toBe(before.used);
    expect(after.used).toBe(0);
  });

  it('companion rate limit increments feature and global counters', async () => {
    const beforeFeature = await getFeatureAIUsage(userId, 'companion');
    const beforeGlobal = await getAIUsage(userId);

    const req = { user: { id: userId } } as any;
    const res = {
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      },
      // Real responses are EventEmitters; the middleware hooks 'finish' to
      // refund credits when a request does not succeed.
      on() {
        return this;
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

    const afterFeature = await getFeatureAIUsage(userId, 'companion');
    const afterGlobal = await getAIUsage(userId);
    expect(afterFeature.used).toBe(beforeFeature.used + 1);
    expect(afterGlobal.used).toBe(beforeGlobal.used + 1);
    expect(res.headers['x-ai-feature']).toBe('companion');
    expect(res.headers['x-ai-global-usage-used']).toBe(String(afterGlobal.used));
  });
});
