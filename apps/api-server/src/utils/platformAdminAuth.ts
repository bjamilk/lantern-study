import { Response } from 'express';
import { SupabaseService } from '../services/supabase';
import type { AuthenticatedRequest } from '../types';

let supabaseService: SupabaseService | null = null;

export function initializePlatformAdminAuth(supabase: SupabaseService): void {
  supabaseService = supabase;
}

export async function isLivePlatformAdmin(userId: string): Promise<boolean> {
  if (!supabaseService) return false;
  return supabaseService.isPlatformAdmin(userId);
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
