/**
 * /api/v1/concepts — the knowledge-network vocabulary (Phase 1 · C).
 * Contract: docs/phase1-learning-events-contract.md §2 (fetchConcepts,
 * createConcept, linkConcept). Thin: the tagging UI is Phase 3 P.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import {
  DEFAULT_CONCEPT_SEARCH_LIMIT,
  MAX_CONCEPT_SEARCH_LIMIT,
  MAX_CONCEPT_TARGET_ID_LENGTH,
  getConceptsService,
} from '../services/concepts';
import { CONCEPT_NAME_MAX_LENGTH } from '@lantern/shared/learning';

const router = Router();

let dataLayer: DataLayer;

let cacheService: CacheService;

export const initializeConceptRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

export const CONCEPT_SEARCH_CACHE_PREFIX = 'concepts:search:';
const CONCEPT_SEARCH_CACHE_TTL_SECONDS = 120;

export const validateConceptSearch = [
  query('courseId').optional({ values: 'falsy' }).isUUID().withMessage('courseId must be a valid UUID'),
  query('q').optional().isString().isLength({ max: CONCEPT_NAME_MAX_LENGTH }).withMessage(`q must be at most ${CONCEPT_NAME_MAX_LENGTH} characters`),
  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_CONCEPT_SEARCH_LIMIT })
    .withMessage(`limit must be 1-${MAX_CONCEPT_SEARCH_LIMIT}`),
];

export const validateConceptCreate = [
  body('name').isString().trim().isLength({ min: 1, max: CONCEPT_NAME_MAX_LENGTH }).withMessage(`name must be 1-${CONCEPT_NAME_MAX_LENGTH} characters`),
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID'),
  body('parentId').optional({ values: 'null' }).isUUID().withMessage('parentId must be a valid UUID'),
  body('source').optional({ values: 'null' }).isIn(['ai', 'user', 'import']).withMessage('source must be ai, user or import'),
];

export const validateConceptLink = [
  param('conceptId').isUUID().withMessage('conceptId must be a valid UUID'),
  body('targetType').isIn(['flashcard', 'question', 'note', 'deck']).withMessage('targetType must be flashcard, question, note or deck'),
  body('targetId').isString().trim().isLength({ min: 1, max: MAX_CONCEPT_TARGET_ID_LENGTH }).withMessage('targetId is required'),
  body('confidence').optional({ values: 'null' }).isFloat({ min: 0, max: 1 }).withMessage('confidence must be 0-1'),
  body('source').optional({ values: 'null' }).isIn(['ai', 'user', 'import']).withMessage('source must be ai, user or import'),
];

// GET /api/v1/concepts?q&courseId&limit=20
router.get(
  '/',
  authMiddleware,
  validateConceptSearch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const courseId = typeof req.query.courseId === 'string' && req.query.courseId ? req.query.courseId : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(
      MAX_CONCEPT_SEARCH_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || DEFAULT_CONCEPT_SEARCH_LIMIT), 10) || DEFAULT_CONCEPT_SEARCH_LIMIT)
    );

    const cacheKey = `${CONCEPT_SEARCH_CACHE_PREFIX}${courseId || 'all'}:${q.toLowerCase()}:${limit}`;
    const concepts = await cacheService.cached(
      cacheKey,
      () => getConceptsService(dataLayer).searchConcepts({ q, courseId, limit }),
      { ttl: CONCEPT_SEARCH_CACHE_TTL_SECONDS }
    );

    res.json({ success: true, data: concepts });
  })
);

// POST /api/v1/concepts — find-or-create on (courseId, slug)
router.post(
  '/',
  authMiddleware,
  validateConceptCreate,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const { concept, created } = await getConceptsService(dataLayer).findOrCreateConcept(userId, {
        name: req.body?.name,
        courseId: req.body?.courseId ?? null,
        parentId: req.body?.parentId ?? null,
        source: req.body?.source ?? null,
      });
      if (created) {
        await cacheService.deletePattern(`${CONCEPT_SEARCH_CACHE_PREFIX}*`);
      }
      res.status(created ? 201 : 200).json({ success: true, data: concept });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

// POST /api/v1/concepts/:conceptId/links — idempotent link to an artefact
router.post(
  '/:conceptId/links',
  authMiddleware,
  validateConceptLink,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      const link = await getConceptsService(dataLayer).linkConcept(userId, req.params.conceptId, {
        targetType: req.body?.targetType,
        targetId: req.body?.targetId,
        confidence: req.body?.confidence ?? null,
        source: req.body?.source ?? null,
      });
      res.status(201).json({ success: true, data: link });
    } catch (err: any) {
      if (err instanceof PublicError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  })
);

export default router;
