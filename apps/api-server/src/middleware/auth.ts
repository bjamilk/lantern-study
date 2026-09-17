/**
 * Request authentication for the API server: resolves a credential into
 * `req.user`, then runs the per-account gates (revoked session, ban,
 * suspension, deactivation) before any route handler sees the request.
 *
 * Exports:
 * - `authMiddleware` — required auth. Mounted on every private router in
 *   server.ts. Accepts a Supabase JWT (Authorization: Bearer, or the access
 *   cookie) or an `X-API-Key` key; 401s when no credential resolves.
 * - `optionalAuthMiddleware` — best-effort auth for mixed public/private
 *   routes (marketplace, public profiles, campus pages). Populates `req.user`
 *   when a credential verifies and otherwise calls next() anonymously.
 * - `jwtOnlyAuthMiddleware` — same as `authMiddleware` but refuses API keys,
 *   so a key cannot mint sibling keys on the key-management routes.
 * - `requirePlatformAdmin` — the admin gate, mounted after `authMiddleware`.
 * - `requirePermission` / `requireWritePermission` — API-key scope checks.
 * - `initializeAuthMiddleware`, `evictAuthTokenCache`, `clearAuthTokenCache`,
 *   `rejectIfBanned` (tests) — lifecycle and cache control.
 * - `rejectIfBannedOnly` — the BAN half of `rejectIfBanned`, used by the
 *   session gates in routes/auth.ts: a temporary suspension must not end a
 *   session, only stop the requests the middleware answers.
 *
 * What it touches: Supabase auth (`verifySupabaseToken`), the `platform_admins`
 * table through `isLivePlatformAdmin`, account lifecycle and admin-audit rows
 * through `services/accountLifecycle` and `services/adminAudit`, the access
 * token cookie via `utils/authCookies`, the Redis-backed token denylist and
 * per-user session cutoff, and the rate limiters in `middleware/rateLimit`.
 *
 * Verified JWTs are memoised in a 20k-entry, 15-second LRU keyed by SHA-256 of
 * the token. The denylist, session-cutoff, ban and deactivation checks all run
 * on the cached path too, so a revocation takes effect immediately rather than
 * after the TTL.
 */
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { apiKeyService } from '../services/apiKey';
import type { DataLayer } from '../services/data';
import { getUserBlockState } from '../services/adminAudit';
import { suspensionMessage } from '@lantern/shared/moderation';
import {
  getAccountLifecycle,
  isAccountDeactivated,
  isDeactivatedLifecycleRoute,
} from '../services/accountLifecycle';
import {
  checkAccessTokenDenied,
  checkTokenIssuedBeforeUserCutoff,
} from '../services/tokenDenylist';
import { readAccessCookie } from '../utils/authCookies';
import { isLivePlatformAdmin } from '../utils/platformAdminAuth';
import { authenticatedRateLimit, apiKeyAuthRateLimit } from './rateLimit';
import { createRequestContext, type RequestContext } from '../services/dataLoaders';
import { AuthenticatedRequest } from '../types';

/**
 * The one handle this middleware holds, injected once by `server.ts`.
 *
 * FLIPPED (monolith lane M3, Phase B): it used to be TWO — the facade for
 * token verification and the ban lookup, plus the layer for the
 * deactivated-account read. Both reads are on the layer, so there is one
 * handle and one `null` check. It stays nullable because the middleware must
 * FAIL CLOSED before bootstrap has run: every gate below returns false (i.e.
 * "cannot confirm", never "allowed") while it is null, and the three suites
 * that inject a bare verifier stub rely on the same shape.
 */
let dataLayer: DataLayer | null = null;

interface CachedUser { id: string; [key: string]: any }
const tokenCache = new LRUCache<string, CachedUser>({
  max: 20_000,
  ttl: 15_000,
  updateAgeOnGet: true,
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ============ Credential extraction and post-auth gates ============

/**
 * Resolves the request credential in fixed precedence: `X-API-Key`, then an
 * `Authorization: Bearer` token, then the access cookie. Returns the raw
 * string; the caller decides whether it is an API key or a JWT.
 */
function extractAuthCredential(req: Request): string | null {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const cookieToken = readAccessCookie(cookies || {});
  if (cookieToken) return cookieToken;
  return null;
}

function attachUser(
  req: AuthenticatedRequest,
  user: { id: string; permissions: string[]; isAdmin?: boolean; credentialType: 'jwt' | 'api_key' }
): void {
  req.user = user;
}

/**
 * The one answer `optionalAuthMiddleware` gives when it cannot tell whether the
 * caller is signed in. `code` is what a client keys a retry on: this is not a
 * revoked session and must not send anyone back to sign-in.
 */
function respondAuthUnavailable(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'Service Unavailable',
    message: 'Could not verify your session right now. Please try again.',
    code: 'AUTH_TEMPORARILY_UNAVAILABLE',
  });
}

async function rejectIfDeactivated(
  userId: string,
  req: AuthenticatedRequest,
  res: Response
): Promise<boolean> {
  if (!dataLayer) return false;
  if (await isLivePlatformAdmin(userId)) return false;

  // Always allow sign-out so pause/delete flows can finish after deactivation.
  const path = (req.path || '').replace(/\/+$/, '') || '/';
  if (req.method === 'POST' && (path === '/logout' || path.endsWith('/logout'))) {
    return false;
  }

  if (isDeactivatedLifecycleRoute(req.method, path, userId)) return false;

  if (!dataLayer) return false;
  const row = await getAccountLifecycle(dataLayer, userId);
  if (!isAccountDeactivated(row)) return false;

  res.status(403).json({
    error: 'Forbidden',
    message:
      'Your account is paused and scheduled for deletion. Reactivate it from Settings or export your data before it is removed.',
    code: 'ACCOUNT_DEACTIVATED',
    deletionScheduledAt: row?.deletion_scheduled_at ?? null,
  });
  return true;
}

/**
 * The common tail of every successful authentication: enforce API-key write
 * scope, reject deactivated accounts, attach the per-request dataloader
 * context, then hand off to the authenticated rate limiter (which calls
 * `next()`).
 */
function proceedWithAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!enforceApiKeyMutationPolicy(req, res)) return;
  if (req.user?.id) {
    // This promise was floating with no catch: a lifecycle-lookup failure threw
    // an unhandled rejection and the request hung until the client timed out.
    void (async () => {
      if (await rejectIfDeactivated(req.user!.id, req, res)) return;
      if (req.user?.id) {
        (req as AuthenticatedRequest & { context?: RequestContext }).context = createRequestContext(
          req.user.id
        );
      }
      authenticatedRateLimit(req, res, next);
      // The `.catch` is the fix: without it a rejection here never reached the
      // error handler, so the route produced no response and no 5xx in the logs
      // — every authenticated request simply hung. Forwarding to next() turns
      // the same failure into a visible 500.
    })().catch((err) => {
      next(err as Error);
    });
    return;
  }
  authenticatedRateLimit(req, res, next);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** API keys with read-only scope cannot mutate resources. */
function enforceApiKeyMutationPolicy(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user?.credentialType !== 'api_key') return true;
  if (!MUTATING_METHODS.has(req.method)) return true;
  if (apiKeyService.hasPermission(req.user.permissions, 'write')) return true;
  res.status(403).json({
    error: 'Forbidden',
    message: "API key requires 'write' permission for this operation",
    code: 'API_KEY_WRITE_REQUIRED',
  });
  return false;
}

/**
 * Blocks banned and time-boxed suspended accounts. A ban answers
 * ACCOUNT_BANNED (the admin route also revoked the session); a suspension
 * (settings.suspended_until in the future — strikes or an admin "suspended"
 * status) answers ACCOUNT_SUSPENDED with the date and no global sign-out, so
 * the client can show the date and the account comes back by itself.
 * Exported for tests only.
 */
export async function rejectIfBanned(userId: string, res: Response): Promise<boolean> {
  if (!dataLayer) return false;
  const state = await getUserBlockState(dataLayer, userId);
  if (state.banned) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Your account has been suspended. Contact support if you believe this is an error.',
      code: 'ACCOUNT_BANNED',
    });
    return true;
  }
  if (state.suspendedUntil) {
    res.status(403).json({
      error: 'Forbidden',
      message: suspensionMessage(state.suspendedUntil),
      code: 'ACCOUNT_SUSPENDED',
      suspendedUntil: state.suspendedUntil,
    });
    return true;
  }
  return false;
}

/**
 * FIXED (F10, coordinator R1): the BAN half of `rejectIfBanned`, and nothing
 * else.
 *
 * The session gates in `routes/auth.ts` — `rejectRevokedSession` and the
 * `/login` check — are about whether a session may EXIST. A ban is permanent
 * and ends the session; a temporary suspension does not. Using the combined
 * gate there cleared a suspended student's cookies, 403'd `GET /session` and
 * refused `/login`, so the web client signed them out — and they never saw the
 * dated notice that is the whole point of a suspension
 * (`apps/web/src/services/accountSuspension.ts`). Suspension enforcement stays
 * where it belongs: the per-request middleware, which answers ACCOUNT_SUSPENDED
 * with the date on every route while the session lives on.
 */
export async function rejectIfBannedOnly(userId: string, res: Response): Promise<boolean> {
  if (!dataLayer) return false;
  const state = await getUserBlockState(dataLayer, userId);
  if (!state.banned) return false;
  res.status(403).json({
    error: 'Forbidden',
    message: 'Your account has been suspended. Contact support if you believe this is an error.',
    code: 'ACCOUNT_BANNED',
  });
  return true;
}

// ============ Wiring and cache control ============

/** Injects the data layer; called once from server bootstrap. Until it
 * runs, the lifecycle and ban gates no-op (they return false). */
export const initializeAuthMiddleware = (layer: DataLayer) => {
  dataLayer = layer;
};

export function evictAuthTokenCache(token: string): void {
  tokenCache.delete(hashToken(token));
}

/** Drop all cached JWT verifications (e.g. after platform-admin role changes). */
export function clearAuthTokenCache(): void {
  tokenCache.clear();
}

/**
 * FIXED (SW) [Sentry WEB-17]: both revocation gates fail CLOSED when Redis is
 * unreachable — correct, and unchanged — but they used to refuse with
 * `401 SESSION_REVOKED`, which is a TERMINAL code: the web client
 * (services/sessionHandler.ts) signs the user out on it without even trying to
 * refresh. One Redis blip therefore ended every live session on the platform,
 * which is what a burst of 401s across unrelated URLs (heartbeat first,
 * because it beats every two minutes) looked like in the breadcrumbs.
 *
 * `unavailable` now answers 503 AUTH_TEMPORARILY_UNAVAILABLE — the same code
 * `respondAuthUnavailable` already uses — so the request still fails, and the
 * client retries instead of throwing the session away.
 */
function respondRevoked(res: Response): void {
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Session has been revoked. Please sign in again.',
    code: 'SESSION_REVOKED',
  });
}

async function rejectIfSessionCutoff(
  token: string,
  userId: string,
  res: Response
): Promise<boolean> {
  const check = await checkTokenIssuedBeforeUserCutoff(token, userId);
  if (check === 'allowed') return false;
  if (check === 'unavailable') {
    respondAuthUnavailable(res);
    return true;
  }
  respondRevoked(res);
  return true;
}

async function rejectIfTokenDenied(token: string, res: Response): Promise<boolean> {
  const check = await checkAccessTokenDenied(token);
  if (check === 'allowed') return false;
  if (check === 'unavailable') {
    respondAuthUnavailable(res);
    return true;
  }
  respondRevoked(res);
  return true;
}

// ============ The middlewares ============

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
  if (await rejectIfTokenDenied(credential, res)) return;

  const cached = tokenCache.get(tokenKey);
  if (cached) {
    if (await rejectIfSessionCutoff(credential, cached.id, res)) return;
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

  if (dataLayer) {
    const supabaseResult = await dataLayer.client.verifySupabaseToken(credential);
    if (supabaseResult.isValid && supabaseResult.user) {
      if (await rejectIfSessionCutoff(credential, supabaseResult.user.id, res)) return;
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

/**
 * Required authentication. Contract: on success `req.user` carries
 * `{ id, permissions, isAdmin?, credentialType }` and `req.context` carries the
 * dataloader context; on failure it answers and never calls `next()`.
 *
 * Status codes: 401 for a missing, malformed, invalid or expired credential and
 * for a revoked session (`SESSION_REVOKED`); 403 for `ACCOUNT_BANNED`,
 * `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED` and `API_KEY_WRITE_REQUIRED`.
 * `isAdmin` here is only the JWT's claim and is advisory — `requirePlatformAdmin`
 * re-resolves it live and is the only thing that grants admin.
 */
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
    if (await rejectIfTokenDenied(credential, res)) return;

    const cached = tokenCache.get(tokenKey);
    if (cached) {
      if (await rejectIfSessionCutoff(credential, cached.id, res)) return;
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

    if (dataLayer) {
      const supabaseResult = await dataLayer.client.verifySupabaseToken(credential);
      if (supabaseResult.isValid && supabaseResult.user) {
        if (await rejectIfSessionCutoff(credential, supabaseResult.user.id, res)) return;
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

    // JWT session users are not scoped by API key permissions
    if (req.user.credentialType === 'jwt') {
      next();
      return;
    }

    if (!apiKeyService.hasPermission(req.user.permissions, requiredPermission)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Permission '${requiredPermission}' required`,
        code: 'API_KEY_PERMISSION_DENIED',
      });
      return;
    }

    next();
  };
};

/** Shorthand for mutating routes — enforces write scope on API keys. */
export const requireWritePermission = requirePermission('write');

/**
 * Best-effort authentication. Contract: a request with no credential, or with
 * one that does not verify, continues anonymously with `req.user` unset; a
 * credential that does verify gets the same `req.user` shape `authMiddleware`
 * attaches. Downstream gates (per-route ownership predicates) therefore have
 * to treat "no user" as public, not as an error.
 *
 * Unlike `authMiddleware` this path does NOT run the API-key write-scope check,
 * the session-cutoff check on the API-key branch, or the authenticated rate
 * limiter — anonymous callers stay on the anonymous IP bucket.
 */
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
        if (await rejectIfBanned(validation.userId, res)) return;
        attachUser(req, {
          id: validation.userId,
          permissions: validation.permissions || ['read'],
          credentialType: 'api_key',
        });
      }
      next();
      return;
    }

    // A POSITIVELY denied token is a revoked session, not an anonymous visitor.
    // Falling through to next() let a signed-out or force-revoked credential keep
    // reading every optional-auth route (including GET /auth/session) as "public".
    const denied = await checkAccessTokenDenied(credential);
    if (denied === 'unavailable') {
      // SW / WEB-17: "cannot verify" is not "revoked" — see respondRevoked.
      respondAuthUnavailable(res);
      return;
    }
    if (denied === 'denied') {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Session revoked. Please sign in again.',
        code: 'SESSION_REVOKED',
      });
      return;
    }

    if (dataLayer) {
      const supabaseResult = await dataLayer.client.verifySupabaseTokenDetailed(credential);
      // FIXED (F10): a verification that failed because Supabase was
      // unreachable is NOT an anonymous visitor. Continuing as anonymous here
      // is what made a signed-in buyer lose their own marketplace during a
      // blip, and made every optional-auth route serve the public view of the
      // caller's own data. A retryable 503 says what actually happened; a
      // genuinely bad token still falls through to anonymous, unchanged.
      if (!supabaseResult.isValid && supabaseResult.transient) {
        respondAuthUnavailable(res);
        return;
      }
      if (supabaseResult.isValid && supabaseResult.user) {
        const cutoff = await checkTokenIssuedBeforeUserCutoff(credential, supabaseResult.user.id);
        if (cutoff === 'unavailable') {
          respondAuthUnavailable(res);
          return;
        }
        if (cutoff === 'denied') {
          res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Session revoked. Please sign in again.',
            code: 'SESSION_REVOKED',
          });
          return;
        }
        if (await rejectIfBanned(supabaseResult.user.id, res)) return;
        if (await rejectIfDeactivated(supabaseResult.user.id, req, res)) return;
        attachUser(req, {
          id: supabaseResult.user.id,
          permissions: ['read', 'write'],
          isAdmin: supabaseResult.user.app_metadata?.is_platform_admin === true,
          credentialType: 'jwt',
        });
      }
    }

    next();
    // FIXED (F10): nothing on the path above throws for a BAD credential —
    // `verifySupabaseTokenDetailed` returns its outcome, the denylist fails
    // closed with a boolean, and the ban/deactivation gates answer on `res`.
    // A throw reaching here is therefore an infrastructure failure, and
    // answering it as "anonymous visitor" is the same lie the transient branch
    // above used to tell. 503 with a retryable code instead.
  } catch (error) {
    console.warn('Optional auth error:', error);
    respondAuthUnavailable(res);
  }
};

/**
 * The admin gate. Mount after `authMiddleware`; answers 401 without a user and
 * 403 without platform-admin rights.
 *
 * Admin is a LIVE lookup against `platform_admins` on every request, never a
 * JWT claim. That is deliberate: a claim is fixed for the life of the token, so
 * a revoked admin would keep admin until it expired, and the 15-second token
 * cache would serve the stale claim as well. The live answer is written back
 * onto `req.user.isAdmin` so handlers read the same value the gate used.
 */
export const requirePlatformAdmin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // SEC-09: Never trust JWT/app_metadata isAdmin from the token cache.
  // Always resolve against platform_admins (live), then mirror onto req.user.
  const isAdmin = await isLivePlatformAdmin(req.user.id);
  req.user.isAdmin = isAdmin;
  if (!isAdmin) {
    res.status(403).json({ success: false, error: 'Platform admin access required' });
    return;
  }

  next();
};

// Legacy export kept for compatibility
export const authenticateApiKey = authMiddleware;

// ============ Legacy helpers ============

// FIXED (F7b): a second `errorHandler` used to live here and disagreed with the
// global one in `middleware/errorHandler.ts` — it answered PGRST116 with 400
// "Database relationship error" where the global `supabaseErrorHandler` answers
// 404 "Resource not found". It had no importer (server.ts has always mounted the
// errorHandler.ts one), so it was a trap waiting for someone to wire it up:
// deleted, leaving exactly one error-mapping policy for the API.

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
