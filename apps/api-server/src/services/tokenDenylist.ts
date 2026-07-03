/**
 * JWT access-token denylist (logout / session invalidation).
 * Tokens remain valid at Supabase until expiry unless listed here.
 */
import { createHash } from 'crypto';
import { getRedisClient, redisKey } from './redisStore';

const DENY_PREFIX = 'token_denylist:';
const memoryDenylist = new Map<string, number>();

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function denylistKey(tokenHash: string): string {
  return redisKey(`${DENY_PREFIX}${tokenHash}`);
}

/** TTL in seconds until JWT exp (minimum 1s). */
export function ttlUntilJwtExpiry(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 3600;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    const remaining = exp - Math.floor(Date.now() / 1000);
    return Math.max(1, remaining);
  } catch {
    return 3600;
  }
}

export async function denylistAccessToken(token: string): Promise<void> {
  const hash = hashAccessToken(token);
  const ttl = ttlUntilJwtExpiry(token);
  const client = await getRedisClient();
  if (client) {
    await client.setEx(denylistKey(hash), ttl, '1');
    return;
  }
  memoryDenylist.set(hash, Date.now() + ttl * 1000);
}

export async function isAccessTokenDenied(token: string): Promise<boolean> {
  const hash = hashAccessToken(token);
  const client = await getRedisClient();
  if (client) {
    const val = await client.get(denylistKey(hash));
    return val === '1';
  }
  const expiresAt = memoryDenylist.get(hash);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    memoryDenylist.delete(hash);
    return false;
  }
  return true;
}

export function evictTokenFromAuthCache(token: string, tokenCache: { delete: (key: string) => void }): void {
  tokenCache.delete(hashAccessToken(token));
}
