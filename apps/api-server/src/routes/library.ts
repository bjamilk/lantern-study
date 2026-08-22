/**
 * /api/v1/library — the Library archive tree + cross-artefact search (Phase 1 · B).
 * Contract: docs/phase1-library-archive-contract.md §1.
 *
 *   GET /overview  — years → courses → counts, plus unfiled counts (one round trip)
 *   GET /search    — ?q&courseId&types=notes,decks,flashcards,bundles&limit=30
 *
 * Both are owner-scoped to the caller and uncached (the tree changes with every
 * note/deck/test the user touches; search is debounced client-side).
 */
import { Router } from 'express';
import { query } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { isUuid } from '../services/academicCourses';
import {
  LIBRARY_SEARCH_DEFAULT_LIMIT,
  LIBRARY_SEARCH_MAX_LIMIT,
  LIBRARY_SEARCH_MAX_QUERY_LENGTH,
  LIBRARY_SEARCH_MIN_QUERY_LENGTH,
  LIBRARY_SEARCH_TYPES,
  getLibrarySearchService,
  normalizeSearchQuery,
  parseLibrarySearchTypes,
} from '../services/librarySearch';

const router = Router();

let supabaseService: SupabaseService;

// Signature mirrors the other routers; library routes are uncached by design.
export const initializeLibraryRoutes = (supabase: SupabaseService, _cache?: CacheService) => {
  supabaseService = supabase;
};

export const validateLibrarySearch = [
  query('q')
    .isString()
    .withMessage('q is required')
    .customSanitizer((value) => normalizeSearchQuery(value))
    .isLength({ min: LIBRARY_SEARCH_MIN_QUERY_LENGTH, max: LIBRARY_SEARCH_MAX_QUERY_LENGTH })
    .withMessage(`q must be ${LIBRARY_SEARCH_MIN_QUERY_LENGTH}-${LIBRARY_SEARCH_MAX_QUERY_LENGTH} characters`),
  query('courseId')
    .optional({ values: 'falsy' })
    .custom((value) => value === 'null' || isUuid(value))
    .withMessage("courseId must be a valid UUID or 'null' for unfiled items"),
  query('types')
    .optional({ values: 'falsy' })
    .custom((value) => parseLibrarySearchTypes(value) !== null)
    .withMessage(`types must be a comma-separated subset of ${LIBRARY_SEARCH_TYPES.join(', ')}`),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: LIBRARY_SEARCH_MAX_LIMIT })
    .withMessage(`limit must be 1-${LIBRARY_SEARCH_MAX_LIMIT}`),
];

const handlePublicError = (err: unknown, res: any): boolean => {
  if (err instanceof PublicError) {
    res.status(400).json({ success: false, error: err.message });
    return true;
  }
  return false;
};

// GET /api/v1/library/overview
router.get(
  '/overview',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const overview = await getLibrarySearchService(supabaseService).getOverview(userId);
    res.json({ success: true, data: overview });
  })
);

// GET /api/v1/library/search?q&courseId&types=notes,decks,flashcards,bundles&limit=30
router.get(
  '/search',
  authMiddleware,
  validateLibrarySearch,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const courseId = typeof req.query.courseId === 'string' && req.query.courseId ? req.query.courseId : null;
    const types = parseLibrarySearchTypes(req.query.types) ?? undefined;
    const limit = Math.min(
      LIBRARY_SEARCH_MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit || LIBRARY_SEARCH_DEFAULT_LIMIT), 10) || LIBRARY_SEARCH_DEFAULT_LIMIT)
    );

    try {
      const results = await getLibrarySearchService(supabaseService).search(userId, { q, courseId, types, limit });
      res.json({ success: true, data: results });
    } catch (err) {
      if (handlePublicError(err, res)) return;
      throw err;
    }
  })
);

export default router;
