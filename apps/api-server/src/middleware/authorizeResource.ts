/**
 * Reusable resource authorization middleware (IDOR guardrails).
 */
import { Response, NextFunction } from 'express';
import { asyncHandler } from './errorHandler';
import { SupabaseService } from '../services/supabase';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

let supabaseService: SupabaseService | null = null;

export function initializeAuthorizeResource(supabase: SupabaseService): void {
  supabaseService = supabase;
}

function requireService(): SupabaseService {
  if (!supabaseService) {
    throw new Error('AuthorizeResource middleware not initialized');
  }
  return supabaseService;
}

function denyAccess(res: Response, message = 'Access denied'): void {
  res.status(403).json({ success: false, error: message });
}

export function requireGroupMember(groupIdParam = 'groupId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const groupId = req.params[groupIdParam];
    if (!groupId) {
      denyAccess(res);
      return;
    }
    const group = await requireService().getGroupById(groupId, userId);
    if (!group) {
      denyAccess(res, 'Group not found or access denied');
      return;
    }
    next();
  });
}

export function requireGroupAdmin(groupIdParam = 'groupId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const groupId = req.params[groupIdParam];
    const group = await requireService().getGroupById(groupId, userId);
    if (!group) {
      denyAccess(res, 'Group not found or access denied');
      return;
    }
    const isAdmin =
      group.adminIds?.includes(userId) ||
      (group.permissions && (group.permissions as Record<string, { admin?: boolean }>)[userId]?.admin);
    if (!isAdmin && !req.user?.isAdmin) {
      denyAccess(res, 'Only group admins can perform this action');
      return;
    }
    next();
  });
}

export function requireDeckAccess(
  deckIdParam = 'deckId',
  level: 'read' | 'edit' | 'owner' = 'read'
) {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const deckId = req.params[deckIdParam];
    if (!deckId) {
      denyAccess(res);
      return;
    }
    const allowed = await requireService().verifyDeckAccess(userId, deckId, level);
    if (!allowed && !req.user?.isAdmin) {
      denyAccess(res, 'Deck not found or access denied');
      return;
    }
    next();
  });
}

export function requireNoteAccess(noteIdParam = 'noteId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const noteId = req.params[noteIdParam];
    if (!noteId) {
      denyAccess(res);
      return;
    }
    try {
      const note = await requireService().getNote(noteId, userId);
      if (!note && !req.user?.isAdmin) {
        denyAccess(res, 'Note not found or access denied');
        return;
      }
    } catch {
      res.status(404).json({ success: false, error: 'Note not found or access denied' });
      return;
    }
    next();
  });
}

export function requireTestOwner(testIdParam = 'testId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const testId = req.params[testIdParam];
    if (!testId) {
      denyAccess(res);
      return;
    }
    const test = await requireService().getTestById(testId, userId);
    if (!test && !req.user?.isAdmin) {
      res.status(404).json({ success: false, error: 'Test not found or access denied' });
      return;
    }
    next();
  });
}

/** True when dev auth bypass is explicitly enabled (never in production by default). */
export function allowDevAuthBypass(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true';
}

export function assertProductionAuthStrict(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    throw new Error('ALLOW_DEV_AUTH_BYPASS must not be enabled in production');
  }
}
