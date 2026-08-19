/**
 * Credits are reserved before the AI call, because the daily cap has to be
 * enforced before the work starts. The corollary is that a request which never
 * produced a completion has to give them back — otherwise a failing provider
 * eats a user's whole daily allowance one doomed attempt at a time, which is
 * exactly what happened in production once the cap dropped to 20.
 */
import {
  aiRateLimitForFeature,
  getAIUsage,
  getFeatureAIUsage,
  resetAIUsageForUser,
} from './aiRateLimit';

describe('aiRateLimitForFeature refunds', () => {
  const userId = 'test-user-ai-refund';

  beforeEach(async () => {
    await resetAIUsageForUser(userId);
  });

  function mockRes() {
    return {
      headers: {} as Record<string, string>,
      listeners: {} as Record<string, Array<() => void>>,
      statusCode: 200,
      body: null as unknown,
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      },
      on(event: string, cb: () => void) {
        (this.listeners[event] ||= []).push(cb);
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
      /** Mirrors Express emitting 'finish' once the response is flushed. */
      async finish(code?: number) {
        if (code !== undefined) this.statusCode = code;
        for (const cb of this.listeners.finish || []) cb();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    };
  }

  function run(res: ReturnType<typeof mockRes>) {
    const req = { user: { id: userId }, body: {} } as any;
    return new Promise<void>((resolve, reject) => {
      aiRateLimitForFeature('generate_questions')(req, res as any, (err?: unknown) =>
        err ? reject(err) : resolve()
      );
    });
  }

  it('keeps the credit when the request succeeds', async () => {
    const res = mockRes();
    await run(res);
    await res.finish(200);

    expect((await getAIUsage(userId)).used).toBe(1);
    expect((await getFeatureAIUsage(userId, 'generate_questions')).used).toBe(1);
  });

  it('refunds both counters when every AI provider fails (503)', async () => {
    const res = mockRes();
    await run(res);
    expect((await getAIUsage(userId)).used).toBe(1);

    await res.finish(503);

    expect((await getAIUsage(userId)).used).toBe(0);
    expect((await getFeatureAIUsage(userId, 'generate_questions')).used).toBe(0);
  });

  it('refunds when the handler rejects the input (400)', async () => {
    const res = mockRes();
    await run(res);
    await res.finish(400);

    // No AI work happened, so a too-short note must not cost a credit.
    expect((await getAIUsage(userId)).used).toBe(0);
    expect((await getFeatureAIUsage(userId, 'generate_questions')).used).toBe(0);
  });

  it('does not refund an accepted async job (202)', async () => {
    const res = mockRes();
    await run(res);
    await res.finish(202);

    // The queued job still does the work; refunding here would be a free pass.
    expect((await getAIUsage(userId)).used).toBe(1);
  });

  it('repeated failures leave the allowance untouched', async () => {
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await run(res);
      await res.finish(503);
    }

    // The reported symptom: the counter ticked down on every failed attempt.
    expect((await getAIUsage(userId)).used).toBe(0);
    expect((await getFeatureAIUsage(userId, 'generate_questions')).used).toBe(0);
  });
});
