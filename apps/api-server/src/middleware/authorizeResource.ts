/**
 * Reusable resource authorization middleware (IDOR guardrails).
 */
/**
 * Ownership predicates that routes mount between `authMiddleware` and the
 * handler, so a handler never has to re-derive who may touch a `:groupId`,
 * `:deckId`, `:noteId` or `:testId`.
 *
 * Exports: `requireGroupMember`, `requireGroupAdmin`, `requireDeckAccess`,
 * `requireNoteAccess`, `requireNoteEdit`, `requireNoteOwner`,
 * `requireTestOwner`, plus `initializeAuthorizeResource` (bootstrap) and the
 * `allowDevAuthBypass` / `assertProductionAuthStrict` pair that keeps the dev
 * bypass out of production.
 *
 * Each predicate delegates the actual lookup to the data layer
 * (`getGroupById`, `verifyDeckAccess`, `resolveNoteAccess`, `canEditNote`,
 * `isNoteOwner`, `getTestById`), which is what reads `study_groups`,
 * `flashcard_decks`, `notes` / note collaborators and `tests`. These run on the
 * service-role client, so the predicate here IS the access control — RLS does
 * not apply to it.
 *
 * Conventions: every predicate also passes a live platform admin
 * (`isLivePlatformAdmin`, a fresh `platform_admins` read per call — note that
 * several predicates issue that query even on the success path). Denials are
 * 403 `{ success: false, error }` except `requireTestOwner` and the
 * `resolveNoteAccess` throw path, which answer 404 so a probe cannot confirm
 * that an id exists. `requireNoteAccess` also parks the resolved access record
 * on `req.noteAccess` for the handler.
 */
import { Response, NextFunction } from 'express';
import { asyncHandler } from './errorHandler';
import type { DataLayer } from '../services/data';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';
import { isLivePlatformAdmin } from '../utils/platformAdminAuth';

let dataLayer: DataLayer | null = null;

export function initializeAuthorizeResource(layer: DataLayer): void {
  dataLayer = layer;
}

function requireLayer(): DataLayer {
  if (!dataLayer) {
    throw new Error('AuthorizeResource middleware not initialized');
  }
  return dataLayer;
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
    const group = await requireLayer().groups.getGroupById(groupId, userId);
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
    const group = await requireLayer().groups.getGroupById(groupId, userId);
    if (!group) {
      denyAccess(res, 'Group not found or access denied');
      return;
    }
    const isAdmin =
      group.adminIds?.includes(userId) ||
      (group.permissions && (group.permissions as Record<string, { admin?: boolean }>)[userId]?.admin);
    const liveAdmin = await isLivePlatformAdmin(userId);
    if (!isAdmin && !liveAdmin) {
      denyAccess(res, 'Only group admins can perform this action');
      return;
    }
    next();
  });
}

// ============ Deck, note and test predicates ============

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
    const allowed = await requireLayer().offlineBundles.verifyDeckAccess(userId, deckId, level);
    const liveAdmin = await isLivePlatformAdmin(userId);
    if (!allowed && !liveAdmin) {
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
      const access = await requireLayer().notes.resolveNoteAccess(noteId, userId);
      const liveAdmin = await isLivePlatformAdmin(userId);
      if (!access && !liveAdmin) {
        denyAccess(res, 'Note not found or access denied');
        return;
      }
      if (access) {
        (req as AuthenticatedRequest & { noteAccess?: typeof access }).noteAccess = access;
      }
    } catch {
      res.status(404).json({ success: false, error: 'Note not found or access denied' });
      return;
    }
    next();
  });
}

/** Owner or collaborator with editor/owner role (not viewer). */
export function requireNoteEdit(noteIdParam = 'noteId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const noteId = req.params[noteIdParam];
    if (!noteId) {
      denyAccess(res);
      return;
    }
    const liveAdmin = await isLivePlatformAdmin(userId);
    if (liveAdmin) {
      next();
      return;
    }
    const canEdit = await requireLayer().notes.canEditNote(userId, noteId);
    if (!canEdit) {
      denyAccess(res, 'You do not have permission to edit this note');
      return;
    }
    next();
  });
}

/** Note owner only (not editors/viewers). */
export function requireNoteOwner(noteIdParam = 'noteId') {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const noteId = req.params[noteIdParam];
    if (!noteId) {
      denyAccess(res);
      return;
    }
    const liveAdmin = await isLivePlatformAdmin(userId);
    if (liveAdmin) {
      next();
      return;
    }
    const isOwner = await requireLayer().notes.isNoteOwner(userId, noteId);
    if (!isOwner) {
      denyAccess(res, 'Only the note owner can perform this action');
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
    const test = await requireLayer().tests.getTestById(testId, userId);
    const liveAdmin = await isLivePlatformAdmin(userId);
    if (!test && !liveAdmin) {
      res.status(404).json({ success: false, error: 'Test not found or access denied' });
      return;
    }
    next();
  });
}

// ============ Dev auth bypass guard ============

/** True when dev auth bypass is explicitly enabled (never in production by default). */
export function allowDevAuthBypass(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true';
}

export function assertProductionAuthStrict(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    throw new Error('ALLOW_DEV_AUTH_BYPASS must not be enabled in production');
  }
}
