/**
 * F7a: a provider rate-limit must be a slowdown, not an outage.
 *
 * `withAiInflight` used to hold its gate slot for the whole call, including the
 * cooldown wait and the per-provider 429 backoff. One provider rate-limiting
 * therefore parked every slot in `sleep`, and unrelated callers got
 * 503 "AI capacity temporarily exhausted". The slot is now released for the
 * duration of the wait and taken back (bounded) afterwards.
 */
import { aiInflightGate } from '../utils/concurrencyGate';
import { chatCompletion } from './aiService';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  jest.restoreAllMocks();
});

describe('in-flight gate across rate-limit backoff', () => {
  it('does not hold a slot while waiting out a provider 429', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'Rate limit reached, try again in 0.05s' } }),
          text: async () => 'Rate limit reached, try again in 0.05s',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => 'ok',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const samples: number[] = [];
    const sampler = setInterval(() => samples.push(aiInflightGate.activeCount), 25);
    try {
      const result = await chatCompletion('system', 'user');
      expect(result.text).toBeTruthy();
    } finally {
      clearInterval(sampler);
    }

    // The gate was observed empty at least once while the call was still in
    // progress — i.e. the backoff did not cost anyone else their capacity.
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.min(...samples)).toBe(0);
    // And the slot is handed back when the call ends.
    expect(aiInflightGate.activeCount).toBe(0);
  });
});
