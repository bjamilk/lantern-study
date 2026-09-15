/**
 * Small request-level authorization helpers plus the production secret gate.
 *
 * Exports:
 *   - `requireAuthUserId` — the standard "get the caller's id or 401" helper
 *     used across route handlers.
 *   - `rejectMismatchedUserId` — blocks a handler from acting on a
 *     client-supplied userId that is not the caller's, unless the caller is a
 *     live platform admin.
 *   - `validateProductionSecrets` — called at the very top of server.ts, before
 *     Sentry and before the app is built.
 *
 * Touches: the request's decoded JWT user, and `utils/platformAdminAuth`, which
 * checks the admin role against the database rather than a token claim.
 */
import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { isLivePlatformAdmin } from './platformAdminAuth';

/** Returns authenticated user ID or sends 401 and returns null. */
export function requireAuthUserId(req: AuthenticatedRequest, res: Response): string | null {
  const id = req.user?.id;
  if (!id) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return null;
  }
  return id;
}

// The admin escape hatch is deliberately a live lookup: `isLivePlatformAdmin`
// re-reads the role rather than trusting a claim in the presented token, so a
// revoked admin cannot keep acting on other users with an old JWT.
/** Reject if client-supplied userId differs from JWT (unless live platform admin). Returns true if rejected. */
export async function rejectMismatchedUserId(
  req: AuthenticatedRequest,
  res: Response,
  clientUserId?: string | null
): Promise<boolean> {
  const authUserId = req.user?.id;
  if (!authUserId) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return true;
  }
  if (clientUserId && clientUserId !== authUserId) {
    const liveAdmin = await isLivePlatformAdmin(authUserId);
    if (!liveAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return true;
    }
  }
  return false;
}

// --- Production boot gate ---
// Runs before anything else in server.ts and is a no-op outside production.
// Two classes of check, both fail-closed with `process.exit(1)`:
//   - Missing required config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
//     REDIS_ENABLED=true with REDIS_URL. Redis is required because without it
//     every rate limiter falls back to a per-process in-memory store and the
//     limits stop being shared across instances.
//   - Dev bypass flags that must never be live: DISABLE_RATE_LIMIT,
//     ALLOW_DEV_AUTH_BYPASS and ALLOW_ALL_CORS each abort the boot rather than
//     being ignored, so a bypass cannot be switched on by an env-var typo in a
//     production deploy.
// FIXED (F10): TURNSTILE_SECRET / TURNSTILE_HOSTNAMES are still not REQUIRED —
// bot protection is optional by product decision, and middleware/turnstile.ts
// treats an unconfigured Turnstile as "not enabled" — but the boot no longer
// stays silent about it. Absent config gets one warning; half-configured gets a
// louder one, because that deployment believes it is protected and is not.
// Warnings only: a missing nice-to-have must not fail a deploy.
/** Fail startup when required secrets are missing in production. */
export function validateProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');

  if (process.env.REDIS_ENABLED !== 'true' || !process.env.REDIS_URL) {
    missing.push('REDIS_ENABLED=true and REDIS_URL (required in production for distributed rate limits)');
  }

  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    console.error('FATAL: DISABLE_RATE_LIMIT must not be set in production');
    process.exit(1);
  }

  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true' || process.env.ALLOW_ALL_CORS === 'true') {
    console.error('FATAL: Dev bypass flags (ALLOW_DEV_AUTH_BYPASS, ALLOW_ALL_CORS) must not be set in production');
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables in production: ${missing.join(', ')}`);
    process.exit(1);
  }

  warnOnUnconfiguredTurnstile();
}

/** See the Turnstile note above. Exported for the test; called from the gate. */
export function warnOnUnconfiguredTurnstile(): void {
  const hasSecret = !!process.env.TURNSTILE_SECRET;
  const hasHostnames = !!(process.env.TURNSTILE_HOSTNAMES || '').trim();
  if (hasSecret && hasHostnames) return;
  if (hasSecret || hasHostnames) {
    console.warn(
      'WARNING: Turnstile is HALF configured (' +
        `TURNSTILE_SECRET ${hasSecret ? 'set' : 'missing'}, ` +
        `TURNSTILE_HOSTNAMES ${hasHostnames ? 'set' : 'missing'}). ` +
        'Verification is DISABLED and every token is accepted. Set both or neither.'
    );
    return;
  }
  console.warn(
    'WARNING: Turnstile is not configured (TURNSTILE_SECRET, TURNSTILE_HOSTNAMES). ' +
      'The contact form has no bot protection.'
  );
}
