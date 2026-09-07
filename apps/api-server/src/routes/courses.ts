/**
 * /api/v1/courses — the shared course catalogue (Phase 1 · A).
 * Contract: docs/phase1-academic-identity-contract.md §2.
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import {
  DEFAULT_COURSE_SEARCH_LIMIT,
  MAX_COURSE_SEARCH_LIMIT,
  getAcademicCoursesService,
} from '../services/academicCourses';
import { getClassSectionsService } from '../services/classSections';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeCourseRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

export const COURSE_SEARCH_CACHE_PREFIX = 'courses:search:';
const COURSE_SEARCH_CACHE_TTL_SECONDS = 300;

export const validateCourseSearch = [
  query('institutionId').optional({ values: 'falsy' }).isUUID().withMessage('institutionId must be a valid UUID'),
  query('q').optional().isString().isLength({ max: 100 }).withMessage('q must be at most 100 characters'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_COURSE_SEARCH_LIMIT })
    .withMessage(`limit must be 1-${MAX_COURSE_SEARCH_LIMIT}`),
];

export const validateCourseCreate = [
  body('institutionId').optional({ values: 'null' }).isUUID().withMessage('institutionId must be a valid UUID'),
  body('code').isString().trim().isLength({ min: 2, max: 40 }).withMessage('code must be 2-40 characters'),
  body('title').optional().isString().isLength({ max: 200 }).withMessage('title must be at most 200 characters'),
  body('faculty').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  body('level').optional({ values: 'null' }).isInt({ min: 100, max: 900 }).withMessage('level must be 100-900'),
  body('semester').optional({ values: 'null' }).isInt({ min: 1, max: 2 }).withMessage('semester must be 1 or 2'),
];

// GET /api/v1/courses?institutionId&q&limit=20
router.get(
  '/',
  authMiddleware,
  validateCourseSearch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const institutionId = typeof req.query.institutionId === 'string' && req.query.institutionId ? req.query.institutionId : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(
      MAX_COURSE_SEARCH_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || DEFAULT_COURSE_SEARCH_LIMIT), 10) || DEFAULT_COURSE_SEARCH_LIMIT)
    );

    const cacheKey = `${COURSE_SEARCH_CACHE_PREFIX}${institutionId || 'all'}:${q.toLowerCase()}:${limit}`;
    const courses = await cacheService.cached(
      cacheKey,
      () => getAcademicCoursesService(supabaseService).searchCourses({ institutionId, q, limit }),
      { ttl: COURSE_SEARCH_CACHE_TTL_SECONDS }
    );

    res.json({ success: true, data: courses });
  })
);

// POST /api/v1/courses — find-or-create on the normalised code
router.post(
  '/',
  authMiddleware,
  validateCourseCreate,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const { course, created } = await getAcademicCoursesService(supabaseService).findOrCreateCourse(userId, {
        institutionId: req.body?.institutionId ?? null,
        code: req.body?.code,
        title: req.body?.title,
        faculty: req.body?.faculty,
        level: req.body?.level,
        semester: req.body?.semester,
      });
      if (created) {
        await cacheService.deletePattern(`${COURSE_SEARCH_CACHE_PREFIX}*`);
      }
      res.status(created ? 201 : 200).json({ success: true, data: course });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// PATCH /api/v1/courses/:courseId/canonical — campus staff / platform admin
router.patch(
  '/:courseId/canonical',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const isCanonical = Boolean(req.body?.isCanonical);
      const course = await getClassSectionsService(supabaseService).setCourseCanonical(
        userId,
        String(req.params.courseId),
        isCanonical,
        req.user
      );
      res.json({ success: true, data: course });
    } catch (err: any) {
      if (err instanceof PublicError) {
        const code = typeof (err as { statusCode?: number }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 400;
        return res.status(code).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

export default router;
