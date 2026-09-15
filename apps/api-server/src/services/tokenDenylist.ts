/**
 * JWT access-token denylist (logout / session invalidation).
 * Tokens remain valid at Supabase until expiry unless listed here.
 */
/**
 * Purpose: revoke Supabase-issued access tokens before they expire. Supabase
 * does not invalidate an already-issued JWT, so logout and "sign out
 * everywhere" are enforced here, on every authenticated request.
 *
 * Exports: `denylistAccessToken` / `isAccessTokenDenied` (single-token
 * revocation), `setUserSessionCutoff` / `getUserSessionCutoff` /
 * `isTokenIssuedBeforeUserCutoff` (all-devices revocation),
 * `hashAccessToken`, `ttlUntilJwtExpiry`, `getJwtIssuedAt` and
 * `evictTokenFromAuthCache`. Called by middleware/auth.ts on the verify path
 * and by routes/auth.ts on logout, password change and account actions.
 *
 * What it touches: Redis only, through `getRedisClient` and the `redisKey`
 * prefixer. Two key shapes:
 * - `token_denylist:<sha256 hex of the raw JWT>` = "1", TTL = seconds until
 *   that token's own `exp` (minimum 1s), so an entry cannot outlive the token
 *   it revokes.
 * - `user_session_cutoff:<userId>` = a unix-seconds watermark, TTL 30 days
 *   (CUTOFF_KEY_TTL_SEC, the maximum JWT lifetime window). A token whose `iat`
 *   is at or before the watermark is rejected. The watermark only ever moves
 *   forward — a write takes `max(existing, now)`.
 * The raw token is never stored; only its SHA-256.
 *
 * FAIL CLOSED. When Redis is unreachable and
 * `NODE_ENV=production && REDIS_ENABLED=true`, this module denies rather than
 * degrades: `isAccessTokenDenied` returns true and
 * `isTokenIssuedBeforeUserCutoff` returns true, so every request is rejected;
 * the two WRITE paths throw instead of silently recording nothing. That is a
 * deliberate decision and must not be relaxed. Falling back to the in-process
 * Maps in production would mean revocation is unverifiable and a logged-out
 * or stolen token keeps working until it expires — and on a multi-instance
 * deployment the Maps are per-process, so a revocation recorded on one
 * instance would not be seen by the others. The Maps exist for local
 * development and tests, where `isProductionRedisRequired()` is false.
 */
import { createHash } from 'crypto';
import { getRedisClient, redisKey } from './redisStore';

// --- Keys, TTLs and the dev-only in-process fallback -------------------------

const DENY_PREFIX = 'token_denylist:';
const CUTOFF_PREFIX = 'user_session_cutoff:';
/** Max JWT lifetime window for cutoff keys (30 days). */
const CUTOFF_KEY_TTL_SEC = 60 * 60 * 24 * 30;
const memoryDenylist = new Map<string, number>();
const memoryCutoffs = new Map<string, number>();

function isProductionRedisRequired(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.REDIS_ENABLED === 'true';
}

// --- Single-token revocation (one logout, one device) ------------------------

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

/**
 * What a revocation check actually established.
 *
 * FIXED (SW) [Sentry WEB-17, 57 events / 5 users]: fail-closed is right, but
 * the boolean made "this token is revoked" and "Redis is unreachable so we
 * cannot tell" indistinguishable — and middleware/auth.ts answered BOTH with
 * `401 SESSION_REVOKED`, which the web client treats as terminal and signs the
 * user out on the spot. A Redis blip therefore logged every active student out
 * of a session that was still perfectly valid. The request is still refused
 * when we cannot verify (nothing is relaxed); it is refused with a status that
 * says "try again", not "your session is over".
 */
export type RevocationCheck = 'allowed' | 'denied' | 'unavailable';

export async function checkAccessTokenDenied(token: string): Promise<RevocationCheck> {
  const hash = hashAccessToken(token);
  const client = await getRedisClient();
  if (client) {
    try {
      const val = await client.get(denylistKey(hash));
      return val === '1' ? 'denied' : 'allowed';
    } catch {
      // The connection dropped mid-command. Same situation as no client at all
      // — and this used to escape as an unhandled throw, which the auth
      // middleware turned into a 500.
      return isProductionRedisRequired() ? 'unavailable' : 'allowed';
    }
  }
  if (isProductionRedisRequired()) {
    // Fail closed: cannot verify revocation without Redis in production.
    return 'unavailable';
  }
  const expiresAt = memoryDenylist.get(hash);
  if (!expiresAt) return 'allowed';
  if (expiresAt <= Date.now()) {
    memoryDenylist.delete(hash);
    return 'allowed';
  }
  return 'denied';
}

/** Back-compat boolean (still fail-closed). Prefer `checkAccessTokenDenied`. */
export async function isAccessTokenDenied(token: string): Promise<boolean> {
  return (await checkAccessTokenDenied(token)) !== 'allowed';
}

export function evictTokenFromAuthCache(token: string, tokenCache: { delete: (key: string) => void }): void {
  tokenCache.delete(hashAccessToken(token));
}

// --- All-devices revocation (session cutoff watermark) -----------------------
// One key per user instead of one per token: a password change or "sign out
// everywhere" cannot enumerate the tokens it needs to kill, so it stamps a
// watermark and every token issued at or before it is refused.

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

/**
 * The current watermark, or null when there is none.
 *
 * With Redis down in production this returns null — "unknown", not "no
 * cutoff". The fail-closed decision is made by
 * `isTokenIssuedBeforeUserCutoff`, which refuses before it ever gets here, so
 * this null is never read as permission. A caller that consults this function
 * directly must make the same refusal itself.
 */
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

/**
 * True when this token predates the user's cutoff and must be refused.
 *
 * A token whose `iat` cannot be read is treated as revoked: an unparseable
 * issue time cannot be proven to be after the watermark.
 */
export async function isTokenIssuedBeforeUserCutoff(token: string, userId: string): Promise<boolean> {
  return (await checkTokenIssuedBeforeUserCutoff(token, userId)) !== 'allowed';
}

/** Tri-state twin of the above — see `RevocationCheck` (SW / Sentry WEB-17). */
export async function checkTokenIssuedBeforeUserCutoff(
  token: string,
  userId: string
): Promise<RevocationCheck> {
  const client = await getRedisClient();
  if (!client && isProductionRedisRequired()) {
    // Fail closed: cannot verify session revocation without Redis in production.
    return 'unavailable';
  }
  let cutoff: number | null;
  try {
    cutoff = await getUserSessionCutoff(userId);
  } catch {
    return isProductionRedisRequired() ? 'unavailable' : 'allowed';
  }
  if (cutoff == null) return 'allowed';
  const iat = getJwtIssuedAt(token);
  if (iat == null) return 'denied';
  return iat <= cutoff ? 'denied' : 'allowed';
}
