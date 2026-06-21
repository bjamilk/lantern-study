/**
 * Shared Redis helpers for distributed rate limiting, AI quotas, and ban cache.
 */
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let sharedClient: RedisClient | null = null;
let connecting: Promise<RedisClient | null> | null = null;

export async function getRedisClient(): Promise<RedisClient | null> {
  if (process.env.REDIS_ENABLED !== 'true' || !process.env.REDIS_URL) {
    return null;
  }
  if (sharedClient?.isOpen) return sharedClient;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on('error', (err) => {
        console.warn('Shared Redis error:', err.message);
      });
      await client.connect();
      sharedClient = client;
      return client;
    } catch (err) {
      console.warn('Shared Redis connect failed:', err);
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function disconnectRedis(): Promise<void> {
  if (sharedClient?.isOpen) {
    await sharedClient.quit();
  }
  sharedClient = null;
}

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'lantern:';

export function redisKey(suffix: string): string {
  return `${KEY_PREFIX}${suffix}`;
}
