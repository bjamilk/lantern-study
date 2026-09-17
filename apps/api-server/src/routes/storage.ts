/**
 * Signed-URL minting for private Supabase Storage objects.
 *
 * Purpose
 * - Nothing in this product stores a signed URL. Signed URLs expire (24 h
 *   maximum), so a persisted one is a broken image tomorrow — that was the
 *   chat/board photo outage. Every record stores the bucket and object PATH,
 *   and clients call these two routes to turn paths into URLs they can render
 *   right now.
 *
 * Exports
 * - Default router, plus `initializeStorageRoutes(supabase)` called from
 *   `server.ts` at boot. Callers are the web and mobile clients: covers,
 *   flashcard and question images, note files, chat and board photos,
 *   marketplace images.
 *
 * Mount path
 * - `/api/v1/storage`.
 *
 * Auth mode
 * - `POST /signed-url` — `authMiddleware`. A single object always needs a
 *   signed-in requester.
 * - `POST /signed-urls` — `optionalAuthMiddleware`, so an anonymous visitor can
 *   batch-sign the objects that are public by policy (active marketplace
 *   listing images, published shop covers). `req.user?.id ?? null` is passed
 *   straight to the ACL, which refuses everything owner-scoped for `null`.
 *
 * Rate-limit tier
 * - `authenticatedRateLimit` + `storageBurstRateLimit` on both routes
 *   (`storageRateLimits`). The burst limiter is what keeps a grid of 40 images
 *   from becoming a sustained signing loop.
 *
 * Ownership predicate
 * - Delegated, one object at a time, to `legacyService().canAccessStorageObject`
 *   in `services/supabase.ts`. That function is the bucket ACL: it denies by
 *   default for any bucket not on the private allowlist, rejects traversal in
 *   the path, treats the first path segment as the owner id, and then applies
 *   per-bucket rules (marketplace listing status, flashcard and question image
 *   reachability, group membership for chat objects). This router never reads a
 *   table itself.
 *
 * Error-mapping convention
 * - Single: 400 for a missing `bucket`/`path`, 403 for a denied object.
 * - Batch: always 200. Each item carries its own outcome — `error:
 *   'invalid_reference'` or `'access_denied'` with `signedUrl: null` — because
 *   one unreadable thumbnail must not fail the other 39.
 *
 * What it touches
 * - Supabase Storage only (private buckets), through
 *   `createSignedStorageUrlWithVariant`. No database write, no external API.
 */
import { Router, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { authenticatedRateLimit, storageBurstRateLimit } from '../middleware/rateLimit';
import { requireAuthUserId } from '../utils/requestAuth';
import { clampSignedUrlTtl } from '../utils/fileValidation';
import type { AuthenticatedRequest } from '../types';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';

const router = Router();

let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export function initializeStorageRoutes(layer: DataLayer): void {
  dataLayer = layer;
}

const storageRateLimits: import('express').RequestHandler[] = [
  authenticatedRateLimit,
  storageBurstRateLimit,
];

/**
 * `thumb` asks for the derived thumbnail next to the object; anything else,
 * including an absent or malformed value, means the original. The ACL is always
 * checked against the ORIGINAL path, so a variant can never widen access.
 */
function parseStorageVariant(value: unknown): 'thumb' | 'original' {
  return value === 'thumb' ? 'thumb' : 'original';
}

/** POST /api/v1/storage/signed-url — mint a fresh signed read URL */
router.post(
  '/signed-url',
  authMiddleware,
  ...storageRateLimits,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { bucket, path, expiresInSeconds, variant } = req.body || {};
    if (!bucket || !path) {
      return res.status(400).json({ success: false, error: 'bucket and path are required' });
    }

    // ACL always checked against the original object path.
    const allowed = await dataLayer.storageAcl.canAccessStorageObject(userId, bucket, path);
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // FIXED (F10): the clamp is now given the BUCKET, and its no-argument
    // default is one hour rather than the 24 h maximum. Clients send no
    // `expiresInSeconds`, so every URL this route minted used to live a full
    // day — including `job-resumes`, where the object is an applicant's CV.
    // Sensitive buckets are capped at an hour even when a caller asks for more.
    const ttl = clampSignedUrlTtl(
      typeof expiresInSeconds === 'number' ? expiresInSeconds : undefined,
      bucket
    );
    const displayVariant = parseStorageVariant(variant);
    const signedUrl = await dataLayer.storageAcl.createSignedStorageUrlWithVariant(
      bucket,
      path,
      ttl,
      displayVariant,
    );

    res.json({ success: true, data: { signedUrl, bucket, path, variant: displayVariant } });
  })
);

/** POST /api/v1/storage/signed-urls — batch sign (max 40) */
router.post(
  '/signed-urls',
  optionalAuthMiddleware,
  ...storageRateLimits,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id ?? null;
    const { items, expiresInSeconds, variant } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required' });
    }
    if (items.length > 40) {
      return res.status(400).json({ success: false, error: 'Maximum 40 items per request' });
    }

    // FIXED (F10): the requested TTL is carried unclamped and clamped PER ITEM
    // below, once the item's bucket is known — a batch can mix buckets, and one
    // clamp here would give a CV in `job-resumes` whatever ceiling the rest of
    // the batch earned.
    const requestedTtl = typeof expiresInSeconds === 'number' ? expiresInSeconds : undefined;
    const displayVariant = parseStorageVariant(variant);
    // Items are signed concurrently but authorised INDIVIDUALLY: one
    // `canAccessStorageObject` call per object, no batching of the predicate.
    // An item may arrive as a bucket+path pair or as a stale signed URL a
    // client held on to; `resolveStorageReference` parses either back into a
    // bucket and path before the ACL sees it.
    const signed = await Promise.all(
      items.map(async (item: { bucket?: string; path?: string; url?: string; variant?: string }) => {
        const resolved = dataLayer.storageAcl.resolveStorageReference(item.bucket, item.path, item.url);
        if (!resolved) {
          return { bucket: item.bucket, path: item.path, url: item.url, signedUrl: item.url ?? null, error: 'invalid_reference' };
        }
        const allowed = await dataLayer.storageAcl.canAccessStorageObject(userId, resolved.bucket, resolved.path);
        if (!allowed) {
          return { ...resolved, signedUrl: null, error: 'access_denied' };
        }
        const itemVariant = parseStorageVariant(item.variant ?? displayVariant);
        const signedUrl = await dataLayer.storageAcl.createSignedStorageUrlWithVariant(
          resolved.bucket,
          resolved.path,
          clampSignedUrlTtl(requestedTtl, resolved.bucket),
          itemVariant,
        );
        return { ...resolved, signedUrl, variant: itemVariant };
      })
    );

    res.json({ success: true, data: { items: signed } });
  })
);

export default router;
