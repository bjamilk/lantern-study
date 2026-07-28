import { Router, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { authenticatedRateLimit, storageBurstRateLimit } from '../middleware/rateLimit';
import { requireAuthUserId } from '../utils/requestAuth';
import { clampSignedUrlTtl } from '../utils/fileValidation';
import type { AuthenticatedRequest } from '../types';
import type { SupabaseService } from '../services/supabase';

const router = Router();

let supabaseService: SupabaseService;

export function initializeStorageRoutes(supabase: SupabaseService): void {
  supabaseService = supabase;
}

const storageRateLimits: import('express').RequestHandler[] = [
  authenticatedRateLimit,
  storageBurstRateLimit,
];

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
    const allowed = await supabaseService.canAccessStorageObject(userId, bucket, path);
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const ttl = clampSignedUrlTtl(
      typeof expiresInSeconds === 'number' ? expiresInSeconds : undefined
    );
    const displayVariant = parseStorageVariant(variant);
    const signedUrl = await supabaseService.createSignedStorageUrlWithVariant(
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

    const ttl = clampSignedUrlTtl(
      typeof expiresInSeconds === 'number' ? expiresInSeconds : undefined
    );
    const displayVariant = parseStorageVariant(variant);
    const signed = await Promise.all(
      items.map(async (item: { bucket?: string; path?: string; url?: string; variant?: string }) => {
        const resolved = supabaseService.resolveStorageReference(item.bucket, item.path, item.url);
        if (!resolved) {
          return { bucket: item.bucket, path: item.path, url: item.url, signedUrl: item.url ?? null, error: 'invalid_reference' };
        }
        const allowed = await supabaseService.canAccessStorageObject(userId, resolved.bucket, resolved.path);
        if (!allowed) {
          return { ...resolved, signedUrl: null, error: 'access_denied' };
        }
        const itemVariant = parseStorageVariant(item.variant ?? displayVariant);
        const signedUrl = await supabaseService.createSignedStorageUrlWithVariant(
          resolved.bucket,
          resolved.path,
          ttl,
          itemVariant,
        );
        return { ...resolved, signedUrl, variant: itemVariant };
      })
    );

    res.json({ success: true, data: { items: signed } });
  })
);

export default router;
