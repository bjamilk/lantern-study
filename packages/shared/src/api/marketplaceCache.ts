/**
 * In-memory TTL cache + singleflight for marketplace read endpoints.
 */

export interface CachedFetchOptions {
  ttlMs: number;
  backoffMs?: number;
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 30_000) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfterMs(response: Response): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }
  const reset = response.headers.get('ratelimit-reset');
  if (reset) {
    const resetEpoch = parseInt(reset, 10);
    if (!Number.isNaN(resetEpoch)) {
      const ms = resetEpoch * 1000 - Date.now();
      if (ms > 0) return ms;
    }
  }
  return 30_000;
}

export function createReadCache<T>(defaultOptions: CachedFetchOptions) {
  const cacheByKey = new Map<string, { value: T; at: number }>();
  const inflightByKey = new Map<string, Promise<T>>();
  const backoffByKey = new Map<string, number>();

  return {
    async get(
      key: string,
      fetcher: () => Promise<T>,
      options?: Partial<CachedFetchOptions>
    ): Promise<T> {
      const ttlMs = options?.ttlMs ?? defaultOptions.ttlMs;
      const backoffMs = options?.backoffMs ?? defaultOptions.backoffMs ?? 30_000;
      const now = Date.now();

      const backoffUntil = backoffByKey.get(key) ?? 0;
      if (now < backoffUntil) {
        const cached = cacheByKey.get(key);
        if (cached) return cached.value;
      }

      const cached = cacheByKey.get(key);
      if (cached && now - cached.at < ttlMs) {
        return cached.value;
      }

      const existing = inflightByKey.get(key);
      if (existing) return existing;

      const promise = fetcher()
        .then((value) => {
          cacheByKey.set(key, { value, at: Date.now() });
          backoffByKey.delete(key);
          return value;
        })
        .catch((err: unknown) => {
          if (err instanceof RateLimitError) {
            backoffByKey.set(key, Date.now() + (err.retryAfterMs || backoffMs));
          }
          throw err;
        })
        .finally(() => {
          inflightByKey.delete(key);
        });

      inflightByKey.set(key, promise);
      return promise;
    },

    clear(): void {
      cacheByKey.clear();
      inflightByKey.clear();
      backoffByKey.clear();
    },
  };
}

export const marketplaceListingsCache = createReadCache<unknown>({
  ttlMs: 20_000,
  backoffMs: 30_000,
});

export const marketplaceCategoryAnalyticsCache = createReadCache<unknown>({
  ttlMs: 90_000,
  backoffMs: 30_000,
});

export function listingsCacheKey(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
  return params.toString() || 'default';
}
