import { parseGlobalAIUsageFromHeaders } from './usageHeaders';

describe('parseGlobalAIUsageFromHeaders', () => {
  it('ignores feature-scoped companion quota headers', () => {
    const updates: Array<{ used: number; limit: number }> = [];
    const response = new Response('{}', {
      headers: {
        'X-AI-Feature': 'companion',
        'X-AI-Usage-Used': '3',
        'X-AI-Usage-Limit': '15',
      },
    });

    parseGlobalAIUsageFromHeaders(response, (usage) => {
      updates.push({ used: usage.used, limit: usage.limit });
    });

    expect(updates).toHaveLength(0);
  });

  it('updates global usage when no feature header is present', () => {
    const updates: Array<{ used: number; limit: number; remaining: number }> = [];
    const response = new Response('{}', {
      headers: {
        'X-AI-Usage-Used': '5',
        'X-AI-Usage-Limit': '20',
        'X-AI-Usage-Resets-At': '2026-07-03T00:00:00.000Z',
      },
    });

    parseGlobalAIUsageFromHeaders(response, (usage) => {
      updates.push({
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
      });
    });

    expect(updates).toEqual([{ used: 5, limit: 20, remaining: 15 }]);
  });
});
