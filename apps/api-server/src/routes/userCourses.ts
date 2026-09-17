/**
 * /api/v1/users/me/courses — the caller's enrolments (Phase 1 · A).
 * Contract: docs/phase1-academic-identity-contract.md §2.
 *
 * Mounted in server.ts BEFORE the /users router so "me/courses" can never be
 * swallowed by /users/:userId/*. Uncached by design.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { MAX_USER_COURSES_PER_YEAR, getAcademicCoursesService } from '../services/academicCourses';

const router = Router();

let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

// Signature mirrors the other routers; user-course routes are uncached by design.
export const initializeUserCourseRoutes = (layer: DataLayer, _cache?: CacheService) => {
  dataLayer = layer;
};

const ACADEMIC_YEAR_MESSAGE = 'academicYear must look like 2026/2027';

export const validateUserCoursesList = [
  query('status').optional().isIn(['active', 'archived', 'all']).withMessage('status must be active, archived or all'),
  query('academicYear').optional().matches(/^\d{4}\/\d{4}$/).withMessage(ACADEMIC_YEAR_MESSAGE),
];

export const validateUserCoursesSet = [
  body('courseIds')
    .isArray({ max: MAX_USER_COURSES_PER_YEAR })
    .withMessage(`courseIds must be an array of at most ${MAX_USER_COURSES_PER_YEAR} ids`),
  body('courseIds.*').isUUID().withMessage('Every courseId must be a valid UUID'),
  body('academicYear').optional().matches(/^\d{4}\/\d{4}$/).withMessage(ACADEMIC_YEAR_MESSAGE),
];

export const validateUserCoursePatch = [
  param('courseId').isUUID().withMessage('courseId must be a valid UUID'),
  body('examDate')
    .optional({ values: 'null' })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('examDate must be YYYY-MM-DD or null'),
  body('semester').optional({ values: 'null' }).isInt({ min: 1, max: 2 }).withMessage('semester must be 1, 2 or null'),
  body('status').optional().isIn(['active', 'archived']).withMessage("status must be 'active' or 'archived'"),
  body('academicYear').optional().matches(/^\d{4}\/\d{4}$/).withMessage(ACADEMIC_YEAR_MESSAGE),
];

export const validateUserCourseDelete = [
  param('courseId').isUUID().withMessage('courseId must be a valid UUID'),
  query('academicYear').optional().matches(/^\d{4}\/\d{4}$/).withMessage(ACADEMIC_YEAR_MESSAGE),
];

export const validateArchiveSemester = [
  body('academicYear').isString().matches(/^\d{4}\/\d{4}$/).withMessage(ACADEMIC_YEAR_MESSAGE),
];

const handlePublicError = (err: unknown, res: any): boolean => {
  if (err instanceof PublicError) {
    res.status(400).json({ success: false, error: err.message });
    return true;
  }
  return false;
};

// GET /api/v1/users/me/courses?status=active|archived|all&academicYear
router.get(
  '/',
  authMiddleware,
  validateUserCoursesList,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const status = (req.query.status as 'active' | 'archived' | 'all' | undefined) ?? 'active';
    const academicYear = typeof req.query.academicYear === 'string' && req.query.academicYear ? req.query.academicYear : undefined;
    const data = await getAcademicCoursesService(legacyService()).listUserCourses(userId, { status, academicYear });
    res.json({ success: true, data });
  })
);

// PUT /api/v1/users/me/courses — set semantics for one academic year
router.put(
  '/',
  authMiddleware,
  validateUserCoursesSet,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getAcademicCoursesService(legacyService()).setUserCourses(userId, {
        courseIds: req.body?.courseIds,
        academicYear: req.body?.academicYear,
      });
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

// POST /api/v1/users/me/courses/archive-semester — must precede /:courseId
router.post(
  '/archive-semester',
  authMiddleware,
  validateArchiveSemester,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getAcademicCoursesService(legacyService()).archiveSemester(userId, req.body?.academicYear);
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

// PATCH /api/v1/users/me/courses/:courseId
router.patch(
  '/:courseId',
  authMiddleware,
  validateUserCoursePatch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getAcademicCoursesService(legacyService()).updateUserCourse(userId, req.params.courseId, {
        examDate: req.body?.examDate,
        semester: req.body?.semester,
        status: req.body?.status,
        academicYear: req.body?.academicYear,
      });
      if (!data) {
        return res.status(404).json({ success: false, error: 'You are not enrolled in that course' });
      }
      res.json({ success: true, data });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

// DELETE /api/v1/users/me/courses/:courseId?academicYear
router.delete(
  '/:courseId',
  authMiddleware,
  validateUserCourseDelete,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const removed = await getAcademicCoursesService(legacyService()).removeUserCourse(
        userId,
        req.params.courseId,
        typeof req.query.academicYear === 'string' ? req.query.academicYear : undefined
      );
      if (!removed) {
        return res.status(404).json({ success: false, error: 'You are not enrolled in that course' });
      }
      res.json({ success: true });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

export default router;
