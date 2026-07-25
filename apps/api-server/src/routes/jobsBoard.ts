/**
 * Jobs board API — mounted at /api/v1/jobs-board
 * (distinct from async queue /api/v1/jobs)
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { requireAuthUserId } from '../utils/requestAuth';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { getJobsBoardService } from '../services/jobsBoard';
import { clientErrorMessage } from '../utils/safeError';
import { isJobEmploymentType, type JobApplicationStatus } from '@lantern/shared/jobs';

const router = Router();

let supabaseService: SupabaseService;
let cacheService: CacheService;

export const initializeJobsBoardRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

function jobs() {
  return getJobsBoardService(supabaseService);
}

function statusCode(err: unknown, fallback = 500): number {
  const code = (err as Error & { statusCode?: number })?.statusCode;
  return typeof code === 'number' ? code : fallback;
}

// GET /postings
router.get(
  '/postings',
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const result = await jobs().listPostings({
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      search: (req.query.search as string) || undefined,
      employmentType: (req.query.employmentType as string) || undefined,
      campusId: (req.query.campusId as string) || undefined,
      companyOnly: req.query.companyOnly === 'true',
      sponsoredFirst: req.query.sponsoredFirst !== 'false',
    });
    res.json({ success: true, ...result });
  })
);

// GET /postings/:id
router.get(
  '/postings/:id',
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const posting = await jobs().getPosting(req.params.id, { incrementViews: true });
    if (!posting || ['removed_by_admin', 'suspended_by_admin', 'draft'].includes(posting.status)) {
      if (!posting || posting.status === 'removed_by_admin') {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }
      const userId = req.user?.id;
      if (posting.status === 'draft' && posting.posterUserId !== userId) {
        return res.status(404).json({ success: false, error: 'Job not found' });
      }
    }
    res.json({ success: true, data: posting });
  })
);

// POST /postings
router.post(
  '/postings',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const {
      title,
      description,
      employmentType,
      campusId,
      campusIds,
      locationText,
      isRemote,
      compensation,
      deadline,
      applyMode,
      externalUrl,
      companyId,
      status,
      requiresSchoolApproval,
      screeningQuestions,
      isSponsored,
      sponsoredUntil,
      atsProvider,
      atsExternalId,
      atsWebhookUrl,
    } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    if (!isJobEmploymentType(employmentType)) {
      return res.status(400).json({ success: false, error: 'Invalid employmentType' });
    }

    try {
      const posting = await jobs().createPosting(userId, {
        title,
        description: typeof description === 'string' ? description : '',
        employmentType,
        campusId,
        campusIds,
        locationText,
        isRemote,
        compensation: compensation || { kind: 'discuss' },
        deadline,
        applyMode,
        externalUrl,
        companyId,
        status,
        requiresSchoolApproval,
        screeningQuestions,
        isSponsored,
        sponsoredUntil,
        atsProvider,
        atsExternalId,
        atsWebhookUrl,
      });
      await cacheService.deletePattern('jobs-board:postings:*');
      res.status(201).json({ success: true, data: posting });
    } catch (err) {
      res.status(statusCode(err, 400)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// PATCH /postings/:id
router.patch(
  '/postings/:id',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const posting = await jobs().updatePosting(req.params.id, userId, req.body || {});
      res.json({ success: true, data: posting });
    } catch (err) {
      res.status(statusCode(err)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// GET /my-postings
router.get(
  '/my-postings',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyPostings(userId);
    res.json({ success: true, data });
  })
);

// POST /postings/:id/apply — Express / Easy Apply
router.post(
  '/postings/:id/apply',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const result = await jobs().expressApply(req.params.id, userId, {
        message: req.body?.message,
        answers: req.body?.answers,
        resumeUrl: req.body?.resumeUrl,
      });
      res.status(result.existing ? 200 : 201).json({
        success: true,
        data: result.application,
        threadId: result.threadId,
        existing: result.existing,
      });
    } catch (err) {
      res.status(statusCode(err)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// POST /postings/:id/external-apply — track click + return URL
router.post(
  '/postings/:id/external-apply',
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const result = await jobs().trackExternalApply(req.params.id, req.user?.id || null);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(statusCode(err)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// GET /my-applications
router.get(
  '/my-applications',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyApplications(userId);
    res.json({ success: true, data });
  })
);

// GET /postings/:id/applications — poster/employer pipeline
router.get(
  '/postings/:id/applications',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listApplicantsForPosting(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(statusCode(err)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// PATCH /applications/:id/status
router.patch(
  '/applications/:id/status',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { status, asApplicant } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ success: false, error: 'status is required' });
    }
    try {
      const data = await jobs().updateApplicationStatus(
        req.params.id,
        userId,
        status as JobApplicationStatus,
        {
          asApplicant: !!asApplicant,
        }
      );
      res.json({ success: true, data });
    } catch (err) {
      res.status(statusCode(err)).json({ success: false, error: clientErrorMessage(err) });
    }
  })
);

// POST /postings/:id/reports
router.post(
  '/postings/:id/reports',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const reason = req.body?.reason || 'other';
    const allowed = ['scam', 'spam', 'inappropriate', 'discriminatory', 'other'];
    if (!allowed.includes(reason)) {
      return res.status(400).json({ success: false, error: 'Invalid reason' });
    }
    const data = await jobs().reportPosting(req.params.id, userId, reason, req.body?.details);
    res.status(201).json({ success: true, data });
  })
);

// ─── Companies ─────────────────────────────────────────────────────────────

router.post(
  '/companies',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { legalName, displayName, website, industry, verificationDomain } = req.body || {};
    if (!legalName || !displayName) {
      return res.status(400).json({ success: false, error: 'legalName and displayName are required' });
    }
    const data = await jobs().createCompany(userId, {
      legalName,
      displayName,
      website,
      industry,
      verificationDomain,
    });
    res.status(201).json({ success: true, data });
  })
);

router.get(
  '/companies/mine',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyCompanies(userId);
    res.json({ success: true, data });
  })
);

router.get(
  '/companies/:id',
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const data = await jobs().getCompany(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Company not found' });
    res.json({ success: true, data });
  })
);

// Templates / intents (Phase 0 surface for create UX)
router.get(
  '/templates',
  asyncHandler(async (_req: any, res: any) => {
    const { CAMPUS_JOB_INTENT_TEMPLATES, JOBS_SCAM_PLAYBOOK_SUMMARY, JOB_EMPLOYMENT_TYPE_LABELS } =
      await import('@lantern/shared/jobs');
    res.json({
      success: true,
      data: {
        templates: CAMPUS_JOB_INTENT_TEMPLATES,
        scamPlaybook: JOBS_SCAM_PLAYBOOK_SUMMARY,
        employmentTypeLabels: JOB_EMPLOYMENT_TYPE_LABELS,
      },
    });
  })
);

export default router;
