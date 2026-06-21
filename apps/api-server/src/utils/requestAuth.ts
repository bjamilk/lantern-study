import { Response } from 'express';
import { AuthenticatedRequest } from '../types';

/** Returns authenticated user ID or sends 401 and returns null. */
export function requireAuthUserId(req: AuthenticatedRequest, res: Response): string | null {
  const id = req.user?.id;
  if (!id) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return null;
  }
  return id;
}

/** Reject if client-supplied userId differs from JWT (unless admin). Returns true if rejected. */
export function rejectMismatchedUserId(
  req: AuthenticatedRequest,
  res: Response,
  clientUserId?: string | null
): boolean {
  const authUserId = req.user?.id;
  if (!authUserId) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return true;
  }
  if (clientUserId && clientUserId !== authUserId && !req.user?.isAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return true;
  }
  return false;
}

/** Fail startup when required secrets are missing in production. */
export function validateProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');

  const redisEnabled = process.env.REDIS_ENABLED === 'true';
  if (redisEnabled && !process.env.REDIS_URL) {
    missing.push('REDIS_URL (required when REDIS_ENABLED=true)');
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
}
