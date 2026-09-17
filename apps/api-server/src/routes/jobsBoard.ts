/**
 * Jobs board API — mounted at /api/v1/jobs-board
 * (distinct from async queue /api/v1/jobs)
 */
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { requireAuthUserId } from "../utils/requestAuth";
import { isLivePlatformAdmin } from "../utils/platformAdminAuth";
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { CacheService } from "../services/cache";
import {
  applicationStatusUpdateError,
  getJobsBoardService,
} from "../services/jobsBoard";
import { clientErrorMessage } from "../utils/safeError";
import {
  isJobEmploymentType,
  isJobPostingLinkVisible,
  type JobApplicationStatus,
} from "@lantern/shared/jobs";

const router = Router();

let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;
let cacheService: CacheService;

export const initializeJobsBoardRoutes = (
  layer: DataLayer,
  cache: CacheService,
) => {
  dataLayer = layer;
  cacheService = cache;
};

function jobs() {
  return getJobsBoardService(dataLayer);
}

/**
 * Postgres 22P02 (invalid_text_representation) is what a malformed `:id` in the
 * path looks like by the time it reaches us: the value never parses as a uuid,
 * so the query rejects it. Nothing is wrong on our side, so it must not be a 500.
 */
function isMalformedId(err: unknown): boolean {
  return (err as { code?: string })?.code === "22P02";
}

// Exported for the regression test covering the 22P02 → 400 mapping.
export function statusCode(err: unknown, fallback = 500): number {
  const code = (err as Error & { statusCode?: number })?.statusCode;
  if (typeof code === "number") return code;
  if (isMalformedId(err)) return 400;
  return fallback;
}

/**
 * `clientErrorMessage` collapses to "Something went wrong" in production, which
 * is right for a 500 and useless for a 400 — the caller can act on a bad id.
 */
export function errorMessage(err: unknown): string {
  if (isMalformedId(err)) return "Invalid id";
  return clientErrorMessage(err);
}

/**
 * Sponsored/featured placement is a paid promotion slot that also sorts
 * postings first — it must never be self-service. Only live platform admins
 * may set it; anyone else's values are dropped silently so a stray client
 * flag degrades to a normal posting instead of failing the whole create.
 * (Live lookup, not the cached JWT claim — see SEC-09 in middleware/auth.)
 */
// Exported for the regression test covering the sponsored-placement gate.
export async function sponsoredFieldsFor(
  userId: string,
  body: { isSponsored?: unknown; sponsoredUntil?: unknown },
): Promise<{ isSponsored?: boolean; sponsoredUntil?: string | null }> {
  if (body?.isSponsored == null && body?.sponsoredUntil === undefined) {
    return {};
  }
  if (await isLivePlatformAdmin(userId)) {
    return {
      isSponsored: body.isSponsored == null ? undefined : !!body.isSponsored,
      sponsoredUntil:
        body.sponsoredUntil === undefined
          ? undefined
          : (body.sponsoredUntil as string | null),
    };
  }
  return {};
}

// GET /postings
router.get(
  "/postings",
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const compensationKind = ["paid", "unpaid", "discuss"].includes(
      req.query.compensationKind,
    )
      ? req.query.compensationKind
      : undefined;
    const sort =
      req.query.sort === "closing"
        ? "closing"
        : req.query.sort === "newest"
          ? "newest"
          : "trending";
    const remote =
      req.query.remote === "true"
        ? true
        : req.query.remote === "false"
          ? false
          : undefined;
    const result = await jobs().listPostings({
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      search: (req.query.search as string) || undefined,
      employmentType: (req.query.employmentType as string) || undefined,
      campusId: (req.query.campusId as string) || undefined,
      companyOnly: req.query.companyOnly === "true",
      remote,
      compensationKind,
      minPay: Number(req.query.minPay) > 0 ? Number(req.query.minPay) : undefined,
      sort,
      sponsoredFirst: req.query.sponsoredFirst !== "false",
      viewerId: req.user?.id || null,
    });
    res.json({ success: true, ...result });
  }),
);

// GET /postings/:id
router.get(
  "/postings/:id",
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    // publicView: private ATS fields are stripped unless the viewer is the
    // poster or a member of the posting's company (the edit form's load path).
    const posting = await jobs().getPosting(req.params.id, {
      incrementViews: true,
      viewerId: req.user?.id || null,
      publicView: true,
    });
    // Drafts and moderated posts are owner-only; paused and closed stay
    // readable by link so past applicants can revisit them.
    if (
      !posting ||
      (!isJobPostingLinkVisible(posting.status) &&
        posting.posterUserId !== (req.user?.id || null))
    ) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    res.json({ success: true, data: posting });
  }),
);

// POST /postings
router.post(
  "/postings",
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
      engagementDuration,
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

    if (!title || typeof title !== "string" || !title.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "title is required" });
    }
    if (!isJobEmploymentType(employmentType)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid employmentType" });
    }

    const sponsored = await sponsoredFieldsFor(userId, {
      isSponsored,
      sponsoredUntil,
    });

    try {
      const posting = await jobs().createPosting(userId, {
        title,
        description: typeof description === "string" ? description : "",
        employmentType,
        campusId,
        campusIds,
        locationText,
        isRemote,
        compensation: compensation || { kind: "discuss" },
        engagementDuration: engagementDuration ?? null,
        deadline,
        applyMode,
        externalUrl,
        companyId,
        status,
        requiresSchoolApproval,
        screeningQuestions,
        isSponsored: sponsored.isSponsored,
        sponsoredUntil: sponsored.sponsoredUntil,
        atsProvider,
        atsExternalId,
        atsWebhookUrl,
      });
      await cacheService.deletePattern("jobs-board:postings:*");
      res.status(201).json({ success: true, data: posting });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// PATCH /postings/:id
router.patch(
  "/postings/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const updates = { ...(req.body || {}) };
    // Same gate as create: sponsored placement is admin-set only. Deleting the
    // keys (rather than nulling) also keeps an admin-featured posting featured
    // when its owner edits other fields.
    delete updates.isSponsored;
    delete updates.sponsoredUntil;
    const sponsored = await sponsoredFieldsFor(userId, req.body || {});
    if (sponsored.isSponsored !== undefined) updates.isSponsored = sponsored.isSponsored;
    if (sponsored.sponsoredUntil !== undefined) updates.sponsoredUntil = sponsored.sponsoredUntil;
    try {
      const posting = await jobs().updatePosting(
        req.params.id,
        userId,
        updates,
      );
      res.json({ success: true, data: posting });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /my-postings
router.get(
  "/my-postings",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyPostings(userId);
    res.json({ success: true, data });
  }),
);

// GET /analytics/employer — poster-wide hiring funnel
router.get(
  "/analytics/employer",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const cacheKey = `jobs:analytics:employer:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }
    const data = await jobs().getEmployerAnalytics(userId);
    await cacheService.set(cacheKey, data, 120);
    res.json({ success: true, data });
  }),
);

// GET /postings/:id/analytics — per-job funnel for the pipeline screen
router.get(
  "/postings/:id/analytics",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().getPostingAnalytics(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// ─── Applicant profile + resumes ───────────────────────────────────────────

// GET /applicant-profile
router.get(
  "/applicant-profile",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().getApplicantProfile(userId);
    res.json({ success: true, data });
  }),
);

// PUT /applicant-profile
router.put(
  "/applicant-profile",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { headline, phone, locationText } = req.body || {};
    try {
      const data = await jobs().saveApplicantProfile(userId, {
        headline,
        phone,
        locationText,
      });
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /resume/upload-url — mint a direct-to-storage upload target
router.post(
  "/resume/upload-url",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { filename, sizeBytes } = req.body || {};
    if (!filename || typeof filename !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "filename is required" });
    }
    try {
      const data = await jobs().createResumeUploadUrl(userId, {
        filename,
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
      });
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /resume — attach an uploaded object to the caller's profile
router.post(
  "/resume",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { path, filename, sizeBytes } = req.body || {};
    if (!path || typeof path !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "path is required" });
    }
    try {
      const data = await jobs().attachResumeToProfile(userId, {
        path,
        filename: typeof filename === "string" ? filename : "",
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
      });
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /applications/:id/resume — signed link for the applicant or the employer
router.get(
  "/applications/:id/resume",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().getApplicationResumeUrl(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// ─── Private recruiter notes ───────────────────────────────────────────────

// GET /applications/:id/notes — hiring side only
router.get(
  "/applications/:id/notes",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listApplicationNotes(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /applications/:id/notes
router.post(
  "/applications/:id/notes",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { body } = req.body || {};
    if (typeof body !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "Note text is required" });
    }
    try {
      const data = await jobs().createApplicationNote(
        req.params.id,
        userId,
        body,
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// DELETE /application-notes/:id — author only
router.delete(
  "/application-notes/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().deleteApplicationNote(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// ─── Interviews ────────────────────────────────────────────────────────────

// GET /applications/:id/interviews — visible to both sides
router.get(
  "/applications/:id/interviews",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listApplicationInterviews(
        req.params.id,
        userId,
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /applications/:id/interviews — employer proposes times
router.post(
  "/applications/:id/interviews",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().scheduleInterview(
        req.params.id,
        userId,
        req.body || {},
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /my-interviews — candidate's own interviews
router.get(
  "/my-interviews",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyInterviews(userId);
    res.json({ success: true, data });
  }),
);

// PATCH /interviews/:id — employer reschedules, cancels, or completes
router.patch(
  "/interviews/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { status, ...rest } = req.body || {};
    try {
      if (status === "cancelled" || status === "completed") {
        const data = await jobs().updateInterviewStatus(
          req.params.id,
          userId,
          status,
        );
        return res.json({ success: true, data });
      }
      const data = await jobs().rescheduleInterview(
        req.params.id,
        userId,
        rest,
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /interviews/:id/respond — candidate accepts a slot or declines
router.post(
  "/interviews/:id/respond",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { action, slot } = req.body || {};
    if (action !== "accept" && action !== "decline") {
      return res
        .status(400)
        .json({ success: false, error: "action must be accept or decline" });
    }
    try {
      const data = await jobs().respondToInterview(
        req.params.id,
        userId,
        action,
        slot,
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// ─── Offers ────────────────────────────────────────────────────────────────

// GET /applications/:id/offers — visible to both sides
router.get(
  "/applications/:id/offers",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listApplicationOffers(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /applications/:id/offers — employer sends an offer
router.post(
  "/applications/:id/offers",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().sendOffer(
        req.params.id,
        userId,
        req.body || {},
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /my-offers — candidate's own offers
router.get(
  "/my-offers",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyOffers(userId);
    res.json({ success: true, data });
  }),
);

// PATCH /offers/:id — employer withdraws an unanswered offer
router.patch(
  "/offers/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { status } = req.body || {};
    if (status !== "withdrawn") {
      return res.status(400).json({
        success: false,
        error: "Only withdrawing an offer is supported",
      });
    }
    try {
      const data = await jobs().withdrawOffer(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /offers/:id/respond — candidate accepts or declines
router.post(
  "/offers/:id/respond",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { action, declineReason } = req.body || {};
    if (action !== "accept" && action !== "decline") {
      return res
        .status(400)
        .json({ success: false, error: "action must be accept or decline" });
    }
    try {
      const data = await jobs().respondToOffer(
        req.params.id,
        userId,
        action,
        declineReason,
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err, 400))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// ─── Saved searches ────────────────────────────────────────────────────────

// GET /saved-searches
router.get(
  "/saved-searches",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listSavedSearches(userId);
    res.json({ success: true, data });
  }),
);

// POST /saved-searches
router.post(
  "/saved-searches",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().createSavedSearch(userId, {
        name: req.body?.name,
        filters: req.body?.filters,
        notify: req.body?.notify,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// PATCH /saved-searches/:id
router.patch(
  "/saved-searches/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().updateSavedSearch(req.params.id, userId, {
        name: req.body?.name,
        filters: req.body?.filters,
        notify: req.body?.notify,
      });
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// DELETE /saved-searches/:id
router.delete(
  "/saved-searches/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().deleteSavedSearch(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /saved — postings the caller bookmarked
router.get(
  "/saved",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listSavedPostings(userId);
    res.json({ success: true, data });
  }),
);

// GET /saved-searches/:id/matches — new postings since last check (job alerts badge)
router.get(
  "/saved-searches/:id/matches",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().savedSearchMatches(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// PUT /postings/:id/save
router.put(
  "/postings/:id/save",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().savePosting(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// DELETE /postings/:id/save
router.delete(
  "/postings/:id/save",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().unsavePosting(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /postings/:id/apply — Express / Easy Apply
router.post(
  "/postings/:id/apply",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const result = await jobs().expressApply(req.params.id, userId, {
        message: req.body?.message,
        answers: req.body?.answers,
        resumeUrl: req.body?.resumeUrl,
        resumePath: req.body?.resumePath,
        resumeFilename: req.body?.resumeFilename,
      });
      res.status(result.existing ? 200 : 201).json({
        success: true,
        data: result.application,
        threadId: result.threadId,
        existing: result.existing,
      });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /postings/:id/external-apply — track click + return URL
router.post(
  "/postings/:id/external-apply",
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const result = await jobs().trackExternalApply(
        req.params.id,
        req.user?.id || null,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /my-applications
router.get(
  "/my-applications",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyApplications(userId);
    res.json({ success: true, data });
  }),
);

// GET /postings/:id/applications — poster/employer pipeline
router.get(
  "/postings/:id/applications",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listApplicantsForPosting(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// GET /postings/:id/applications/export — CSV of applicants
router.get(
  "/postings/:id/applications/export",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().exportApplicantsCsv(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /postings/:id/applications/bulk-status — move many candidates at once
router.post(
  "/postings/:id/applications/bulk-status",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { applicationIds, status } = req.body || {};
    try {
      const data = await jobs().bulkUpdateApplicationStatus(
        req.params.id,
        userId,
        applicationIds,
        status,
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// PATCH /applications/:id/status
router.patch(
  "/applications/:id/status",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { status, asApplicant } = req.body || {};
    if (!status || typeof status !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "status is required" });
    }
    // Whitelist: only real application statuses, and employers cannot set the
    // candidate-owned ones (withdrawn / interested / chatting).
    const statusProblem = applicationStatusUpdateError(status, {
      asApplicant: !!asApplicant,
    });
    if (statusProblem) {
      return res.status(400).json({ success: false, error: statusProblem });
    }
    try {
      const data = await jobs().updateApplicationStatus(
        req.params.id,
        userId,
        status as JobApplicationStatus,
        {
          asApplicant: !!asApplicant,
        },
      );
      res.json({ success: true, data });
    } catch (err) {
      res
        .status(statusCode(err))
        .json({ success: false, error: errorMessage(err) });
    }
  }),
);

// POST /postings/:id/reports
router.post(
  "/postings/:id/reports",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { isJobReportReason } = await import("@lantern/shared/jobs");
    const reason = req.body?.reason || "other";
    if (!isJobReportReason(reason)) {
      return res.status(400).json({ success: false, error: "Invalid reason" });
    }
    // New reports land in the generic content_reports table (target_type
    // 'job_posting'); the legacy job_reports table is read-only history
    // (backfilled by migration 20260822140000). Duplicate reports stay
    // idempotent for old clients (201 with the existing state, no 409).
    const { getModerationService, isMissingRelationError } = await import(
      "../services/moderation"
    );
    try {
      const data = await getModerationService(legacyService()).createReport({
        reporterId: userId,
        targetType: "job_posting",
        targetId: req.params.id,
        reason,
        details: req.body?.details,
      });
      res.status(201).json({ success: true, data });
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(201).json({ success: true, data: { status: "pending", duplicate: true } });
      }
      if (err?.statusCode === 404) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err?.statusCode === 503 || isMissingRelationError(err)) {
        // Migration not applied yet: keep the old path alive.
        const data = await jobs().reportPosting(req.params.id, userId, reason, req.body?.details);
        return res.status(201).json({ success: true, data });
      }
      throw err;
    }
  }),
);

// ─── Companies ─────────────────────────────────────────────────────────────

router.post(
  "/companies",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { legalName, displayName, website, industry, verificationDomain } =
      req.body || {};
    if (!legalName || !displayName) {
      return res.status(400).json({
        success: false,
        error: "legalName and displayName are required",
      });
    }
    const data = await jobs().createCompany(userId, {
      legalName,
      displayName,
      website,
      industry,
      verificationDomain,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/companies/mine",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await jobs().listMyCompanies(userId);
    res.json({ success: true, data });
  }),
);

router.get(
  "/companies/:id",
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const data = await jobs().getCompany(req.params.id);
    if (!data)
      return res
        .status(404)
        .json({ success: false, error: "Company not found" });
    res.json({ success: true, data });
  }),
);

router.get(
  "/companies/:id/profile",
  optionalAuthMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const data = await jobs().getCompanyPublicProfile(
        req.params.id,
        req.user?.id || null,
      );
      res.json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

router.patch(
  "/companies/:id",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().updateCompany(req.params.id, userId, {
        displayName: req.body?.displayName,
        website: req.body?.website,
        industry: req.body?.industry,
        tagline: req.body?.tagline,
        about: req.body?.about,
        hqLocation: req.body?.hqLocation,
        verificationDomain: req.body?.verificationDomain,
      });
      res.json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

router.post(
  "/companies/:id/logo",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().uploadCompanyLogo(req.params.id, userId, {
        base64Data: req.body?.base64Data || req.body?.data || "",
        fileName: req.body?.fileName,
      });
      res.json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

router.get(
  "/companies/:id/members",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().listCompanyMembers(req.params.id, userId);
      res.json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

router.post(
  "/companies/:id/members",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().inviteCompanyMember(req.params.id, userId, {
        username: req.body?.username,
        role: req.body?.role,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

router.delete(
  "/companies/:id/members/:userId",
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await jobs().removeCompanyMember(
        req.params.id,
        userId,
        req.params.userId,
      );
      res.json({ success: true, data });
    } catch (err) {
      return res.status(statusCode(err, 500)).json({
        success: false,
        error: errorMessage(err),
      });
    }
  }),
);

// Templates / intents (Phase 0 surface for create UX)
router.get(
  "/templates",
  asyncHandler(async (_req: any, res: any) => {
    const {
      JOB_INTENT_TEMPLATES,
      JOB_INTENT_TEMPLATE_GROUPS,
      JOBS_SCAM_PLAYBOOK_SUMMARY,
      JOB_EMPLOYMENT_TYPE_LABELS,
    } = await import("@lantern/shared/jobs");
    res.json({
      success: true,
      data: {
        templates: JOB_INTENT_TEMPLATES,
        templateGroups: JOB_INTENT_TEMPLATE_GROUPS,
        scamPlaybook: JOBS_SCAM_PLAYBOOK_SUMMARY,
        employmentTypeLabels: JOB_EMPLOYMENT_TYPE_LABELS,
      },
    });
  }),
);

/**
 * Router-scoped error handler. Most routes guard their own service calls and
 * map the error through statusCode(), but three don't — GET /postings/:id,
 * GET /companies/:id and POST /postings/:id/reports — and asyncHandler forwards
 * their rejections straight to the global handler, which answers 500. That made
 * the malformed-uuid fix look route-shaped when it isn't: catching it here means
 * a bad :id is a 400 everywhere in this router, including routes added later.
 * Everything else passes through untouched.
 */
router.use((err: any, _req: any, res: any, next: any) => {
  if (!isMalformedId(err)) return next(err);
  res.status(400).json({ success: false, error: errorMessage(err) });
});

export default router;
