/**
 * Token-usage visibility: providers report what each call cost (including the
 * prefix-cache hit volume that cached-input pricing discounts), and cache
 * replays must not re-report tokens that were never spent.
 */
import { generateFlashcardsFromNotes, getProviderStatus, probeProvider } from './aiService';
import { clearAiResponseCacheForTests, CACHED_AI_PROVIDER } from './aiResponseCache';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

function groqReply(payload: unknown, usage?: Record<string, unknown>) {
  const body = {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    ...(usage ? { usage } : {}),
  };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const material =
  'Photosynthesis is the process by which plants convert light energy into chemical energy stored as sugar.';

beforeEach(() => {
  clearAiResponseCacheForTests();
  process.env.GROQ_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  delete process.env.AI_RESPONSE_CACHE;
  jest.restoreAllMocks();
});

describe('provider token usage', () => {
  it('surfaces prompt/completion/cached tokens from an OpenAI-shaped usage block', async () => {
    process.env.AI_RESPONSE_CACHE = 'off';
    global.fetch = jest.fn(async () =>
      groqReply(
        { flashcards: [{ front: 'Q', back: 'A' }] },
        { prompt_tokens: 900, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 512 } }
      )
    ) as unknown as typeof fetch;

    const result = await generateFlashcardsFromNotes(material, { count: 1 });

    expect(result.usage).toEqual({ promptTokens: 900, completionTokens: 120, cachedTokens: 512 });

    // ...and the daily per-provider gauge saw the same call.
    const groq = getProviderStatus().find((p) => p.name === 'groq');
    expect(groq?.tokensToday.calls).toBeGreaterThanOrEqual(1);
    expect(groq?.tokensToday.cachedTokens).toBeGreaterThanOrEqual(512);
  });

  it('reports usage from the probe as well', async () => {
    global.fetch = jest.fn(async () =>
      groqReply('OK', { prompt_tokens: 40, completion_tokens: 2 })
    ) as unknown as typeof fetch;

    const probe = await probeProvider('groq');

    expect(probe.ok).toBe(true);
    expect(probe.usage).toEqual({ promptTokens: 40, completionTokens: 2, cachedTokens: 0 });
  });

  it('a cache replay reports no usage — nothing was spent', async () => {
    // Cache on (default): first call stores, second replays.
    global.fetch = jest.fn(async () =>
      groqReply(
        { flashcards: [{ front: 'Q', back: 'A' }] },
        { prompt_tokens: 900, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 0 } }
      )
    ) as unknown as typeof fetch;

    const first = await generateFlashcardsFromNotes(material, { count: 1 });
    expect(first.usage?.promptTokens).toBe(900);

    const second = await generateFlashcardsFromNotes(material, { count: 1 });

    expect(second.provider).toBe(CACHED_AI_PROVIDER);
    // Re-reporting the stored 900 tokens would count spend that never happened.
    expect(second.usage).toBeUndefined();
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('tolerates providers that report no usage at all', async () => {
    process.env.AI_RESPONSE_CACHE = 'off';
    global.fetch = jest.fn(async () =>
      groqReply({ flashcards: [{ front: 'Q', back: 'A' }] })
    ) as unknown as typeof fetch;

    const result = await generateFlashcardsFromNotes(material, { count: 1 });

    expect(result.flashcards).toHaveLength(1);
    expect(result.usage).toBeUndefined();
  });
});
