import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, evictAuthTokenCache } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { denylistAccessToken, setUserSessionCutoff } from '../services/tokenDenylist';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import type { AuthenticatedRequest } from '../types';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export function initializeAuthRoutes(supabase: SupabaseService, cache: CacheService): void {
  supabaseService = supabase;
  cacheService = cache;
}

function extractBearerToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

/** POST /api/v1/auth/logout — invalidate session server-side */
router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: import('express').Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const token = extractBearerToken(req);
    if (token) {
      await denylistAccessToken(token);
      evictAuthTokenCache(token);
    }

    await setUserSessionCutoff(userId);

    try {
      await supabaseService.getClient().auth.admin.signOut(userId, 'global');
    } catch (err) {
      logger.warn('Supabase global signOut failed', { userId, err });
    }

    await cacheService.invalidateUserCache(userId);

    res.json({ success: true, message: 'Logged out successfully' });
  })
);

export default router;
