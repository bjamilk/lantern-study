import {
  aiRateLimitForFeature,
  getAIUsage,
  getFeatureAIUsage,
  resetAIUsageForUser,
} from './aiRateLimit';

describe('aiRateLimitForFeature dual charge', () => {
  const userId = 'test-user-dual-ai-charge';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  function mockRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
  }

  it('increments both feature and global counters and exposes global headers', async () => {
    const req = { user: { id: userId } } as any;
    const res = mockRes();

    await new Promise<void>((resolve, reject) => {
      aiRateLimitForFeature('companion')(req, res as any, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const feature = await getFeatureAIUsage(userId, 'companion');
    const global = await getAIUsage(userId);
    expect(feature.used).toBe(1);
    expect(global.used).toBe(1);
    expect(res.headers['x-ai-feature']).toBe('companion');
    expect(res.headers['x-ai-usage-used']).toBe('1');
    expect(res.headers['x-ai-global-usage-used']).toBe('1');
    expect(res.headers['x-ai-global-usage-limit']).toBe(String(global.limit));
  });

  it('does not burn a global credit when the feature budget is already spent', async () => {
    const req = { user: { id: userId } } as any;

    // Exhaust generate_questions (default 15) while staying under the global 20.
    for (let i = 0; i < 15; i++) {
      const res = mockRes();
      await new Promise<void>((resolve, reject) => {
        aiRateLimitForFeature('generate_questions')(req, res as any, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      });
      expect(res.statusCode).toBe(200);
    }

    const globalAfterFeatureBudget = await getAIUsage(userId);
    expect(globalAfterFeatureBudget.used).toBe(15);

    const blocked = mockRes();
    await new Promise<void>((resolve) => {
      aiRateLimitForFeature('generate_questions')(req, blocked as any, () => resolve());
      // 429 path does not call next — resolve on next tick.
      setImmediate(resolve);
    });

    expect(blocked.statusCode).toBe(429);
    const globalAfterBlock = await getAIUsage(userId);
    expect(globalAfterBlock.used).toBe(15);
  });
});
