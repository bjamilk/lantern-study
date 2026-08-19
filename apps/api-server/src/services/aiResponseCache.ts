/**
 * Shared AI response cache: hash(feature + source + options) → JSON result.
 * Memory LRU is always on (per process). Redis is used when available so API
 * replicas and workers share hits. OCR and YouTube transcripts keep their own
 * caches and are not stored here.
 */
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getRedisClient, redisKey } from './redisStore';

export const CACHED_AI_PROVIDER = 'cache';

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;
const PREFIX = 'ai_response:';

const memory = new LRUCache<string, string>({
  max: 2000,
  maxSize: 32 * 1024 * 1024,
  sizeCalculation: (value) => value.length,
  ttl: DEFAULT_TTL_SEC * 1000,
  updateAgeOnGet: true,
  allowStale: false,
});

function cacheTtlSec(): number {
  const parsed = parseInt(process.env.AI_RESPONSE_CACHE_TTL_SEC || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SEC;
}

function isCacheEnabled(): boolean {
  const raw = process.env.AI_RESPONSE_CACHE;
  if (raw === '0' || raw === 'false') return false;
  return true;
}

/** Stable JSON so {b:1,a:2} and {a:2,b:1} hash the same. Drops undefined. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

/**
 * Bump to invalidate every stored response.
 *
 * Entries live for 7 days and nothing validated them on the way in, so a run of
 * degenerate output — quizzes generated with no answer options while the
 * provider chain was broken — stayed pinned for a week and survived every
 * retry, because a cache hit never re-asks the model. Changing this retires
 * that batch without waiting out the TTL or flushing Redis by hand.
 */
const CACHE_VERSION = 'v2';

export function hashAiCacheKey(feature: string, source: string, options?: unknown): string {
  const payload = `${CACHE_VERSION}\n${feature}\n${source}\n${stableStringify(options ?? null)}`;
  return createHash('sha256').update(payload).digest('hex');
}

function redisCacheKey(hash: string): string {
  return redisKey(`${PREFIX}${hash}`);
}

export async function getCachedAiResponse<T>(
  feature: string,
  source: string,
  options?: unknown
): Promise<T | null> {
  if (!isCacheEnabled()) return null;
  const hash = hashAiCacheKey(feature, source, options);
  const fromMemory = memory.get(hash);
  if (fromMemory) {
    try {
      return JSON.parse(fromMemory) as T;
    } catch {
      memory.delete(hash);
    }
  }

  const redis = await getRedisClient();
  if (redis?.isOpen) {
    try {
      const raw = await redis.get(redisCacheKey(hash));
      if (raw) {
        memory.set(hash, raw, { ttl: cacheTtlSec() * 1000 });
        return JSON.parse(raw) as T;
      }
    } catch {
      // Fall through to a miss — never fail the request because cache is down.
    }
  }
  return null;
}

export async function setCachedAiResponse(
  feature: string,
  source: string,
  options: unknown,
  value: unknown
): Promise<void> {
  if (!isCacheEnabled()) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  const hash = hashAiCacheKey(feature, source, options);
  const ttlSec = cacheTtlSec();
  memory.set(hash, serialized, { ttl: ttlSec * 1000 });

  const redis = await getRedisClient();
  if (redis?.isOpen) {
    try {
      await redis.setEx(redisCacheKey(hash), ttlSec, serialized);
    } catch {
      // Memory still holds the entry for this process.
    }
  }
}

/**
 * Return a cached result (provider rewritten to `cache`) or produce, store, and return.
 */
export async function withAiResponseCache<T extends { provider?: string }>(
  feature: string,
  source: string,
  options: unknown,
  produce: () => Promise<T>
): Promise<T> {
  const cached = await getCachedAiResponse<T>(feature, source, options);
  if (cached) {
    // The stored result carries the token usage of the call that produced it.
    // Replaying it costs nothing, so reporting those tokens again would count
    // spend that never happened — drop usage along with the original provider.
    const replay: Record<string, unknown> = {
      ...(cached as unknown as Record<string, unknown>),
      provider: CACHED_AI_PROVIDER,
    };
    delete replay.usage;
    return replay as unknown as T;
  }
  const result = await produce();
  await setCachedAiResponse(feature, source, options, result);
  return result;
}

/** Test-only: empty the in-process LRU. */
export function clearAiResponseCacheForTests(): void {
  memory.clear();
}
