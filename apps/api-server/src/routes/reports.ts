/**
 * /api/v1/reports — generic content reports (Phase 1 · E).
 * Contract: docs/phase1-rights-moderation-contract.md §3.
 *
 *   POST /  { targetType, targetId, reason, details? }
 *     → 201 { id, status } · 400 bad target/reason · 404 target gone
 *       · 409 already reported by this user · 503 migration not applied
 *
 * The legacy per-resource report routes (POST /marketplace/listings/:id/reports,
 * POST /jobs-board/postings/:id/reports) write the same table through the same
 * service; this is the one entry point new clients should use.
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { publicWriteRateLimit } from '../middleware/rateLimit';
import { handleValidationErrors } from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage, PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { CacheService } from '../services/cache';
import { getModerationService } from '../services/moderation';
import {
  CONTENT_REPORT_TARGET_TYPES,
  REPORT_DETAILS_MAX_LENGTH,
  isContentReportTargetType,
  isReasonAllowedForTarget,
  reasonsForTarget,
} from '@lantern/shared/moderation';

const router = Router();

let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

// Signature mirrors the other routers; reports are uncached.
export const initializeReportRoutes = (layer: DataLayer, _cache?: CacheService) => {
  dataLayer = layer;
};

export const validateCreateReport = [
  body('targetType')
    .isString()
    .custom((value) => isContentReportTargetType(value))
    .withMessage(`targetType must be one of ${CONTENT_REPORT_TARGET_TYPES.join(', ')}`),
  body('targetId').isUUID().withMessage('targetId must be a valid id'),
  body('reason')
    .isString()
    .custom((value, { req }) => {
      const targetType = req.body?.targetType;
      if (!isContentReportTargetType(targetType)) return true; // targetType rule reports it
      if (!isReasonAllowedForTarget(targetType, value)) {
        throw new Error(`reason must be one of ${reasonsForTarget(targetType).join(', ')} for a ${targetType}`);
      }
      return true;
    }),
  body('details')
    .optional({ values: 'null' })
    .isString()
    .isLength({ max: REPORT_DETAILS_MAX_LENGTH })
    .withMessage(`details must be at most ${REPORT_DETAILS_MAX_LENGTH} characters`),
];

/** Map the service's PublicError(+statusCode) to a response; rethrow the rest. */
export function respondReportError(res: any, err: unknown): boolean {
  if (err instanceof PublicError) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    res.status(typeof statusCode === 'number' ? statusCode : 400).json({
      success: false,
      error: clientErrorMessage(err),
    });
    return true;
  }
  return false;
}

// POST /api/v1/reports
router.post(
  '/',
  authMiddleware,
  publicWriteRateLimit,
  validateCreateReport,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const result = await getModerationService(dataLayer).createReport({
        reporterId: userId,
        targetType: req.body.targetType,
        targetId: req.body.targetId,
        reason: req.body.reason,
        details: req.body.details,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      if (respondReportError(res, err)) return;
      throw err;
    }
  }),
);

export default router;
