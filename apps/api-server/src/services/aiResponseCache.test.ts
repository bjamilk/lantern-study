import {
  CACHED_AI_PROVIDER,
  clearAiResponseCacheForTests,
  hashAiCacheKey,
  stableStringify,
  withAiResponseCache,
} from './aiResponseCache';

describe('aiResponseCache', () => {
  beforeEach(() => {
    clearAiResponseCacheForTests();
    delete process.env.AI_RESPONSE_CACHE;
  });

  it('hashes feature + source + options independently of key order', () => {
    const a = hashAiCacheKey('generate_flashcards', 'notes', { style: 'concise', count: 15 });
    const b = hashAiCacheKey('generate_flashcards', 'notes', { count: 15, style: 'concise' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the hash when feature, source, or options change', () => {
    const base = hashAiCacheKey('explain', 'What is osmosis?', { userAnswer: 'A' });
    expect(hashAiCacheKey('ask_tutor', 'What is osmosis?', { userAnswer: 'A' })).not.toBe(base);
    expect(hashAiCacheKey('explain', 'What is mitosis?', { userAnswer: 'A' })).not.toBe(base);
    expect(hashAiCacheKey('explain', 'What is osmosis?', { userAnswer: 'B' })).not.toBe(base);
  });

  it('stableStringify drops undefined keys', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('returns a cached result and skips the producer on a hit', async () => {
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return { provider: 'groq', text: 'hello' };
    };

    const first = await withAiResponseCache('ask_tutor', 'define ATP', { subject: 'bio' }, produce);
    const second = await withAiResponseCache('ask_tutor', 'define ATP', { subject: 'bio' }, produce);

    expect(calls).toBe(1);
    expect(first).toEqual({ provider: 'groq', text: 'hello' });
    expect(second).toEqual({ provider: CACHED_AI_PROVIDER, text: 'hello' });
  });

  it('misses when options differ', async () => {
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return { provider: 'groq', n: calls };
    };
    await withAiResponseCache('generate_questions', 'notes', { count: 10 }, produce);
    await withAiResponseCache('generate_questions', 'notes', { count: 15 }, produce);
    expect(calls).toBe(2);
  });
});
