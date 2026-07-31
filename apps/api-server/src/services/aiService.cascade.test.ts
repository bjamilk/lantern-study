import { classifyProviderFailure } from './aiService';

describe('classifyProviderFailure', () => {
  it('detects Groq TPM rate limits', () => {
    expect(
      classifyProviderFailure(
        'Groq error 429: Rate limit reached for model llama-3.3-70b-versatile on tokens per minute (TPM)'
      )
    ).toBe('rate_limit');
  });

  it('detects unconfigured providers (0 used)', () => {
    expect(classifyProviderFailure('gemini: unavailable (0/1500 used)')).toBe('not_configured');
  });

  it('detects daily provider exhaustion', () => {
    expect(classifyProviderFailure('groq: unavailable (14400/14400 used)')).toBe('daily_limit');
  });

  it('detects auth failures', () => {
    expect(classifyProviderFailure('Gemini error 401: API key not valid')).toBe('auth');
  });

  it('detects timeouts', () => {
    expect(classifyProviderFailure('The operation was aborted due to timeout')).toBe('timeout');
  });
});
