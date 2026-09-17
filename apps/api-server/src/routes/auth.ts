/**
 * Cookie-backed authentication routes.
 *
 * Purpose
 * - Owns the browser session: turns Supabase GoTrue credentials into HttpOnly
 *   cookies, refreshes them, reports the current session, and revokes sessions
 *   server-side. Mobile clients keep using bearer tokens; these routes serve
 *   both because every reader accepts either a `Bearer` header or the cookie.
 *
 * Mount path
 * - `/api/v1/auth` (`server.ts`). No prefix nesting.
 *
 * Auth mode, per route
 * - `POST /login`, `POST /exchange`, `POST /refresh` — public. The credential
 *   in the body or the refresh cookie IS the authentication.
 * - `GET /session` — `optionalAuthMiddleware`, then the handler re-verifies the
 *   token itself and falls back to the refresh cookie.
 * - `POST /logout`, `POST /revoke-other-sessions` — `authMiddleware`.
 *
 * Rate-limit tier
 * - `authLoginRateLimit` on `/login` (IP + email composite buckets).
 * - `authSessionRateLimit` on `/exchange`, `/refresh`, `/session` and
 *   `/revoke-other-sessions`. `/logout` inherits `authenticatedRateLimit` from
 *   `authMiddleware`.
 *
 * Ownership predicate
 * - `requireAuthUserId(req, res)` on the authenticated routes: the user id comes
 *   from the verified token, never from the body. On `/exchange` the pattern is
 *   an equality check instead — the verified token's `user.id` must equal the
 *   `user.id` the client claims, and the redeemed refresh token's user must
 *   equal it too.
 *
 * Error-mapping convention
 * - 400 for a missing or malformed body. 401 for every credential failure, with
 *   `code: 'SESSION_REVOKED'` whenever the client should stop retrying and send
 *   the user back to sign-in. Cookies are cleared on the same response that
 *   returns `SESSION_REVOKED`, never on a routine expired-access-token path.
 * - 403 `ACCOUNT_BANNED` when the revocation gate rejects a session for a banned
 *   account. NOT `ACCOUNT_SUSPENDED`: a temporary suspension never ends the
 *   session here — the per-request auth middleware answers it with the date, and
 *   the client keeps the session so the student can read that notice.
 *
 * The revocation gate
 * - Every path that mints or confirms a session — `/login` (ban only),
 *   `/exchange` (both branches), `/refresh` and both refresh-token fallbacks
 *   inside `/session` — runs `rejectRevokedSession`, so a ban or an admin
 *   forced sign-out cannot be outlived by a still-valid refresh cookie. The
 *   `/session` fallbacks used to skip it, which made `GET /session` a way to
 *   keep minting access tokens after either revocation.
 * - Refresh-token REUSE is GoTrue's job, not this file's: rotation is on and
 *   the reuse interval is 10s (`supabase/config.toml`), so redeeming a token
 *   twice revokes the family. `/refresh` logs the reuse error codes at error
 *   level so the event is alarmable — see `isRefreshTokenReuse`.
 *
 * What it touches
 * - Supabase GoTrue through a short-lived anon client (`getAnonAuthClient`) for
 *   password sign-in and refresh, and the service-role admin API for global
 *   sign-out.
 * - Cookies `lantern_access` (path `/`) and `lantern_refresh` (path
 *   `/api/v1/auth`) — see `utils/authCookies.ts`.
 * - Redis, through `services/tokenDenylist` (`denylistAccessToken`,
 *   `setUserSessionCutoff`) and `CacheService.invalidateUserCache`.
 *
 * The cookie-session model
 * - The refresh token NEVER reaches the browser as JSON: `serializeClientSession`
 *   omits it unconditionally, and the access token only appears when a caller
 *   explicitly asks for `includeAccessToken`. Both cookies are `httpOnly`,
 *   `secure` in production, and the refresh cookie is scoped to
 *   `/api/v1/auth` so it is not attached to ordinary API traffic.
 */
import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, evictAuthTokenCache, optionalAuthMiddleware, rejectIfBannedOnly } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { denylistAccessToken, setUserSessionCutoff, isTokenIssuedBeforeUserCutoff } from '../services/tokenDenylist';
import type { DataLayer } from '../services/data';
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

let dataLayer: DataLayer;
let cacheService: CacheService;

export function initializeAuthRoutes(layer: DataLayer, cache: CacheService): void {
  dataLayer = layer;
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

/**
 * Does this GoTrue refresh failure mean the token had already been redeemed?
 *
 * GoTrue answers a reused refresh token with `refresh_token_already_used` or,
 * once the family has been revoked, `refresh_token_not_found`; older releases
 * carry the same fact only in the message ("Invalid Refresh Token: Already
 * Used"), so both are checked. Everything else — an expired token, a network
 * failure — is an ordinary sign-in-again, not a theft signal.
 */
function isRefreshTokenReuse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (code === 'refresh_token_already_used' || code === 'refresh_token_not_found') return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /already used|refresh token not found/i.test(message);
}

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user: unknown;
};

// ---------------------------------------------------------------------------
// Session serialization and cookie writing
// ---------------------------------------------------------------------------
// Every route that establishes or renews a session funnels through
// `applySessionCookies`, so the cookie attributes and the "refresh token never
// leaves the server" rule are enforced in exactly one place.

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

/**
 * The revocation gate every session-minting path must pass.
 *
 * `/refresh` grew this check first; the `/session` refresh-token fallbacks did
 * not have it, so a banned user — or one whose sessions an admin had force
 * revoked — could keep minting fresh access cookies by calling `/session`
 * instead of `/refresh`. Both routes (and `/exchange`, which also redeems a
 * refresh token) now funnel through here so there is one gate, not three
 * copies that can drift apart.
 *
 * Returns true when the caller must stop: the 401/403 body and the
 * cookie-clearing headers have already been written to `res`.
 *
 * `rejectIfBannedOnly` writes its own 403, so its response is captured rather
 * than sent directly — Express cannot append a `Set-Cookie` header after the
 * body has gone out, and the cookies must be cleared on the same response.
 *
 * FIXED (F10, coordinator R1): this gate asks about BANS only. It used to call
 * `rejectIfBanned`, which also fires on a temporary suspension — so a suspended
 * student had their cookies cleared and was signed out by the web client,
 * instead of staying signed in to read the dated notice
 * (`apps/web/src/services/sessionHandler.ts`). A suspension is enforced on
 * every request by the auth middleware, which answers ACCOUNT_SUSPENDED with
 * the date; it must not also end the session.
 */
async function rejectRevokedSession(
  userId: string | undefined,
  accessToken: string,
  res: Response
): Promise<boolean> {
  if (!userId) return false;

  let banStatus = 0;
  let banBody: unknown = null;
  const capture = {
    status(code: number) {
      banStatus = code;
      return capture;
    },
    json(payload: unknown) {
      banBody = payload;
      return capture;
    },
  } as unknown as Response;

  if (await rejectIfBannedOnly(userId, capture)) {
    clearAuthCookies(res);
    res.status(banStatus || 403).json(
      banBody ?? {
        success: false,
        error: 'Your account has been suspended.',
        code: 'ACCOUNT_BANNED',
      }
    );
    return true;
  }

  if (await isTokenIssuedBeforeUserCutoff(accessToken, userId)) {
    clearAuthCookies(res);
    res.status(401).json({ success: false, error: 'Session expired', code: 'SESSION_REVOKED' });
    return true;
  }

  return false;
}

async function applySessionCookies(res: Response, session: SessionPayload) {
  const expiresIn = session.expires_in ?? Math.max(60, (session.expires_at ?? 0) - Math.floor(Date.now() / 1000));
  setAuthCookies(res, session.access_token, session.refresh_token, expiresIn);
  return serializeClientSession(session);
}

// ---------------------------------------------------------------------------
// Establishing a session — password sign-in and OAuth/magic-link exchange
// ---------------------------------------------------------------------------

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

    // FIXED (F10, coordinator R1): `rejectIfBannedOnly`, not `rejectIfBanned`.
    // The combined gate also fires on a temporary suspension, so a suspended
    // student was refused at sign-in and could never reach the dated notice the
    // product shows them. Suspension is enforced per request by the middleware,
    // which answers ACCOUNT_SUSPENDED with the date; only a BAN may stop a
    // session from being created.
    // Ban only, deliberately without the cutoff check: this token was minted
    // one instant ago, and a cutoff stamped in the same second as the sign-in
    // (logout immediately followed by login) would reject a session the user
    // just legitimately created. A banned user used to receive working cookies
    // here and then hit 403 on every subsequent request; fail honestly instead.
    const signedInUserId = data.session.user?.id ?? data.user?.id;
    if (signedInUserId && (await rejectIfBannedOnly(signedInUserId, res))) return;

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

    // Do not remove this guard. Without it the placeholder reached GoTrue as a
    // refresh token, GoTrue answered 400, and supabase-js turned that 400 into
    // a SIGNED_OUT event — the random-sign-out incident. The guard exists on
    // both halves (client and server); removing either one brings it back.
    // 'cookie-managed' is the client-side placeholder for "the real refresh
    // token lives in the HttpOnly cookie, I never saw it". Writing it into the
    // refresh cookie would replace the real token with a literal placeholder
    // string, silently destroying the session's ability to refresh — the
    // client's SIGNED_IN handler used to do exactly that after every cookie
    // restore. Treat it as "cookies already correct": succeed without writing.
    if (refresh_token === 'cookie-managed') {
      const verified = await dataLayer.client.verifySupabaseToken(access_token);
      if (!verified.isValid || !verified.user || verified.user.id !== user.id) {
        return res.status(401).json({ success: false, error: 'Invalid access token' });
      }
      // Confirming a cookie session is still a session decision: a banned user
      // or a token stamped before the user's cutoff must not be told it holds a
      // good session.
      if (await rejectRevokedSession(user.id, access_token, res)) return;
      return res.json({
        success: true,
        data: {
          session: serializeClientSession({ access_token, refresh_token: '', expires_in, expires_at, token_type, user }),
          user,
        },
      });
    }

    const verified = await dataLayer.client.verifySupabaseToken(access_token);
    if (!verified.isValid || !verified.user || verified.user.id !== user.id) {
      return res.status(401).json({ success: false, error: 'Invalid access token' });
    }

    // The refresh token was previously written into the HttpOnly cookie with no
    // verification at all — an attacker could pair a valid access token with a
    // refresh token of their choosing and pin the victim's browser to a session
    // they control. Redeem it at GoTrue and confirm it belongs to the same user;
    // the rotated session GoTrue returns is what we store.
    const exchangeClient = getAnonAuthClient();
    const { data: refreshed, error: refreshError } = await exchangeClient.auth.refreshSession({
      refresh_token,
    });
    if (refreshError || !refreshed.session || refreshed.session.user?.id !== user.id) {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }

    // Redeeming a refresh token here mints exactly what `/refresh` mints, so it
    // passes the same revocation gate.
    if (await rejectRevokedSession(user.id, refreshed.session.access_token, res)) return;

    const session = await applySessionCookies(res, refreshed.session as SessionPayload);
    res.json({ success: true, data: { session, user: refreshed.session.user ?? user } });
  })
);

// ---------------------------------------------------------------------------
// Reading and renewing a session
// ---------------------------------------------------------------------------
// Both routes treat an expired access token as routine and reach for the
// refresh cookie before failing. Only a refresh that GoTrue itself rejects, or
// one that trips the ban/cutoff checks, clears the cookies. Every refresh in
// either route — including both fallbacks in `/session` — goes through
// `rejectRevokedSession`; they must not diverge, or the unguarded one becomes
// the way around a ban.

/** POST /api/v1/auth/refresh */
router.post(
  '/refresh',
  authSessionRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = readRefreshCookie((req as any).cookies || {});
    if (!refreshToken) {
      return res.status(401).json({ success: false, error: 'Missing refresh session', code: 'SESSION_REVOKED' });
    }

    // FIXED (F10): the marker here claimed the API has no reuse detection. It
    // does — it is GoTrue's, and the API is right to rely on it rather than
    // keep a second, weaker copy.
    //
    // `supabase/config.toml` sets `enable_refresh_token_rotation = true` with
    // `refresh_token_reuse_interval = 10`. GoTrue therefore issues a NEW refresh
    // token on every redemption, and redeeming an already-redeemed one outside
    // that 10-second window (the window exists so a browser that retried a
    // dropped response is not punished) revokes the whole token family. A
    // stolen cookie and the legitimate browser cannot both keep refreshing:
    // whichever redeems second past the interval kills both.
    //
    // A denylist of seen refresh-token hashes in Redis would be strictly worse
    // here. It could not revoke the FAMILY (only GoTrue holds the parent/child
    // chain), it would have to fail closed on a Redis incident and sign
    // everyone out, and it would have to duplicate the reuse-interval grace or
    // start logging students out for a retried request. What the API owed this
    // route is the alarm, which is below, plus the ban and cutoff checks that
    // already follow.
    const client = getAnonAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      // Separate the two shapes of failure. A token GoTrue has already seen
      // redeemed is a REUSE signal — either a stolen cookie or a client bug —
      // and is worth an error-level line an alarm can key on; an ordinary
      // expiry is not, and logging both the same way buries the first.
      if (isRefreshTokenReuse(error)) {
        logger.error('Refresh token reuse detected by GoTrue; token family revoked', {
          code: (error as { code?: string } | null)?.code,
          status: (error as { status?: number } | null)?.status,
        });
      } else {
        logger.debug('Refresh rejected', { code: (error as { code?: string } | null)?.code });
      }
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Session expired', code: 'SESSION_REVOKED' });
    }

    // A valid refresh token outlived both revocation paths: this route checked
    // neither the ban list nor the per-user session cutoff, so a banned user or
    // a force-signed-out session kept minting fresh access cookies forever.
    const refreshedUserId = data.session.user?.id ?? data.user?.id;
    if (await rejectRevokedSession(refreshedUserId, data.session.access_token, res)) return;

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
      // Same gate as `/refresh`: this path mints a brand-new access token from
      // the refresh cookie, so skipping it turned `/session` into a way around
      // bans and admin-forced sign-outs.
      if (await rejectRevokedSession(data.session.user?.id ?? data.user?.id, data.session.access_token, res)) {
        return;
      }
      await applySessionCookies(res, data.session);
      const session = serializeClientSession(data.session, { includeAccessToken: true });
      return res.json({ success: true, data: { session, user: data.user } });
    }

    const verified = await dataLayer.client.verifySupabaseToken(accessToken);
    if (!verified.isValid || !verified.user) {
      // An invalid access token is routine — it expires hourly. Fall through
      // to the refresh cookie before giving up. The old code cleared BOTH
      // cookies here, so the refresh cookie a client would have recovered
      // with was destroyed by this very response: every cookie session died
      // at access-token expiry, which is why cookie auth "randomly" logged
      // users out about an hour after login.
      const refreshToken = readRefreshCookie((req as any).cookies || {});
      if (refreshToken) {
        const client = getAnonAuthClient();
        const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
        if (!error && data.session) {
          // Expired-access-token recovery still mints a token: gate it too.
          if (
            await rejectRevokedSession(
              data.session.user?.id ?? data.user?.id,
              data.session.access_token,
              res
            )
          ) {
            return;
          }
          await applySessionCookies(res, data.session);
          const session = serializeClientSession(data.session, { includeAccessToken: true });
          return res.json({ success: true, data: { session, user: data.user } });
        }
      }
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

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------
// Three mechanisms, applied together: the presented access token goes on the
// Redis denylist, a per-user cutoff timestamp invalidates every token issued
// before now, and Supabase's admin global signOut kills the GoTrue sessions.
// `optionalAuthMiddleware` and every session-minting route (`/refresh`,
// `/exchange`, `/session`, via `rejectRevokedSession`) read the first two back.

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
      await dataLayer.getClient().auth.admin.signOut(userId, 'global');
    } catch (err) {
      logger.warn('Supabase global signOut failed', { userId, err });
    }

    await cacheService.invalidateUserCache(userId);
    clearAuthCookies(res);

    res.json({ success: true, message: 'Logged out successfully' });
  })
);

/**
 * POST /api/v1/auth/revoke-other-sessions — sign out everywhere else.
 *
 * Called after a password change: a credential change must not leave sessions
 * alive on devices the user may no longer control. Supabase's global signOut
 * ends every session including this one, so the caller re-authenticates with
 * the new password immediately after; the fresh token is issued after the
 * cutoff and therefore survives it.
 */
router.post(
  '/revoke-other-sessions',
  authSessionRateLimit,
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    await setUserSessionCutoff(userId);

    try {
      await dataLayer.getClient().auth.admin.signOut(userId, 'global');
    } catch (err) {
      logger.warn('Supabase global signOut failed on session revoke', { userId, err });
    }

    await cacheService.invalidateUserCache(userId);
    logger.info('Sessions revoked after credential change', { userId });

    res.json({ success: true, message: 'Other sessions revoked' });
  })
);

export default router;
