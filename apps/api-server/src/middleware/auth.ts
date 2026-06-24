import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { apiKeyService } from '../services/apiKey';
import { SupabaseService } from '../services/supabase';
import { isUserBanned } from '../services/adminAudit';
import { authenticatedRateLimit, apiKeyAuthRateLimit } from './rateLimit';
import { AuthenticatedRequest } from '../types';

let supabaseService: SupabaseService | null = null;

interface CachedUser { id: string; [key: string]: any }
const tokenCache = new LRUCache<string, CachedUser>({
  max: 20_000,
  ttl: 60_000,
  updateAgeOnGet: true,
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function extractAuthCredential(req: Request): string | null {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

function attachUser(
  req: AuthenticatedRequest,
  user: { id: string; permissions: string[]; isAdmin?: boolean; credentialType: 'jwt' | 'api_key' }
): void {
  req.user = user;
}

function proceedWithAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  authenticatedRateLimit(req, res, next);
}

async function rejectIfBanned(userId: string, res: Response): Promise<boolean> {
  if (!supabaseService) return false;
  const banned = await isUserBanned(supabaseService, userId);
  if (banned) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Your account has been suspended. Contact support if you believe this is an error.',
      code: 'ACCOUNT_BANNED',
    });
    return true;
  }
  return false;
}

export const initializeAuthMiddleware = (supabase: SupabaseService) => {
  supabaseService = supabase;
};

/** JWT-only auth for API key management routes (keys cannot mint sibling keys). */
export const jwtOnlyAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const credential = extractAuthCredential(req);
  if (!credential || apiKeyService.isApiKeyFormat(credential)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'JWT required. API keys cannot access this endpoint.',
    });
    return;
  }

  const tokenKey = hashToken(credential);
  const cached = tokenCache.get(tokenKey);
  if (cached) {
    if (await rejectIfBanned(cached.id, res)) return;
    attachUser(req, {
      id: cached.id,
      permissions: ['read', 'write'],
      isAdmin: cached.app_metadata?.is_platform_admin === true,
      credentialType: 'jwt',
    });
    proceedWithAuth(req, res, next);
    return;
  }

  if (supabaseService) {
    const supabaseResult = await supabaseService.verifySupabaseToken(credential);
    if (supabaseResult.isValid && supabaseResult.user) {
      if (await rejectIfBanned(supabaseResult.user.id, res)) return;
      tokenCache.set(tokenKey, supabaseResult.user);
      attachUser(req, {
        id: supabaseResult.user.id,
        permissions: ['read', 'write'],
        isAdmin: supabaseResult.user.app_metadata?.is_platform_admin === true,
        credentialType: 'jwt',
      });
      proceedWithAuth(req, res, next);
      return;
    }
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid or expired token',
  });
};

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const credential = extractAuthCredential(req);
    if (!credential) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authorization required. Use Authorization: Bearer <token> or X-API-Key: <key>',
      });
      return;
    }

    if (apiKeyService.isApiKeyFormat(credential)) {
      const validation = await apiKeyService.validateKey(credential);
      if (!validation.isValid || !validation.userId) {
        apiKeyAuthRateLimit(req, res, () => {
          res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key',
          });
        });
        return;
      }
      if (await rejectIfBanned(validation.userId, res)) return;
      attachUser(req, {
        id: validation.userId,
        permissions: validation.permissions || ['read'],
        credentialType: 'api_key',
      });
      proceedWithAuth(req, res, next);
      return;
    }

    const tokenKey = hashToken(credential);
    const cached = tokenCache.get(tokenKey);
    if (cached) {
      if (await rejectIfBanned(cached.id, res)) return;
      attachUser(req, {
        id: cached.id,
        permissions: ['read', 'write'],
        isAdmin: cached.app_metadata?.is_platform_admin === true,
        credentialType: 'jwt',
      });
      proceedWithAuth(req, res, next);
      return;
    }

    if (supabaseService) {
      const supabaseResult = await supabaseService.verifySupabaseToken(credential);
      if (supabaseResult.isValid && supabaseResult.user) {
        if (await rejectIfBanned(supabaseResult.user.id, res)) return;
        tokenCache.set(tokenKey, supabaseResult.user);
        attachUser(req, {
          id: supabaseResult.user.id,
          permissions: ['read', 'write'],
          isAdmin: supabaseResult.user.app_metadata?.is_platform_admin === true,
          credentialType: 'jwt',
        });
        proceedWithAuth(req, res, next);
        return;
      }
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token',
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
};

export const requirePermission = (requiredPermission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!apiKeyService.hasPermission(req.user.permissions, requiredPermission)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Permission '${requiredPermission}' required`,
      });
      return;
    }

    next();
  };
};

export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const credential = extractAuthCredential(req);
    if (!credential) {
      next();
      return;
    }

    if (apiKeyService.isApiKeyFormat(credential)) {
      const validation = await apiKeyService.validateKey(credential);
      if (validation.isValid && validation.userId) {
        attachUser(req, {
          id: validation.userId,
          permissions: validation.permissions || ['read'],
          credentialType: 'api_key',
        });
      }
      next();
      return;
    }

    if (supabaseService) {
      const supabaseResult = await supabaseService.verifySupabaseToken(credential);
      if (supabaseResult.isValid && supabaseResult.user) {
        attachUser(req, {
          id: supabaseResult.user.id,
          permissions: ['read', 'write'],
          credentialType: 'jwt',
        });
      }
    }

    next();
  } catch (error) {
    console.warn('Optional auth error:', error);
    next();
  }
};

export const requirePlatformAdmin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ success: false, error: 'Platform admin access required' });
    return;
  }

  if (supabaseService) {
    const isAdmin = await supabaseService.isPlatformAdmin(req.user.id);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Platform admin access required' });
      return;
    }
  }

  next();
};

// Legacy export kept for compatibility
export const authenticateApiKey = authMiddleware;

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('API Error:', error);

  if (error.code === 'PGRST116') {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Database relationship error. Please check your query.',
    });
    return;
  }

  if (error.message?.includes('JWT')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  });
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} - ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
    );
  });

  next();
};
