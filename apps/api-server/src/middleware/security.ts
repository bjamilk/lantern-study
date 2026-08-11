import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getAllowedCorsOrigins } from '../utils/corsOrigins';
import { AI_USAGE_EXPOSED_HEADERS } from './aiRateLimit';

// Extended Request type
interface AuthenticatedRequest extends Request {
  user?: { userId: string; email?: string };
  requestId?: string;
}

// 1. Strict Auth Middleware for Production
export const strictAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Skip auth for health checks
  if (req.path === '/health' || req.path === '/ready' || req.path === '/metrics') {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ 
        error: 'Missing authorization header',
        code: 'AUTH_MISSING'
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      res.status(401).json({ 
        error: 'Missing authorization token',
        code: 'AUTH_MISSING'
      });
      return;
    }

    // Verify with Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || 'http://127.0.0.1:55421',
      process.env.SUPABASE_ANON_KEY || ''
    );
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'AUTH_INVALID'
      });
      return;
    }

    req.user = { userId: user.id, email: user.email };
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// Security headers (rate limiting lives in middleware/rateLimit.ts)
export const securityHeaders = helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'http://localhost:55421'],
      connectSrc: ["'self'", process.env.SUPABASE_URL || 'http://127.0.0.1:55421', 'http://localhost:3001'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
});

// 4. CORS Configuration
export const corsConfig = cors({
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedCorsOrigins();

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'X-User-ID'],
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    // Single source of truth — any header aiRateLimit.ts sets must be exposed.
    ...AI_USAGE_EXPOSED_HEADERS,
  ],
  maxAge: 86400,
});

// 5. Request ID Tracking
export const requestIdMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

// Keys that carry raw base64 file payloads — must not be truncated or regex-sanitized.
const BINARY_PAYLOAD_KEYS = new Set([
  'base64Data',
  'audioBase64',
  'apkgBase64',
]);

// 6. Input Sanitization
export const sanitizeInput = (input: string, options?: { maxLength?: number }): string => {
  if (typeof input !== 'string') return input;

  const maxLength = options?.maxLength ?? 50000;
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .substring(0, maxLength);
};

export const sanitizeObject = (obj: any, depth = 0, parentKey?: string): any => {
  if (depth > 8) return obj;
  if (typeof obj === 'string') {
    if (parentKey && BINARY_PAYLOAD_KEYS.has(parentKey)) {
      return obj;
    }
    return sanitizeInput(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1, parentKey));
  }
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[sanitizeInput(key, { maxLength: 200 })] = sanitizeObject(value, depth + 1, key);
    }
    return sanitized;
  }
  return obj;
};

/** Mutate query/params in place — Express 5 exposes them as read-only getters. */
function sanitizeMutableObject(obj: Record<string, unknown>, depth = 0): void {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string') {
      obj[key] = sanitizeInput(value);
    } else if (Array.isArray(value)) {
      obj[key] = sanitizeObject(value, depth + 1);
    } else if (value && typeof value === 'object') {
      sanitizeMutableObject(value as Record<string, unknown>, depth + 1);
    }
  }
}

export const sanitizationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeMutableObject(req.query as Record<string, unknown>);
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeMutableObject(req.params as Record<string, unknown>);
  }
  next();
};

// 7. Joi Validation Middleware
import Joi from 'joi';

export const validateRequest = (schema: Joi.Schema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[property];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });
    
    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
      return;
    }
    
    (req as any)[property] = value;
    next();
  };
};
