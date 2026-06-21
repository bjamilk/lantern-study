import { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';

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

// 2. Rate Limiting Configuration
export const createRateLimiter = (options?: {
  windowMs?: number;
  max?: number;
  message?: string;
}) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return rateLimit({
    windowMs: options?.windowMs || (isProduction ? 60 * 1000 : 60 * 60 * 1000),
    max: options?.max || (isProduction ? 100 : 10000),
    message: { 
      error: options?.message || 'Too many requests, please try again later',
      code: 'RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: AuthenticatedRequest) => {
      if (req.user?.userId) return req.user.userId;
      const ip = req.ip || 'anonymous';
      return ipKeyGenerator(ip);
    },
    skip: (req) => {
      return req.path === '/health' || req.path === '/ready';
    },
  });
};

// Pre-configured rate limiters
export const rateLimiters = {
  general: createRateLimiter({ max: 100, windowMs: 60 * 1000 }),
  auth: createRateLimiter({ 
    max: 10, 
    windowMs: 15 * 60 * 1000,
    message: 'Too many login attempts, please try again later'
  }),
  expensive: createRateLimiter({ 
    max: 20, 
    windowMs: 60 * 1000,
    message: 'Too many requests for this resource'
  }),
  messages: createRateLimiter({ 
    max: 60, 
    windowMs: 60 * 1000,
    message: 'Sending messages too quickly'
  }),
};

// 3. Security Headers
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
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
      process.env.WEB_APP_URL,
      process.env.MOBILE_APP_URL,
    ].filter(Boolean) as string[];
    
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-User-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
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

// 6. Input Sanitization
export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .substring(0, 50000);
};

export const sanitizeObject = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[sanitizeInput(key)] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
};

export const sanitizationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
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
