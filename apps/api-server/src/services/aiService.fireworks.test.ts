/**
 * Fireworks is the paid standby behind Groq, so the thing worth pinning down is
 * the probe: it exists to tell an operator whether a newly added key actually
 * authenticates, and it is only useful if a failure reads as a failure rather
 * than being papered over by the next provider in the chain.
 */
import { probeProvider, classifyProviderFailure } from './aiService';

const realFetch = global.fetch;
const realKey = process.env.FIREWORKS_API_KEY;

function mockFetchOnce(impl: () => Promise<Response>) {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  global.fetch = realFetch;
  if (realKey === undefined) delete process.env.FIREWORKS_API_KEY;
  else process.env.FIREWORKS_API_KEY = realKey;
  jest.restoreAllMocks();
});

describe('probeProvider', () => {
  it('reports an unknown provider without calling out', async () => {
    mockFetchOnce(async () => jsonResponse({}, 200));
    const result = await probeProvider('not-a-provider');

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.error).toContain('Unknown provider');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports fireworks as unconfigured when no key is set', async () => {
    delete process.env.FIREWORKS_API_KEY;
    mockFetchOnce(async () => jsonResponse({}, 200));

    const result = await probeProvider('fireworks');

    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Not configured/i);
    // No key means no request — never bill or leak on a misconfiguration.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('confirms a working key and reports the model it used', async () => {
    process.env.FIREWORKS_API_KEY = 'test-key';
    mockFetchOnce(async () =>
      jsonResponse({ choices: [{ message: { content: 'OK' } }] })
    );

    const result = await probeProvider('fireworks');

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.reply).toBe('OK');
    expect(result.model).toContain('gpt-oss-120b');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('strips an inline reasoning trace so JSON parsing still works', async () => {
    process.env.FIREWORKS_API_KEY = 'test-key';
    mockFetchOnce(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              // Nemotron thinks first; the trace contains braces, which would
              // otherwise poison the brace-matching fallback in extractJSON.
              content: '<think>The user wants JSON. Maybe {"a": 1}? No.</think>{"questions":[]}',
            },
          },
        ],
      })
    );

    const result = await probeProvider('fireworks');

    expect(result.ok).toBe(true);
    expect(result.reply).toBe('{"questions":[]}');
    expect(result.reply).not.toContain('<think>');
  });

  it('surfaces a rejected key instead of falling back to another provider', async () => {
    process.env.FIREWORKS_API_KEY = 'bad-key';
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'groq-key';
    mockFetchOnce(async () =>
      jsonResponse({ error: { message: 'Invalid API key' } }, 401)
    );

    const result = await probeProvider('fireworks');

    expect(result.ok).toBe(false);
    // Configured, but not working — the distinction an operator needs.
    expect(result.configured).toBe(true);
    expect(result.error).toContain('401');
    expect(result.provider).toBe('fireworks');
    // Exactly one call: the chain must not be walked, or a healthy Groq would
    // make a dead Fireworks key look fine.
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });
});

describe('groq provider', () => {
  const realKey = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = realKey;
  });

  it('requests the configured replacement model and strips its reasoning', async () => {
    process.env.GROQ_API_KEY = 'groq-test-key';
    mockFetchOnce(async () =>
      jsonResponse({
        choices: [{ message: { content: '<think>weighing {"a":1}</think>{"questions":[]}' } }],
      })
    );

    const result = await probeProvider('groq');

    expect(result.ok).toBe(true);
    // llama-3.3-70b-versatile was decommissioned 2026-08-16; requesting it is
    // what took AI down, so this must never regress to that id.
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('openai/gpt-oss-120b');
    expect(sent.model).not.toContain('llama-3.3');
    expect(result.reply).toBe('{"questions":[]}');
  });
});

describe('classifyProviderFailure', () => {
  it('classifies a Fireworks auth rejection like any other provider', () => {
    expect(
      classifyProviderFailure('Fireworks error 401: {"error":{"message":"Invalid API key"}}')
    ).toBe('auth');
  });
});
