/**
 * /api/v1/users/me/study-sets — personal study sets on the Study tab.
 */
import { Router } from 'express';
import { body, param } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { getStudySetsService } from '../services/studySets';

const router = Router();
let supabaseService: SupabaseService;

export const initializeStudySetRoutes = (supabase: SupabaseService) => {
  supabaseService = supabase;
};

const handlePublicError = (err: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean => {
  if (err instanceof PublicError) {
    res.status(400).json({ success: false, error: err.message });
    return true;
  }
  return false;
};

export const validateStudySetCreate = [
  body('title').isString().isLength({ min: 1, max: 80 }).withMessage('title must be 1-80 characters'),
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID'),
];

export const validateStudySetPatch = [
  param('setId').isUUID().withMessage('setId must be a valid UUID'),
  body('title').optional().isString().isLength({ min: 1, max: 80 }).withMessage('title must be 1-80 characters'),
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID'),
];

export const validateStudySetId = [param('setId').isUUID().withMessage('setId must be a valid UUID')];

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudySetsService(supabaseService).list(userId);
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authMiddleware,
  validateStudySetCreate,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).create(userId, req.body || {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.get(
  '/:setId',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).get(userId, String(req.params.setId));
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.patch(
  '/:setId',
  authMiddleware,
  validateStudySetPatch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudySetsService(supabaseService).update(
        userId,
        String(req.params.setId),
        req.body || {}
      );
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

router.delete(
  '/:setId',
  authMiddleware,
  validateStudySetId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await getStudySetsService(supabaseService).remove(userId, String(req.params.setId));
      res.json({ success: true });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

export default router;
