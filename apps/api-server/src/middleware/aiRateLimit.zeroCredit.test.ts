/**
 * A free feature must be FREE.
 *
 * `voice_ask` has a daily cap (40) and no price. That combination is new: every
 * other capped feature also spends one global AI use, and the limiter's normal
 * path charges the global allowance BEFORE it touches the feature counter. If
 * voice_ask went down that path, a student would watch their AI uses drop
 * every time they spoke a question the Usage screen lists under "costs
 * nothing" — the counter lying about money, which is the one thing this
 * codebase treats as worse than no counter.
 *
 * So: the cap moves, the daily counter does not, and a request that fails
 * gives the cap back.
 */
import {
  aiRateLimitForFeature,
  getAIUsage,
  getFeatureAIUsage,
  refundFeatureAiCredit,
  resetAIUsageForUser,
} from './aiRateLimit';

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    locals: {} as Record<string, unknown>,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    listeners: {} as Record<string, Array<() => void>>,
    on(event: string, cb: () => void) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    },
    async finish() {
      for (const cb of this.listeners.finish || []) cb();
      await new Promise((resolve) => setTimeout(resolve, 20));
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

function run(featureKey: string, req: unknown, res: ReturnType<typeof mockRes>) {
  return new Promise<boolean>((resolve, reject) => {
    let called = false;
    aiRateLimitForFeature(featureKey)(req as any, res as any, (err?: unknown) => {
      called = true;
      if (err) reject(err);
      else resolve(true);
    });
    // A refusal answers instead of calling next(); give it a tick to land.
    setTimeout(() => {
      if (!called) resolve(false);
    }, 30);
  });
}

describe('a spoken question costs nothing but is still capped', () => {
  const userId = 'test-user-voice-ask';
  const req = { user: { id: userId } };

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  it('counts against its own cap and leaves the daily allowance alone', async () => {
    const res = mockRes();
    await expect(run('voice_ask', req, res)).resolves.toBe(true);

    expect((await getFeatureAIUsage(userId, 'voice_ask')).used).toBe(1);
    // The whole point of the lane: the global meter has not moved.
    expect((await getAIUsage(userId)).used).toBe(0);
  });

  it('says the cost is zero and does not restate the global badge', async () => {
    const res = mockRes();
    await run('voice_ask', req, res);

    expect(res.headers['x-ai-feature']).toBe('voice_ask');
    expect(res.headers['x-ai-cost']).toBe('0');
    expect(res.headers['x-ai-usage-limit']).toBe('40');
    // No global headers at all: a client that reads them would otherwise
    // repaint the badge for an action that spent nothing.
    expect(res.headers['x-ai-global-usage-used']).toBeUndefined();
    expect(res.headers['x-ai-bonus-remaining']).toBeUndefined();
  });

  it('refuses the 41st question of the day, still without charging', async () => {
    for (let i = 0; i < 40; i++) {
      await run('voice_ask', req, mockRes());
    }
    const res = mockRes();
    await expect(run('voice_ask', req, res)).resolves.toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as { cost?: number }).cost).toBe(0);
    expect((await getAIUsage(userId)).used).toBe(0);
  });

  it('gives the question back when the request does not succeed', async () => {
    const res = mockRes();
    await run('voice_ask', req, res);
    expect((await getFeatureAIUsage(userId, 'voice_ask')).used).toBe(1);

    // A clip Whisper could not read, a provider outage: the student should not
    // lose one of the day's questions for work that never happened.
    res.statusCode = 503;
    await res.finish();
    expect((await getFeatureAIUsage(userId, 'voice_ask')).used).toBe(0);
  });

  it('never mints a global AI use when a free feature is refunded by hand', async () => {
    const res = mockRes();
    await run('voice_ask', req, res);
    // A handler that answers 2xx without doing the work refunds explicitly.
    // The paid path returns a global credit here; doing that for a free
    // feature would CREATE an AI use out of nothing.
    await refundFeatureAiCredit(userId, 'voice_ask');

    expect((await getFeatureAIUsage(userId, 'voice_ask')).used).toBe(0);
    expect((await getAIUsage(userId)).used).toBe(0);
  });
});
