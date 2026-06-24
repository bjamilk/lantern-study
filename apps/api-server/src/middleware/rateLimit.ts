import rateLimit, { ipKeyGenerator, Store, Options } from 'express-rate-limit';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';

// ---------------------------------------------------------------------------
// Rate limiting store selection
// When Redis is enabled (production) we use a shared Redis store so that all
// PM2 cluster workers share the same counters. Without it each worker has its
// own counter, making the effective limit = configured_max × num_workers.
// ---------------------------------------------------------------------------
function buildStore(): Partial<Options> {
  if (process.env.REDIS_ENABLED === 'true' && process.env.REDIS_URL) {
    try {
      // rate-limit-redis is a peer dep — only required when Redis is enabled.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RedisStore } = require('rate-limit-redis');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createClient } = require('redis');
      const redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.connect().catch((e: Error) =>
        console.warn('Rate-limit Redis connect failed, falling back to memory:', e.message)
      );
      return { store: new RedisStore({ sendCommand: (...args: string[]) => redisClient.sendCommand(args) }) };
    } catch {
      console.warn('rate-limit-redis not available, using in-memory store');
    }
  }
  // In-memory store: fine for single-process and development.
  // WARNING: in cluster mode each worker tracks its own counter.
  return {};
}

const sharedStoreOptions = buildStore();

// Rate limiting configurations
export const createRateLimit = (
  windowMs: number = 15 * 60 * 1000,
  maxRequests: number = 100,
  message: string = 'Too many requests from this IP, please try again later.'
) => {
  return rateLimit({
    ...sharedStoreOptions,
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
    // Skip rate limiting for health checks and admin (admin has its own limiter after auth)
    skip: (req: Request) => {
      const path = req.path || '';
      if (
        path === '/health' ||
        path === '/ready' ||
        path === '/metrics' ||
        path === '/api/health' ||
        path.startsWith('/api/v1/admin')
      ) {
        return true;
      }
      return false;
    },
  });
};

// Main rate limit middleware
const defaultWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const defaultMaxRequests =
  process.env.NODE_ENV === 'production'
    ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10000', 10);

export const rateLimitMiddleware = createRateLimit(
  defaultWindowMs,
  defaultMaxRequests,
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

// Admin console reads many endpoints in parallel (overview, marketplace tabs).
// In development, skip dedicated admin throttling — the global dev limit is already high.
export const adminRateLimit =
  process.env.NODE_ENV === 'production'
    ? createRateLimit(
        60 * 1000,
        parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '120', 10),
        'Admin API rate limit exceeded. Please wait before trying again.'
      )
    : (_req: Request, _res: Response, next: () => void) => next();

// Custom rate limit for specific user tiers (could be expanded)
export const premiumRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  1000, // 1000 requests for premium users
  'Premium rate limit exceeded.'
);

/** GDPR data export: 1 request per user per 24 hours */
export const dataExportRateLimit = createRateLimit(
  24 * 60 * 60 * 1000,
  1,
  'You can export your data once every 24 hours. Please try again later.'
);

const publicReadMax =
  process.env.NODE_ENV === 'production'
    ? parseInt(process.env.PUBLIC_READ_RATE_LIMIT_MAX || '60', 10)
    : parseInt(process.env.PUBLIC_READ_RATE_LIMIT_MAX || '1000', 10);

const publicWriteMax =
  process.env.NODE_ENV === 'production'
    ? parseInt(process.env.PUBLIC_WRITE_RATE_LIMIT_MAX || '10', 10)
    : parseInt(process.env.PUBLIC_WRITE_RATE_LIMIT_MAX || '500', 10);

const apiKeyAuthMax =
  process.env.NODE_ENV === 'production'
    ? parseInt(process.env.API_KEY_AUTH_RATE_LIMIT_MAX || '20', 10)
    : parseInt(process.env.API_KEY_AUTH_RATE_LIMIT_MAX || '500', 10);

const authenticatedMax =
  process.env.NODE_ENV === 'production'
    ? parseInt(process.env.AUTHENTICATED_RATE_LIMIT_MAX || '300', 10)
    : parseInt(process.env.AUTHENTICATED_RATE_LIMIT_MAX || '10000', 10);

/** Stricter IP limit for anonymous public GET browse endpoints. */
export const publicReadRateLimit = createRateLimit(
  defaultWindowMs,
  publicReadMax,
  'Public read rate limit exceeded. Please try again later.'
);

/** Stricter IP limit for unauthenticated write endpoints. */
export const publicWriteRateLimit = createRateLimit(
  defaultWindowMs,
  publicWriteMax,
  'Public write rate limit exceeded. Please try again later.'
);

/** Rate limit failed API key authentication attempts by IP. */
export const apiKeyAuthRateLimit = createRateLimit(
  15 * 60 * 1000,
  apiKeyAuthMax,
  'Too many API key authentication attempts. Please try again later.'
);

/** Per-user limit applied after successful JWT/API-key auth (see authMiddleware). */
export const authenticatedRateLimit = createRateLimit(
  defaultWindowMs,
  authenticatedMax,
  'Authenticated API rate limit exceeded. Please slow down your requests.'
);

// Middleware to check if user is premium (placeholder)
export const checkPremiumAccess = (req: AuthenticatedRequest, res: Response, next: any) => {
  next();
};