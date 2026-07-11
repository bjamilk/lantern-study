/**
 * JWT access-token denylist (logout / session invalidation).
 * Tokens remain valid at Supabase until expiry unless listed here.
 */
import { createHash } from 'crypto';
import { getRedisClient, redisKey } from './redisStore';

const DENY_PREFIX = 'token_denylist:';
const CUTOFF_PREFIX = 'user_session_cutoff:';
/** Max JWT lifetime window for cutoff keys (30 days). */
const CUTOFF_KEY_TTL_SEC = 60 * 60 * 24 * 30;
const memoryDenylist = new Map<string, number>();
const memoryCutoffs = new Map<string, number>();

function isProductionRedisRequired(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.REDIS_ENABLED === 'true';
}

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
  if (isProductionRedisRequired()) {
    throw new Error('Redis is required for token denylist in production');
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
  if (isProductionRedisRequired()) {
    // Fail closed: cannot verify revocation without Redis in production.
    return true;
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

function cutoffKey(userId: string): string {
  return redisKey(`${CUTOFF_PREFIX}${userId}`);
}

export function getJwtIssuedAt(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.iat === 'number' ? payload.iat : null;
  } catch {
    return null;
  }
}

/** Invalidate all access tokens issued at or before this moment (multi-device logout). */
export async function setUserSessionCutoff(userId: string): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000);
  const client = await getRedisClient();
  if (client) {
    const existing = await client.get(cutoffKey(userId));
    const next = existing ? Math.max(parseInt(existing, 10) || 0, cutoff) : cutoff;
    await client.setEx(cutoffKey(userId), CUTOFF_KEY_TTL_SEC, String(next));
    return;
  }
  if (isProductionRedisRequired()) {
    throw new Error('Redis is required for session cutoff in production');
  }
  const prev = memoryCutoffs.get(userId) ?? 0;
  memoryCutoffs.set(userId, Math.max(prev, cutoff));
}

export async function getUserSessionCutoff(userId: string): Promise<number | null> {
  const client = await getRedisClient();
  if (client) {
    const val = await client.get(cutoffKey(userId));
    if (!val) return null;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isProductionRedisRequired()) {
    return null;
  }
  return memoryCutoffs.get(userId) ?? null;
}

export async function isTokenIssuedBeforeUserCutoff(token: string, userId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client && isProductionRedisRequired()) {
    // Fail closed: cannot verify session revocation without Redis in production.
    return true;
  }
  const cutoff = await getUserSessionCutoff(userId);
  if (cutoff == null) return false;
  const iat = getJwtIssuedAt(token);
  if (iat == null) return true;
  return iat <= cutoff;
}
