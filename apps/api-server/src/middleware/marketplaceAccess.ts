import { Request, Response, NextFunction } from 'express';

/**
 * Private-pilot gate (2026-08-29, founder request; extended to the jobs board
 * 2026-09-01): the goods marketplace — listings, cart, orders, offers, digital
 * products — and the jobs board are available ONLY to the founder account
 * until the pilot opens up. Everything else in the app (chat, library, notes,
 * tests) is untouched.
 *
 * - Allowed accounts: DEFAULT_ALLOWED_USER_IDS plus any ids in the
 *   MARKETPLACE_ALLOWED_USER_IDS env (comma-separated), matched on the
 *   authenticated user id so both JWT and API-key credentials work.
 * - Reopen switch: set MARKETPLACE_PUBLIC=true on the API service and the
 *   gate disappears for everyone — no code change needed.
 * - The GET /access probe stays open (any viewer, signed in or not) so both
 *   clients can decide whether to show marketplace surfaces at all.
 * - Paystack webhooks mount OUTSIDE /api/v1/marketplace and are not affected.
 * - The public SEO functions (functions/marketplace/*) fall back to the SPA
 *   shell on any non-OK response, so a 403 just skips the prerender.
 */
const DEFAULT_ALLOWED_USER_IDS = [
  // nimaj22@gmail.com — the founder account.
  '1e547f81-77c8-437a-8154-c84e8cf2045e',
];

export function marketplaceIsPublic(): boolean {
  return process.env.MARKETPLACE_PUBLIC === 'true';
}

function allowedUserIds(): Set<string> {
  const ids = new Set(DEFAULT_ALLOWED_USER_IDS);
  for (const raw of (process.env.MARKETPLACE_ALLOWED_USER_IDS || '').split(',')) {
    const id = raw.trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function isMarketplaceAllowedUser(userId?: string | null): boolean {
  if (marketplaceIsPublic()) return true;
  return !!userId && allowedUserIds().has(userId);
}

/**
 * Routes on the marketplace mount that are REFERENCE DATA, not commerce, and
 * that other parts of the app depend on. The institutions list behind the
 * academic-profile setup (web + mobile), the settings campus picker and the
 * jobs create screen all read GET /marketplace/campuses — gating it broke
 * "Couldn't load institutions" everywhere on 2026-08-29. The pilot protects
 * buying/selling; it must never gate shared lookups.
 */
const OPEN_PATHS = new Set(['/access', '/campuses']);

/**
 * Mounted on /api/v1/marketplace after optionalAuthMiddleware (which is what
 * populates req.user when a credential is present). Express strips the mount
 * prefix, so req.path here is e.g. '/listings' or '/access'.
 */
export function marketplaceAccessGate(
  req: Request & { user?: { id?: string } },
  res: Response,
  next: NextFunction
): void {
  const path = req.path.length > 1 && req.path.endsWith('/')
    ? req.path.slice(0, -1)
    : req.path;
  if (OPEN_PATHS.has(path)) {
    next();
    return;
  }
  if (isMarketplaceAllowedUser(req.user?.id)) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: 'The marketplace is in a private pilot and is not available on your account yet.',
    code: 'MARKETPLACE_PRIVATE',
  });
}

/**
 * The same gate for the jobs board, mounted on /api/v1/jobs-board.
 *
 * Note the mount path: /api/v1/jobs is a DIFFERENT router — the async job-queue
 * status endpoint that note import, AI and the companion poll. Gating by path
 * prefix would catch both and break uploads app-wide, so this is mounted on the
 * jobs-board router specifically.
 *
 * Nothing is exempt here. Unlike the marketplace, the jobs board serves no
 * shared reference data: the only outside readers are the SEO prerender
 * functions, which fall through to the SPA shell on any non-OK response.
 */
export function jobsBoardAccessGate(
  req: Request & { user?: { id?: string } },
  res: Response,
  next: NextFunction
): void {
  if (isMarketplaceAllowedUser(req.user?.id)) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: 'The jobs board is in a private pilot and is not available on your account yet.',
    code: 'JOBS_PRIVATE',
  });
}
