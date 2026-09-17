import { Response } from 'express';
import type { DataLayer } from '../services/data';
import type { AuthenticatedRequest } from '../types';

/**
 * All this needs is the privilege check itself.
 *
 * FLIPPED (monolith lane M3, Phase B): it held the whole `SupabaseService` for
 * one call. The BODY is unchanged — `client.isPlatformAdmin` is the same
 * `platform_admins` lookup the facade delegated to, still LIVE on every call,
 * still never the JWT claim, and still uncached. That is the point of the word
 * "live" in these names: a revoked admin loses access on the next request.
 */
type PlatformAdminHost = Pick<DataLayer, 'client'>;

let dataLayer: PlatformAdminHost | null = null;

export function initializePlatformAdminAuth(layer: PlatformAdminHost): void {
  dataLayer = layer;
}

export async function isLivePlatformAdmin(userId: string): Promise<boolean> {
  if (!dataLayer) return false;
  return dataLayer.client.isPlatformAdmin(userId);
}

/** Returns false after sending 403/401 — use for admin-only mutations. */
export async function assertLivePlatformAdmin(
  req: AuthenticatedRequest,
  res: Response
): Promise<boolean> {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  const live = await isLivePlatformAdmin(req.user.id);
  if (!live) {
    res.status(403).json({ success: false, error: 'Platform admin access required' });
    return false;
  }
  return true;
}

export async function isSelfOrLivePlatformAdmin(
  req: AuthenticatedRequest,
  targetUserId: string
): Promise<boolean> {
  if (!req.user?.id) return false;
  if (req.user.id === targetUserId) return true;
  return isLivePlatformAdmin(req.user.id);
}

/** Returns false after sending 403/401 when caller is neither self nor live admin. */
export async function assertSelfOrLivePlatformAdmin(
  req: AuthenticatedRequest,
  res: Response,
  targetUserId: string
): Promise<boolean> {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  if (req.user.id === targetUserId) return true;
  const live = await isLivePlatformAdmin(req.user.id);
  if (!live) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}
