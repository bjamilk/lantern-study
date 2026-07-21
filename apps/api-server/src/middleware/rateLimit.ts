import rateLimit, { ipKeyGenerator, Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../types';
import { getRedisClient, redisKey } from '../services/redisStore';
import { rateLimitErrorHandler } from './errorHandler';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../utils/authCookies';

type SendCommand = (...args: string[]) => Promise<unknown>;

let redisSendCommand: SendCommand | null = null;

const defaultWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function prodOrDev(prodValue: number, devValue: number): number {
  return isProduction() ? prodValue : devValue;
}

export function hasAuthCredential(req: Request): boolean {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return true;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim().length > 0) return true;
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies) {
    const access = cookies[ACCESS_COOKIE];
    const refresh = cookies[REFRESH_COOKIE];
    if (typeof access === 'string' && access.trim()) return true;
    if (typeof refresh === 'string' && refresh.trim()) return true;
  }
  return false;
}

export function resolveClientIp(req: Request): string {
  const ip =
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()) ||
    'anonymous';
  return ipKeyGenerator(ip);
}

function skipHealthPaths(req: Request): boolean {
  const path = req.path || '';
  return (
    path === '/health' ||
    path === '/ready' ||
    path === '/metrics' ||
    path === '/api/health'
  );
}

function buildStoreOptions(redisPrefix: string): Partial<Options> {
  if (!redisSendCommand) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RedisStore } = require('rate-limit-redis');
    return {
      store: new RedisStore({
        sendCommand: redisSendCommand,
        prefix: redisKey(`rl:${redisPrefix}:`),
      }),
    };
  } catch {
    console.warn('rate-limit-redis not available, using in-memory store');
    return {};
  }
}

interface CreateRateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  keyScope: 'ip' | 'user';
  redisPrefix: string;
  skip?: (req: Request) => boolean;
}

function createScopedRateLimit(config: CreateRateLimitConfig): RateLimitRequestHandler {
  return rateLimit({
    ...buildStoreOptions(config.redisPrefix),
    windowMs: config.windowMs,
    max: config.max,
    message: {
      error: 'Rate Limit Exceeded',
      message: config.message,
      retryAfter: Math.ceil(config.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next) => rateLimitErrorHandler(req, res, () => {}),
    keyGenerator: (req: Request) => {
      if (config.keyScope === 'user') {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (userId) return userId;
        return 'unauthenticated';
      }
      return resolveClientIp(req);
    },
    skip: (req: Request) => {
      if (skipHealthPaths(req)) return true;
      if (config.skip?.(req)) return true;
      if (config.keyScope === 'user' && !(req as AuthenticatedRequest).user?.id) {
        return true;
      }
      return false;
    },
  });
}

/** Initialize Redis-backed rate limit stores. Call once at startup before mounting limiters. */
export async function initializeRateLimitStores(): Promise<void> {
  const client = await getRedisClient();
  if (isProduction() && !client) {
    throw new Error('Redis is required for rate limiting in production (REDIS_ENABLED=true, REDIS_URL set)');
  }
  if (client) {
    redisSendCommand = (...args: string[]) => client.sendCommand(args);
  }
}

// --- Middleware (assigned after initializeRateLimitStores in production) ---

let _anonymousIpRateLimit: RateLimitRequestHandler | null = null;
let _publicReadRateLimit: RateLimitRequestHandler | null = null;
let _publicWriteRateLimit: RateLimitRequestHandler | null = null;
let _apiKeyAuthRateLimit: RateLimitRequestHandler | null = null;
let _authenticatedRateLimit: RateLimitRequestHandler | null = null;
let _aiPostBurstRateLimit: RateLimitRequestHandler | null = null;
let _uploadBurstRateLimit: RateLimitRequestHandler | null = null;
let _adminRateLimit: RateLimitRequestHandler | null = null;
let _dataExportRateLimit: RateLimitRequestHandler | null = null;
let _contactFormRateLimit: RateLimitRequestHandler | null = null;
let _searchRateLimit: RateLimitRequestHandler | null = null;
let _usernameCheckRateLimit: RateLimitRequestHandler | null = null;
let _collaboratorInviteRateLimit: RateLimitRequestHandler | null = null;
let _storageBurstRateLimit: RateLimitRequestHandler | null = null;
let _authLoginRateLimit: RateLimitRequestHandler | null = null;
let _authSessionRateLimit: RateLimitRequestHandler | null = null;

function buildAllLimiters(): void {
  const anonMax = parseInt(
    process.env.ANON_IP_RATE_LIMIT_MAX ||
      process.env.RATE_LIMIT_MAX_REQUESTS ||
      String(prodOrDev(300, 10000)),
    10
  );
  const publicReadMax = parseInt(
    process.env.PUBLIC_READ_RATE_LIMIT_MAX || String(prodOrDev(120, 1000)),
    10
  );
  const publicWriteMax = parseInt(
    process.env.PUBLIC_WRITE_RATE_LIMIT_MAX || String(prodOrDev(10, 500)),
    10
  );
  const apiKeyAuthMax = parseInt(
    process.env.API_KEY_AUTH_RATE_LIMIT_MAX || String(prodOrDev(20, 500)),
    10
  );
  const authenticatedMax = parseInt(
    process.env.AUTHENTICATED_RATE_LIMIT_MAX || String(prodOrDev(1200, 10000)),
    10
  );
  const aiPostBurstMax = parseInt(process.env.AI_POST_BURST_MAX || String(prodOrDev(15, 500)), 10);
  const uploadBurstMax = parseInt(process.env.UPLOAD_BURST_MAX || String(prodOrDev(10, 500)), 10);
  const adminMax = parseInt(process.env.ADMIN_RATE_LIMIT_MAX || String(prodOrDev(300, 10000)), 10);
  const authLoginMax = parseInt(
    process.env.AUTH_LOGIN_RATE_LIMIT_MAX || String(prodOrDev(10, 200)),
    10
  );
  const authSessionMax = parseInt(
    process.env.AUTH_SESSION_RATE_LIMIT_MAX || String(prodOrDev(30, 500)),
    10
  );
  const authWindowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);

  _authLoginRateLimit = rateLimit({
    ...buildStoreOptions('authlogin'),
    windowMs: authWindowMs,
    max: authLoginMax,
    message: {
      error: 'Rate Limit Exceeded',
      message: 'Too many login attempts. Please try again later.',
      retryAfter: Math.ceil(authWindowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next) => rateLimitErrorHandler(req, res, () => {}),
    keyGenerator: (req: Request) => {
      const ip = resolveClientIp(req);
      const email =
        typeof (req.body as { email?: unknown })?.email === 'string'
          ? (req.body as { email: string }).email.trim().toLowerCase()
          : '';
      return email ? `${ip}:${email}` : ip;
    },
    skip: (req) => skipHealthPaths(req) || req.method === 'OPTIONS',
  });

  _authSessionRateLimit = createScopedRateLimit({
    windowMs: authWindowMs,
    max: authSessionMax,
    message: 'Too many authentication requests. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'authsess',
  });

  _anonymousIpRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: anonMax,
    message: 'Too many unauthenticated requests from this IP. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'anon',
    skip: (req) => req.method === 'OPTIONS' || hasAuthCredential(req),
  });

  _publicReadRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: publicReadMax,
    message: 'Public read rate limit exceeded. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'pubread',
  });

  _publicWriteRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: publicWriteMax,
    message: 'Public write rate limit exceeded. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'pubwrite',
  });

  _apiKeyAuthRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: apiKeyAuthMax,
    message: 'Too many API key authentication attempts. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'apikeyfail',
  });

  _authenticatedRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: authenticatedMax,
    message: 'Authenticated API rate limit exceeded. Please slow down your requests.',
    keyScope: 'user',
    redisPrefix: 'auth',
  });

  _aiPostBurstRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: aiPostBurstMax,
    message: 'Too many AI requests. Please wait before trying again.',
    keyScope: 'user',
    redisPrefix: 'aipost',
  });

  _uploadBurstRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: uploadBurstMax,
    message: 'Too many uploads. Please wait before trying again.',
    keyScope: 'user',
    redisPrefix: 'upload',
  });

  const storageBurstMax = parseInt(process.env.STORAGE_BURST_MAX || String(prodOrDev(30, 500)), 10);
  _storageBurstRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: storageBurstMax,
    message: 'Too many storage requests. Please wait before trying again.',
    keyScope: 'user',
    redisPrefix: 'storage',
    skip: (req) => {
      if (skipHealthPaths(req)) return true;
      return !(req as AuthenticatedRequest).user?.id;
    },
  });

  _adminRateLimit = isProduction()
    ? createScopedRateLimit({
        windowMs: 60 * 1000,
        max: adminMax,
        message: 'Admin API rate limit exceeded. Please wait before trying again.',
        keyScope: 'user',
        redisPrefix: 'admin',
      })
    : ((_req: Request, _res: Response, next: NextFunction) => next()) as RateLimitRequestHandler;

  _dataExportRateLimit = createScopedRateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 1,
    message: 'You can export your data once every 24 hours. Please try again later.',
    keyScope: 'user',
    redisPrefix: 'export',
  });

  _contactFormRateLimit = createScopedRateLimit({
    windowMs: 60 * 60 * 1000,
    max: prodOrDev(5, 20),
    message: 'Too many contact requests. Please try again in an hour.',
    keyScope: 'ip',
    redisPrefix: 'contact',
  });

  _searchRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: prodOrDev(30, 200),
    message: 'Too many user searches. Please wait before trying again.',
    keyScope: 'user',
    redisPrefix: 'search',
  });

  _usernameCheckRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: prodOrDev(20, 100),
    message: 'Too many username checks. Please wait before trying again.',
    keyScope: 'ip',
    redisPrefix: 'unamechk',
  });

  _collaboratorInviteRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: prodOrDev(10, 60),
    message: 'Too many collaborator invites. Please wait before trying again.',
    keyScope: 'user',
    redisPrefix: 'collabinvite',
  });
}

buildAllLimiters();

function requireLimiter(
  limiter: RateLimitRequestHandler | null,
  name: string
): RateLimitRequestHandler {
  if (!limiter) {
    throw new Error(`Rate limiter ${name} not initialized`);
  }
  return limiter;
}

export const anonymousIpRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_anonymousIpRateLimit, 'anonymousIpRateLimit')(req, res, next);
};

export const publicReadRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_publicReadRateLimit, 'publicReadRateLimit')(req, res, next);
};

export const publicWriteRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_publicWriteRateLimit, 'publicWriteRateLimit')(req, res, next);
};

export const apiKeyAuthRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_apiKeyAuthRateLimit, 'apiKeyAuthRateLimit')(req, res, next);
};

export const authenticatedRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_authenticatedRateLimit, 'authenticatedRateLimit')(req, res, next);
};

export const aiPostBurstRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_aiPostBurstRateLimit, 'aiPostBurstRateLimit')(req, res, next);
};

export const uploadBurstRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_uploadBurstRateLimit, 'uploadBurstRateLimit')(req, res, next);
};

export const storageBurstRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_storageBurstRateLimit, 'storageBurstRateLimit')(req, res, next);
};

export const adminRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_adminRateLimit, 'adminRateLimit')(req, res, next);
};

export const dataExportRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_dataExportRateLimit, 'dataExportRateLimit')(req, res, next);
};

export const contactFormRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_contactFormRateLimit, 'contactFormRateLimit')(req, res, next);
};

export const searchRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_searchRateLimit, 'searchRateLimit')(req, res, next);
};

export const usernameCheckRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_usernameCheckRateLimit, 'usernameCheckRateLimit')(req, res, next);
};

export const collaboratorInviteRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_collaboratorInviteRateLimit, 'collaboratorInviteRateLimit')(req, res, next);
};

export const authLoginRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_authLoginRateLimit, 'authLoginRateLimit')(req, res, next);
};

export const authSessionRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_authSessionRateLimit, 'authSessionRateLimit')(req, res, next);
};
