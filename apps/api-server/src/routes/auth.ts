import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, evictAuthTokenCache, optionalAuthMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { denylistAccessToken, setUserSessionCutoff } from '../services/tokenDenylist';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logger } from '../utils/logger';
import {
  clearAuthCookies,
  readAccessCookie,
  readRefreshCookie,
  setAuthCookies,
} from '../utils/authCookies';
import { authLoginRateLimit, authSessionRateLimit } from '../middleware/rateLimit';
import type { AuthenticatedRequest } from '../types';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export function initializeAuthRoutes(supabase: SupabaseService, cache: CacheService): void {
  supabaseService = supabase;
  cacheService = cache;
}

function getAnonAuthClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for auth routes');
  }
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extractBearerToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return readAccessCookie((req as any).cookies || {});
}

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user: unknown;
};

/** Never expose refresh_token in JSON — HttpOnly cookies only. */
function serializeClientSession(
  session: SessionPayload,
  options?: { includeAccessToken?: boolean }
) {
  const payload: Record<string, unknown> = {
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  };
  if (options?.includeAccessToken) {
    payload.access_token = session.access_token;
  }
  return payload;
}

async function applySessionCookies(res: Response, session: SessionPayload) {
  const expiresIn = session.expires_in ?? Math.max(60, (session.expires_at ?? 0) - Math.floor(Date.now() / 1000));
  setAuthCookies(res, session.access_token, session.refresh_token, expiresIn);
  return serializeClientSession(session);
}

/** POST /api/v1/auth/login */
router.post(
  '/login',
  authLoginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const client = getAnonAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return res.status(401).json({ success: false, error: error?.message || 'Invalid credentials' });
    }

    const session = await applySessionCookies(res, data.session);
    res.json({ success: true, data: { session, user: data.user } });
  })
);

/** POST /api/v1/auth/exchange — set cookies after OAuth/magic-link client session */
router.post(
  '/exchange',
  authSessionRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { access_token, refresh_token, expires_in, expires_at, token_type, user } = req.body || {};
    if (!access_token || !refresh_token || !user?.id) {
      return res.status(400).json({ success: false, error: 'Invalid session payload' });
    }

    const verified = await supabaseService.verifySupabaseToken(access_token);
    if (!verified.isValid || !verified.user || verified.user.id !== user.id) {
      return res.status(401).json({ success: false, error: 'Invalid access token' });
    }

    const session = await applySessionCookies(res, {
      access_token,
      refresh_token,
      expires_in,
      expires_at,
      token_type,
      user,
    });
    res.json({ success: true, data: { session, user } });
  })
);

/** POST /api/v1/auth/refresh */
router.post(
  '/refresh',
  authSessionRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = readRefreshCookie((req as any).cookies || {});
    if (!refreshToken) {
      return res.status(401).json({ success: false, error: 'Missing refresh session', code: 'SESSION_REVOKED' });
    }

    const client = getAnonAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Session expired', code: 'SESSION_REVOKED' });
    }

    await applySessionCookies(res, data.session);
    const session = serializeClientSession(data.session, { includeAccessToken: true });
    res.json({ success: true, data: { session, user: data.user } });
  })
);

/** GET /api/v1/auth/session */
router.get(
  '/session',
  authSessionRateLimit,
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accessToken = extractBearerToken(req) || readAccessCookie((req as any).cookies || {});
    if (!accessToken) {
      const refreshToken = readRefreshCookie((req as any).cookies || {});
      if (!refreshToken) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }
      const client = getAnonAuthClient();
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) {
        clearAuthCookies(res);
        return res.status(401).json({ success: false, error: 'Session expired', code: 'SESSION_REVOKED' });
      }
      await applySessionCookies(res, data.session);
      const session = serializeClientSession(data.session, { includeAccessToken: true });
      return res.json({ success: true, data: { session, user: data.user } });
    }

    const verified = await supabaseService.verifySupabaseToken(accessToken);
    if (!verified.isValid || !verified.user) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Invalid session', code: 'SESSION_REVOKED' });
    }

    res.json({
      success: true,
      data: {
        user: verified.user,
        session: serializeClientSession(
          {
            access_token: accessToken,
            refresh_token: '',
            user: verified.user,
          },
          { includeAccessToken: true }
        ),
      },
    });
  })
);

/** POST /api/v1/auth/logout — invalidate session server-side */
router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    clearAuthCookies(res);

    res.json({ success: true, message: 'Logged out successfully' });
  })
);

export default router;
