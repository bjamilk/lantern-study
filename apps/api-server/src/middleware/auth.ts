import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { apiKeyService } from '../services/apiKey';
import { SupabaseService } from '../services/supabase';
import { AuthenticatedRequest } from '../types';

// Will be set by initializeAuthMiddleware
let supabaseService: SupabaseService | null = null;

// ---------------------------------------------------------------------------
// Token verification cache
// Avoids a round-trip to Supabase Auth on every authenticated request.
// Keyed by SHA-256(token) so the raw JWT is never stored in memory.
// TTL: 60 s — tokens are short-lived (1 h) so a 60 s window is safe.
// ---------------------------------------------------------------------------
interface CachedUser { id: string; [key: string]: any }
const tokenCache = new LRUCache<string, CachedUser>({
  max: 20_000,          // ~20k simultaneous active users
  ttl: 60_000,          // 60 second TTL
  updateAgeOnGet: true,
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const initializeAuthMiddleware = (supabase: SupabaseService) => {
  supabaseService = supabase;
};

export const authenticateApiKey = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = (req.headers as any).authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Use Authorization: Bearer <api-key>',
      });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate the API key
    const validation = await apiKeyService.validateApiKey(apiKey);

    if (!validation.isValid || !validation.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
      return;
    }

    // Attach user info to request
    req.user = {
      id: validation.userId,
      apiKey,
      permissions: validation.permissions || [],
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
};

// Main authentication middleware that can handle both Supabase tokens and API keys
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = (req.headers as any).authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authorization header required. Use Authorization: Bearer <token>',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const tokenKey = hashToken(token);

    // Fast path: return cached user (avoids Supabase Auth DB call)
    const cached = tokenCache.get(tokenKey);
    if (cached) {
      req.user = { id: cached.id, apiKey: token, permissions: ['read', 'write'] };
      next();
      return;
    }

    // Slow path: verify with Supabase Auth (once per minute per token)
    if (supabaseService) {
      const supabaseResult = await supabaseService.verifySupabaseToken(token);
      if (supabaseResult.isValid && supabaseResult.user) {
        tokenCache.set(tokenKey, supabaseResult.user);
        req.user = {
          id: supabaseResult.user.id,
          apiKey: token,
          permissions: ['read', 'write'],
        };
        next();
        return;
      }
    }

    // Fallback to API key authentication
    const validation = await apiKeyService.validateApiKey(token);

    if (!validation.isValid || !validation.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      return;
    }

    req.user = {
      id: validation.userId,
      apiKey: token,
      permissions: validation.permissions || [],
    };

    next();
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

// Optional auth middleware - extracts user info if token present, but doesn't block
// Use this for routes that should work for both authenticated and unauthenticated users
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = (req.headers as any).authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth header, continue without user info
      next();
      return;
    }

    const token = authHeader.substring(7);

    // Try to verify as Supabase token
    if (supabaseService) {
      const supabaseResult = await supabaseService.verifySupabaseToken(token);
      if (supabaseResult.isValid && supabaseResult.user) {
        req.user = {
          id: supabaseResult.user.id,
          apiKey: token,
          permissions: ['read', 'write'],
        };
        next();
        return;
      }
    }

    // Try API key auth
    const validation = await apiKeyService.validateApiKey(token);
    if (validation.isValid && validation.userId) {
      req.user = {
        id: validation.userId,
        apiKey: token,
        permissions: validation.permissions || [],
      };
    }

    // Continue regardless (user may or may not be set)
    next();
  } catch (error) {
    // On error, just continue without auth
    console.warn('Optional auth error:', error);
    next();
  }
};

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('API Error:', error);

  // Handle different types of errors
  if (error.code === 'PGRST116') {
    // Supabase error for ambiguous relationships
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

  // Default error response
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