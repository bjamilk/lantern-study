import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';

// For now, use memory store instead of Redis store to avoid dependency issues
// TODO: Implement Redis store when rate-limit-redis is properly configured

// Rate limiting configurations
export const createRateLimit = (
  windowMs: number = 15 * 60 * 1000, // 15 minutes
  maxRequests: number = 100,
  message: string = 'Too many requests from this IP, please try again later.'
) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: {
      error: 'Rate Limit Exceeded',
      message,
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use user ID for authenticated requests, IP for anonymous.
    // Normalize IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1).
    keyGenerator: (req: Request) => {
      const authReq = req as AuthenticatedRequest;
      if (authReq.user?.id) return authReq.user.id;
      // Use express-rate-limit helper to ensure IPv6-safe normalization.
      // Cast to any because the type definitions in this version declare the
      // helper as accepting a string, but at runtime it accepts the request.
      return (ipKeyGenerator as any)(req);
    },
    // Skip rate limiting for health checks
    skip: (req: Request) => {
      return req.path === '/health' || req.path === '/api/health';
    },
  });
};

// Main rate limit middleware
export const rateLimitMiddleware = createRateLimit(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 100 requests default
  'API rate limit exceeded. Please slow down your requests.'
);

// Different rate limits for different endpoints
export const authRateLimit = createRateLimit(
  5 * 60 * 1000, // 5 minutes
  5, // 5 attempts
  'Too many authentication attempts, please try again later.'
);

export const apiRateLimit = createRateLimit(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 100 requests default
  'API rate limit exceeded. Please slow down your requests.'
);

export const strictRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  10, // 10 requests
  'Too many requests. Please wait before trying again.'
);

// Burst rate limit for expensive operations
export const burstRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  5, // 5 requests
  'Too many expensive operations. Please wait before trying again.'
);

// Custom rate limit for specific user tiers (could be expanded)
export const premiumRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  1000, // 1000 requests for premium users
  'Premium rate limit exceeded.'
);

// Middleware to check if user is premium (placeholder)
export const checkPremiumAccess = (req: AuthenticatedRequest, res: Response, next: any) => {
  // In a real app, you'd check user's subscription tier
  // For now, just pass through
  next();
};