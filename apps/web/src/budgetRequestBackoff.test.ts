import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/supabase', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
}));

// Static imports on purpose: a dynamic `await import()` inside a test charges
// the module graph's load time to that test's 5s budget, which makes it fail
// under a loaded runner for reasons that have nothing to do with the assertion.
import { resetRequestThrottle } from '../../../services/requestThrottle';
import {
  fetchBudgetWalletData,
  isBudgetWalletRateLimited,
} from '../../../services/budgetApi';

/**
 * SW / Sentry WEB-1H + WEB-1S: the Budget screen refreshes on open, on focus
 * and on visibilitychange, so a 429 used to be answered with another request —
 * 78 + 74 events from one user in one afternoon.
 */
describe('budgetRequest backoff (SW)', () => {
  beforeEach(() => {
    resetRequestThrottle();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRequestThrottle();
  });

  const ok = (data: unknown) =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data }),
    }) as unknown as Response;

  const tooMany = (retryAfter: string | null) =>
    ({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter : null) },
      json: async () => ({ error: 'Too Many Requests' }),
    }) as unknown as Response;

  it('shares one request between two refreshes that land together', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ walletBalance: 10 }));

    const [a, b] = await Promise.all([fetchBudgetWalletData(), fetchBudgetWalletData()]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.walletBalance).toBe(10);
    expect(b.walletBalance).toBe(10);
  });

  it('stops sending after a 429 and reports the wait instead of refetching', async () => {
    vi.mocked(fetch).mockResolvedValue(tooMany('30'));

    await expect(fetchBudgetWalletData()).rejects.toMatchObject({ status: 429 });
    expect(isBudgetWalletRateLimited()).toBe(true);

    // The next two refresh triggers must not reach the network at all.
    await expect(fetchBudgetWalletData()).rejects.toMatchObject({ status: 429 });
    await expect(fetchBudgetWalletData()).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('carries the status on every failure, not just 429', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ error: 'Internal Server Error' }),
    } as unknown as Response);

    await expect(fetchBudgetWalletData()).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    });
  });
});
