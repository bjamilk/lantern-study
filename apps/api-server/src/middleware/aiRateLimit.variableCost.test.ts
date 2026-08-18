import {
  aiRateLimit,
  aiRateLimitForFeature,
  aiRateLimitWithCost,
  chargeAiCredits,
  refundAiCredits,
  getAIUsage,
  resetAIUsageForUser,
  AI_USAGE_EXPOSED_HEADERS,
} from './aiRateLimit';
import { getSmartNotesCreditCost } from '@lantern/shared/utils/aiCredits';

describe('aiRateLimitWithCost', () => {
  const userId = 'test-user-variable-cost';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  function mockRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      locals: {} as Record<string, unknown>,
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

  function run(res: ReturnType<typeof mockRes>, depth?: unknown) {
    const req = { user: { id: userId }, body: { depth } } as any;
    const middleware = aiRateLimitWithCost(
      (r) => getSmartNotesCreditCost((r as any).body?.depth),
      { label: 'Deep dive Smart Notes' }
    );
    // Resolve on next() (allowed) OR on json() (429 denial), whichever fires.
    return new Promise<void>((resolve) => {
      const originalJson = res.json.bind(res);
      res.json = (payload: unknown) => {
        const out = originalJson(payload);
        resolve();
        return out;
      };
      void middleware(req, res as any, () => resolve());
    });
  }

  it('charges 3 credits for deep and sets X-AI-Cost', async () => {
    const res = mockRes();
    await run(res, 'deep');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ai-cost']).toBe('3');
    expect(res.headers['x-ai-global-usage-used']).toBe('3');
    expect(res.locals.aiCreditsCharged).toBe(3);
    expect((await getAIUsage(userId)).used).toBe(3);
  });

  it('charges 1 credit for concise and standard', async () => {
    await run(mockRes(), 'concise');
    expect((await getAIUsage(userId)).used).toBe(1);
    await run(mockRes(), 'standard');
    expect((await getAIUsage(userId)).used).toBe(2);
  });

  it('falls back to 1 credit for missing or garbage depth', async () => {
    await run(mockRes(), undefined);
    await run(mockRes(), 'bananas');
    expect((await getAIUsage(userId)).used).toBe(2);
  });

  it('refuses deep at 18/20 without consuming anything', async () => {
    const denied = await chargeAiCredits(userId, 18);
    expect(denied).toBeNull();

    const res = mockRes();
    await run(res, 'deep');
    expect(res.statusCode).toBe(429);
    const body = res.body as { cost: number; remaining: number; used: number; error: string };
    expect(body.cost).toBe(3);
    expect(body.remaining).toBe(2);
    expect(body.used).toBe(18);
    expect(body.error).toContain('needs 3 AI credits');
    // 429 still carries global headers so the client badge self-corrects.
    expect(res.headers['x-ai-global-usage-used']).toBe('18');
    expect((await getAIUsage(userId)).used).toBe(18);
  });

  it('allows deep at exactly 17/20, landing on the limit', async () => {
    await chargeAiCredits(userId, 17);
    const res = mockRes();
    await run(res, 'deep');
    expect(res.statusCode).toBe(200);
    expect((await getAIUsage(userId)).used).toBe(20);
  });
});

describe('chargeAiCredits atomicity and refunds', () => {
  const userId = 'test-user-atomic-charge';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  it('denies a multi-credit charge without partial consumption', async () => {
    await chargeAiCredits(userId, 17);
    const denied = await chargeAiCredits(userId, 5, 'OCR');
    expect(denied).not.toBeNull();
    expect(denied!.used).toBe(17);
    // The old loop implementation left 3 credits burned here.
    expect((await getAIUsage(userId)).used).toBe(17);
  });

  it('refunds restore the count and never go below zero', async () => {
    await chargeAiCredits(userId, 3);
    await refundAiCredits(userId, 3);
    expect((await getAIUsage(userId)).used).toBe(0);
    await refundAiCredits(userId, 3); // double refund
    expect((await getAIUsage(userId)).used).toBe(0);
  });
});

describe('AI usage header invariant', () => {
  const userId = 'test-user-header-invariant';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  function collectHeaders() {
    const headers: Record<string, string> = {};
    return {
      headers,
      locals: {} as Record<string, unknown>,
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
  }

  it('every header set by any AI middleware is in AI_USAGE_EXPOSED_HEADERS', async () => {
    const exposed = new Set(AI_USAGE_EXPOSED_HEADERS.map((h) => h.toLowerCase()));
    const middlewares = [
      (req: any, res: any, next: any) => aiRateLimit(req, res, next),
      aiRateLimitForFeature('generate_flashcards'),
      aiRateLimitWithCost(() => 3),
    ];
    for (const middleware of middlewares) {
      const res = collectHeaders();
      const req = { user: { id: userId }, body: {} } as any;
      await new Promise<void>((resolve) => {
        void middleware(req, res as any, () => resolve());
        // 429 paths never call next(); resolve on the next tick instead.
        setTimeout(resolve, 50);
      });
      for (const name of Object.keys(res.headers)) {
        expect(exposed.has(name.toLowerCase())).toBe(true);
      }
    }
  });
});
