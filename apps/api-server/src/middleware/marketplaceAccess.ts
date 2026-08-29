import { Request, Response, NextFunction } from 'express';

/**
 * Marketplace private-pilot gate (2026-08-29, founder request): the goods
 * marketplace — listings, cart, orders, offers, digital products — is
 * available ONLY to the founder account until the pilot opens up. Everything
 * else in the app (chat, library, notes, tests, jobs) is untouched.
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
 * Mounted on /api/v1/marketplace after optionalAuthMiddleware (which is what
 * populates req.user when a credential is present). Express strips the mount
 * prefix, so req.path here is e.g. '/listings' or '/access'.
 */
export function marketplaceAccessGate(
  req: Request & { user?: { id?: string } },
  res: Response,
  next: NextFunction
): void {
  if (req.path === '/access' || req.path === '/access/') {
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
