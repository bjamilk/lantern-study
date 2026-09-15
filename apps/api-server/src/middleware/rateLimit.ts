/**
 * Every non-AI rate limiter in the API, built on express-rate-limit and backed by
 * Redis in production. AI credit accounting lives separately in `aiRateLimit.ts`.
 *
 * Exports
 * - `initializeRateLimitStores()` — called once by `server.ts` during startup.
 * - One `RequestHandler` per tier, mounted by `server.ts` (`anonymousIpRateLimit`,
 *   `adminRateLimit`) and by individual routers (`authLoginRateLimit`,
 *   `authSessionRateLimit`, `aiPostBurstRateLimit`, `uploadBurstRateLimit`, ...).
 * - Helpers other middleware reuse: `hasAuthCredential` (also used by `csrf.ts`),
 *   `resolveClientIp`, `normalizedLoginEmail`, `isWebhookRateLimitExempt`
 *   (used at the `server.ts` mount), `getLimiterStoreKind` and
 *   `authSessionBucketKey` (test assertion hooks).
 *
 * What it touches
 * - Redis only. No database, no external API. Each limiter owns one key prefix
 *   `redisKey("rl:<prefix>:")`, so a counter key is
 *   `<redisKey namespace>rl:<prefix>:<bucket key>` where the bucket key is the
 *   client IP (`keyScope: 'ip'`), the authenticated user id (`keyScope: 'user'`),
 *   or a composite for login. Prefixes in use: `anon`, `pubread`, `pubwrite`,
 *   `apikeyfail`, `auth`, `aipost`, `upload`, `storage`, `admin`, `export`,
 *   `contact`, `search`, `unamechk`, `collabinvite`, `prodevents`, `authlogin`,
 *   `authloginip`, `authloginemail`, `authsess`, `authsessip`.
 * - Reads the auth cookies `ACCESS_COOKIE` / `REFRESH_COOKIE` to decide whether a
 *   request counts as anonymous.
 *
 * Tiers and production budgets (dev budgets in parentheses; every value is
 * overridable by the environment variable named beside it)
 * - `anonymousIpRateLimit`  300/15min per IP   (10000) ANON_IP_RATE_LIMIT_MAX
 * - `publicReadRateLimit`   120/15min per IP   (1000)  PUBLIC_READ_RATE_LIMIT_MAX
 * - `publicWriteRateLimit`   10/15min per IP   (500)   PUBLIC_WRITE_RATE_LIMIT_MAX
 * - `apiKeyAuthRateLimit`    20/15min per IP   (500)   API_KEY_AUTH_RATE_LIMIT_MAX
 * - `authenticatedRateLimit` 1200/15min per user (10000) AUTHENTICATED_RATE_LIMIT_MAX
 * - `aiPostBurstRateLimit`    15/min per user  (500)   AI_POST_BURST_MAX
 * - `uploadBurstRateLimit`    10/min per user  (500)   UPLOAD_BURST_MAX
 * - `storageBurstRateLimit`   30/min per user  (500)   STORAGE_BURST_MAX
 * - `adminRateLimit`         300/min per user  (no-op outside production) ADMIN_RATE_LIMIT_MAX
 * - `dataExportRateLimit`      1/24h per user
 * - `contactFormRateLimit`     5/h per IP      (20)
 * - `searchRateLimit`         30/min per user  (200)
 * - `usernameCheckRateLimit`  20/min per IP    (100)
 * - `collaboratorInviteRateLimit` 10/min per user (60)
 * - `analyticsEventsRateLimit`   60/min per IP (500)
 * - `authLoginRateLimit` chains three counters over the 15min AUTH window:
 *   30/IP (AUTH_LOGIN_IP_RATE_LIMIT_MAX), 10/email (AUTH_LOGIN_EMAIL_RATE_LIMIT_MAX),
 *   10/ip:email (AUTH_LOGIN_RATE_LIMIT_MAX).
 * - `authSessionRateLimit` chains two counters over the 15min AUTH window:
 *   1200/IP (AUTH_SESSION_IP_RATE_LIMIT_MAX) and 30/session
 *   (AUTH_SESSION_RATE_LIMIT_MAX), where a session is the unverified `sub`
 *   claim of the presented token.
 *
 * Boot sequence — read this before moving anything
 * `buildAllLimiters()` runs at module import AND again inside
 * `initializeRateLimitStores()`. The import-time pass happens before
 * `redisSendCommand` is set, so `buildStoreOptions()` returns `{}` and every
 * limiter holds express-rate-limit's default in-memory store. That used to be the
 * final state: counters were per-process on multi-instance Render and reset on
 * every restart and deploy, while the "Redis is required for rate limiting in
 * production" guard still read as satisfied because it only checks that a client
 * connected. `initializeRateLimitStores()` now calls `buildAllLimiters()` after
 * setting the send command, so the exported handlers resolve the rebuilt,
 * Redis-backed limiters through `requireLimiter()` at request time.
 * `getLimiterStoreKind()` exists so tests can assert the rebuild happened.
 */
import rateLimit, { ipKeyGenerator, Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../types';
import { getRedisClient, redisKey } from '../services/redisStore';
import { rateLimitErrorHandler } from './errorHandler';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../utils/authCookies';

// --- Module state and budget helpers ---
// `redisSendCommand` stays null until initializeRateLimitStores() runs; every
// limiter built before that point holds an in-memory store (see the boot
// sequence in the file header).
type SendCommand = (...args: string[]) => Promise<unknown>;

let redisSendCommand: SendCommand | null = null;

const defaultWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function prodOrDev(prodValue: number, devValue: number): number {
  return isProduction() ? prodValue : devValue;
}

// --- Request classification: who is this, and does the request count? ---

/**
 * Reports whether the request carries any credential at all — `x-api-key`, an
 * `Authorization` header, or either auth cookie. The value is never validated:
 * this only decides which bucket a request falls into (and, in `csrf.ts`, which
 * branch of the CSRF check applies). A bogus bearer token is enough to leave the
 * anonymous bucket, so the tiers below the anonymous one carry the real enforcement.
 */
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

// Correctness here depends on `trust proxy` being set to the real hop count for
// the deployment; an over-permissive setting reintroduces attacker control over
// `req.ip`. Treat IP keying as defence-in-depth — a determined attacker rotates
// addresses, so per-user and per-account counters do the load-bearing work.
/**
 * Trust ONLY what Express derived from the configured `trust proxy` setting.
 * The old raw X-Forwarded-For fallback let any client mint an arbitrary rate
 * limit key by sending its own XFF header, making every IP limiter bypassable.
 */
export function resolveClientIp(req: Request): string {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'anonymous';
  return ipKeyGenerator(ip);
}

/**
 * The bucket key for the session-auth tier: one bucket per SESSION rather than
 * one per network.
 *
 * The id is the `sub` claim of whichever token the request presents — bearer
 * header, access cookie, or refresh cookie — read by decoding the payload and
 * NOT by verifying the signature. Verifying here would mean a Supabase round
 * trip before the rate limiter, on the exact routes a flood would target.
 *
 * The claim is therefore attacker-controlled, which is why `authSessionRateLimit`
 * runs a per-IP counter in front of this one. A request with no readable claim
 * falls back to the IP, so an unparseable credential cannot mint a fresh bucket
 * by being malformed.
 */
export function authSessionBucketKey(req: Request): string {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {};
  const authHeader = req.headers.authorization;
  const bearer =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
  const token = bearer || cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE] || '';
  const subject = unverifiedJwtSubject(token);
  return subject ? `sub:${subject}` : resolveClientIp(req);
}

/** The `sub` claim of a JWT, or '' for anything that is not a readable JWT. */
function unverifiedJwtSubject(token: string): string {
  if (!token || token.length > 4096) return '';
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const sub = (payload as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 && sub.length <= 128 ? sub : '';
  } catch {
    return '';
  }
}

/** Fold case and trim so `A@x.com` and `a@x.com ` share one login bucket. */
export function normalizedLoginEmail(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Paystack webhooks carry no credential, so they landed in the anonymous
 * 300/15min-per-IP bucket. Paystack retries a failed delivery from a small,
 * shared IP pool — a busy hour could rate-limit the payment provider out of
 * telling us a student paid. The route's signature check is the real gate.
 */
export function isWebhookRateLimitExempt(pathname: string): boolean {
  const path = (pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/webhooks/paystack' || path === '/api/v1/webhooks/paystack';
}

/** Liveness and metrics endpoints are never counted, in any tier. */
function skipHealthPaths(req: Request): boolean {
  const path = req.path || '';
  return (
    path === '/health' ||
    path === '/ready' ||
    path === '/metrics' ||
    path === '/api/health'
  );
}

/**
 * Which store each limiter actually got, keyed by redis prefix. express-rate-limit
 * does not expose the store on the returned handler, so this is the only way to
 * assert that limiters were rebuilt with the Redis store after startup.
 */
const storeKindByPrefix = new Map<string, 'redis' | 'memory'>();

export function getLimiterStoreKind(redisPrefix: string): 'redis' | 'memory' | undefined {
  return storeKindByPrefix.get(redisPrefix);
}

function buildStoreOptions(redisPrefix: string): Partial<Options> {
  if (!redisSendCommand) {
    storeKindByPrefix.set(redisPrefix, 'memory');
    return {};
  }
  try {

    const { RedisStore } = require('rate-limit-redis');
    const store = new RedisStore({
      sendCommand: redisSendCommand,
      prefix: redisKey(`rl:${redisPrefix}:`),
    });
    storeKindByPrefix.set(redisPrefix, 'redis');
    return { store };
  } catch {
    console.warn('rate-limit-redis not available, using in-memory store');
    storeKindByPrefix.set(redisPrefix, 'memory');
    return {};
  }
}

// --- Limiter factory ---
// One shared shape for every tier: a Redis store under `rl:<redisPrefix>:`, a
// JSON 429 body rendered by `rateLimitErrorHandler`, standard RateLimit headers,
// and a key that is either the client IP or the authenticated user id.
// A `keyScope: 'user'` limiter skips unauthenticated requests entirely rather
// than sharing one `unauthenticated` bucket, because those requests are already
// counted by the anonymous IP tier.
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
  // buildAllLimiters() also runs at import time, BEFORE redisSendCommand is set,
  // so every limiter was silently holding an in-memory store in production while
  // the "Redis is required" guard above passed. Rebuild now that the store exists.
  buildAllLimiters();
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
let _authLoginIpRateLimit: RateLimitRequestHandler | null = null;
let _authLoginEmailRateLimit: RateLimitRequestHandler | null = null;
let _authSessionRateLimit: RateLimitRequestHandler | null = null;
let _authSessionIpRateLimit: RateLimitRequestHandler | null = null;
let _analyticsEventsRateLimit: RateLimitRequestHandler | null = null;

/**
 * Builds every limiter into the module-level slots above. Runs twice: once at
 * import (in-memory stores) and once from `initializeRateLimitStores()` after the
 * Redis send-command is wired, which is the instance the exported handlers serve.
 * Budgets are read here rather than at module load, so the second pass picks up
 * the same environment values.
 */
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
  // Forty sessions' worth. Deliberately generous: this counter is not the
  // enforcement — the per-session tier is — it only has to stop ONE network
  // from being unbounded now that the session key is attacker-controlled. A
  // lecture hall's worth of app boots and hourly refreshes must fit inside it,
  // because a 429 here is the self-DoS the old IP-only limiter caused.
  const authSessionIpMax = parseInt(
    process.env.AUTH_SESSION_IP_RATE_LIMIT_MAX || String(prodOrDev(1200, 5000)),
    10
  );
  const authWindowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);

  // --- Login limiters ---
  // Three independent counters, all chained by the exported `authLoginRateLimit`:
  // per IP (`authloginip`), per account (`authloginemail`), and the original
  // ip:email composite (`authlogin`). The composite alone bounded only vertical
  // brute force; horizontal credential stuffing — one password against many
  // accounts from one address — minted a fresh bucket per email and was capped
  // only by the anonymous tier. The per-IP counter closes that, and the per-email
  // counter caps a distributed attack on a single account. There is still no
  // CAPTCHA and no account lockout: these counters are the whole defence, and an
  // attacker who rotates both address and target account is limited only by them.
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
      const email = normalizedLoginEmail(req);
      return email ? `${ip}:${email}` : ip;
    },
    skip: (req) => skipHealthPaths(req) || req.method === 'OPTIONS',
  });

  // The ip:email composite above is trivially evaded: an attacker spraying one
  // password across many accounts, or rotating the email casing/plus-tags, gets
  // a fresh bucket every request. These two independent counters close that —
  // one caps total login attempts from an IP, one caps attempts per account.
  const authLoginIpMax = parseInt(
    process.env.AUTH_LOGIN_IP_RATE_LIMIT_MAX || String(prodOrDev(30, 500)),
    10
  );
  const authLoginEmailMax = parseInt(
    process.env.AUTH_LOGIN_EMAIL_RATE_LIMIT_MAX || String(prodOrDev(10, 200)),
    10
  );

  _authLoginIpRateLimit = createScopedRateLimit({
    windowMs: authWindowMs,
    max: authLoginIpMax,
    message: 'Too many login attempts from this network. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'authloginip',
    skip: (req) => req.method === 'OPTIONS',
  });

  _authLoginEmailRateLimit = rateLimit({
    ...buildStoreOptions('authloginemail'),
    windowMs: authWindowMs,
    max: authLoginEmailMax,
    message: {
      error: 'Rate Limit Exceeded',
      message: 'Too many login attempts for this account. Please try again later.',
      retryAfter: Math.ceil(authWindowMs / 1000),
    },
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res, _next) => rateLimitErrorHandler(req, res, () => {}),
    keyGenerator: (req: Request) => normalizedLoginEmail(req) || 'no-email',
    skip: (req) =>
      skipHealthPaths(req) || req.method === 'OPTIONS' || !normalizedLoginEmail(req),
  });

  // Covers POST /auth/exchange, POST /auth/refresh, GET /auth/session and
  // POST /auth/revoke-other-sessions.
  //
  // FIXED (F10): this was a single IP-only counter, so every student behind one
  // campus NAT or one mobile carrier gateway shared a single 30-per-15-minutes
  // budget — normal token refresh from a lecture hall exhausted it and signed
  // the room out. It is now the same two-counter chain `authLoginRateLimit`
  // uses: a per-SESSION counter at the old budget, plus a wider per-IP counter
  // so one network cannot be unbounded.
  //
  // The session key is the `sub` claim read from the presented token WITHOUT
  // verifying it. That is deliberate and is why the per-IP counter exists: an
  // unverified claim is attacker-controlled, so on its own it would be a free
  // bypass (these requests carry a credential and therefore skip the anonymous
  // IP tier entirely). Rotating the claim now buys an attacker nothing beyond
  // the per-IP budget, while a real lecture hall — many subs, one IP — gets a
  // budget each.
  _authSessionRateLimit = rateLimit({
    ...buildStoreOptions('authsess'),
    windowMs: authWindowMs,
    max: authSessionMax,
    message: {
      error: 'Rate Limit Exceeded',
      message: 'Too many authentication requests. Please try again later.',
      retryAfter: Math.ceil(authWindowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next) => rateLimitErrorHandler(req, res, () => {}),
    keyGenerator: (req: Request) => authSessionBucketKey(req),
    skip: (req) => skipHealthPaths(req) || req.method === 'OPTIONS',
  });

  _authSessionIpRateLimit = createScopedRateLimit({
    windowMs: authWindowMs,
    max: authSessionIpMax,
    message: 'Too many authentication requests from this network. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'authsessip',
    skip: (req) => req.method === 'OPTIONS',
  });

  // The outermost tier: `server.ts` mounts it ahead of every router. Its `skip`
  // exempts CORS preflights (OPTIONS carries no credential and would otherwise
  // double-charge each real request) and any request carrying a credential, which
  // hands those over to the per-user tiers. A forged credential therefore also
  // escapes this bucket — see `hasAuthCredential`.
  // The Paystack webhook carries no credential and would land here, so it is not
  // exempted by this `skip` at all; `server.ts` short-circuits it by path with
  // `isWebhookRateLimitExempt()` before calling this limiter. Renaming or
  // remounting the webhook route without updating that predicate puts the payment
  // provider's retries back into a 300-per-15-minutes shared-IP bucket.
  _anonymousIpRateLimit = createScopedRateLimit({
    windowMs: defaultWindowMs,
    max: anonMax,
    message: 'Too many unauthenticated requests from this IP. Please try again later.',
    keyScope: 'ip',
    redisPrefix: 'anon',
    skip: (req) => req.method === 'OPTIONS' || hasAuthCredential(req),
  });

  // --- Per-route tiers: public surfaces, then authenticated and burst budgets ---
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

  // Admin traffic is unlimited outside production so local tooling and seed
  // scripts are not throttled; the slot holds a pass-through handler there.
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

  _analyticsEventsRateLimit = createScopedRateLimit({
    windowMs: 60 * 1000,
    max: prodOrDev(60, 500),
    message: 'Too many analytics requests. Please wait before trying again.',
    keyScope: 'ip',
    redisPrefix: 'prodevents',
  });
}

// Import-time pass. Stores are in-memory here; `initializeRateLimitStores()`
// rebuilds everything once Redis is wired. Kept so that tests and any code path
// that imports a limiter without running startup still gets a working handler.
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

// --- Exported handlers ---
// Each export is a thin wrapper that resolves its limiter through
// `requireLimiter()` on every request, not at import. That late binding is what
// makes the post-Redis rebuild visible to routes that captured the export at
// module load; never replace a wrapper with a direct reference to the slot.

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

/**
 * Runs the three login counters in series: per IP, then per account, then the
 * ip:email composite. The first to trip answers 429 and the later ones are never
 * charged, so the effective budget is the tightest applicable counter.
 * Requires `express.json()` to have parsed the body already — the per-email keys
 * come from `req.body.email`.
 */
export const authLoginRateLimit: RequestHandler = (req, res, next) => {
  const ipLimiter = requireLimiter(_authLoginIpRateLimit, 'authLoginIpRateLimit');
  const emailLimiter = requireLimiter(_authLoginEmailRateLimit, 'authLoginEmailRateLimit');
  const composite = requireLimiter(_authLoginRateLimit, 'authLoginRateLimit');
  void ipLimiter(req, res, () => {
    void emailLimiter(req, res, () => {
      void composite(req, res, next);
    });
  });
};

/**
 * Per-IP first, then per-session: the first to trip answers 429, so the
 * effective budget is the tighter of the two. See the comment at the limiters.
 */
export const authSessionRateLimit: RequestHandler = (req, res, next) => {
  const ipLimiter = requireLimiter(_authSessionIpRateLimit, 'authSessionIpRateLimit');
  const sessionLimiter = requireLimiter(_authSessionRateLimit, 'authSessionRateLimit');
  void ipLimiter(req, res, () => {
    void sessionLimiter(req, res, next);
  });
};

export const analyticsEventsRateLimit: RequestHandler = (req, res, next) => {
  void requireLimiter(_analyticsEventsRateLimit, 'analyticsEventsRateLimit')(req, res, next);
};
