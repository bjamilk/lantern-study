/**
 * Admin console: marketplace moderation, the report queue and appeals.
 *
 * Listing removal and restore go through `services/moderation` rather than a
 * bare status update, because both carry state beyond `status`: a takedown
 * also writes `rights_status`/`takedown_*` and notifies the seller with
 * `force: true` so they can appeal, and a restore derives the real status
 * rather than blindly re-listing an item that was reserved or sold before it
 * was removed. Every mutation invalidates the listing caches.
 *
 * `PATCH /marketplace/orders/:id/dispute` moves money — it either releases
 * escrow to the seller or refunds the buyer — so it is audited with the order
 * amount and both party ids in `metadata`.
 *
 * One generic queue over `content_reports` serves every target type, with the
 * pre-Phase-1 console's shapes kept alive by aliasing rather than by a second
 * code path: `status: 'open'` normalises to `pending`, the actions
 * `remove_listing` and `warn_seller` map to `remove_content` and `warn`, and
 * `adminNote` maps to `note`. `GET /jobs/reports` is the same queue filtered
 * to `target_type: 'job_posting'`, in the shape the jobs console reads.
 *
 * These are the routes registered with `moderationRoute`, so a service
 * `PublicError` keeps its own status instead of becoming a 500.
 *
 * Mounted by ./index into the admin router; see that file for the mount stack,
 * the live platform-admin gate and the audit convention every mutating route
 * here obeys. Shared state and helpers come from ./context, the error mapping
 * from ./errors, and every database access from services/adminData — this file
 * performs none of its own.
 */
import { Router } from 'express';
import { handleValidationErrors, validateUuidParam } from '../../middleware/validation';
import { logAdminAction } from '../../services/adminAudit';
import { getModerationService } from '../../services/moderation';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../../services/marketplaceOrders';
import * as adminData from '../../services/adminData';
import { invalidateListingCaches } from '../../utils/marketplaceCache';
import { logger } from '../../utils/logger';
import { isMarketplaceListingModerated } from '@lantern/shared/marketplace';
import { cacheService, dataLayer, normalizeReportStatus, supabaseService } from './context';
import { adminRoute, mappedRoute, moderationRoute, respondDisputeError } from './errors';

const router = Router();


// ===========================================================================
// Marketplace moderation — listings, orders, disputes
//
// Listing removal and restore go through `services/moderation` rather than a
// bare status update, because both carry state beyond `status`: a takedown
// also writes `rights_status`/`takedown_*` and notifies the seller with
// `force: true` so they can appeal, and a restore derives the real status
// rather than blindly re-listing an item that was reserved or sold before it
// was removed. Every mutation invalidates the listing caches.
//
// `PATCH /marketplace/orders/:id/dispute` moves money — it either releases
// escrow to the seller or refunds the buyer — so it is audited with the order
// amount and both party ids in `metadata`.
// ===========================================================================

router.get('/marketplace/listings', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = (req.query.status as string) || '';
  const offset = (page - 1) * limit;

  const { data, error, count } = await adminData.listListingsForAdmin(dataLayer, {
    status: status || undefined,
    offset,
    limit,
  });
  if (error) throw error;

  res.json({
    success: true,
    data: data || [],
    pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
  });
}));

router.delete('/marketplace/listings/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Removed by Lantern moderation';
  // One write sets status removed_by_admin AND the takedown columns
  // (rights_status 'takedown', takedown_reason/at/by) and notifies the seller
  // force:true, so the seller sees why and can appeal from My Listings.
  const removed = await getModerationService(supabaseService).takedownListing(id, {
    reason,
    actorId: req.user.id,
  });
  if (!removed) return res.status(404).json({ success: false, error: 'Listing not found' });

  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'listing_remove',
    targetType: 'listing',
    targetId: id,
    reason,
  });

  await invalidateListingCaches(cacheService, id);
  await cacheService.deletePattern('marketplace:listings:*');

  res.json({ success: true });
}));

router.patch('/marketplace/listings/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { status } = req.body as { status: 'active' | 'suspended_by_admin' };

  if (!['active', 'suspended_by_admin'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be active or suspended_by_admin' });
  }

  const { data: current } = await adminData.getListingForModeration(dataLayer, id);
  if (!current) return res.status(404).json({ success: false, error: 'Listing not found' });

  const moderation = getModerationService(supabaseService);
  // Restoring from a takedown must not blindly re-list a unique item that was
  // reserved/sold before it was removed (double-sell) — derive the real status.
  const statusToWrite =
    status === 'active' && isMarketplaceListingModerated(current.status)
      ? await moderation.resolveRestoredListingStatus(id)
      : status;

  const { error } = await adminData.setListingStatus(dataLayer, id, statusToWrite);
  if (error) throw error;

  // Restoring a listing outside the appeal flow clears its takedown state
  // (rights_status 'cleared'); suspending records the reason for the seller.
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (status === 'active' && isMarketplaceListingModerated(current.status)) {
    await moderation.clearListingTakedown(id).catch((e) => logger.warn('clearListingTakedown failed', { id, e }));
  } else if (status === 'suspended_by_admin' && current.status !== 'suspended_by_admin') {
    await adminData
      .setListingUnderReview(dataLayer, id, {
        reason: reason || 'Suspended pending Lantern review',
        at: new Date().toISOString(),
        by: req.user.id,
      })
      .then(({ error: e }: { error?: unknown }) => e && logger.warn('suspend takedown fields failed', { id, e }));
    await supabaseService
      .createNotification(current.user_id, {
        type: 'warning',
        message: `Your listing "${current.title}" was suspended by Lantern moderation and is hidden from buyers while we review it.${reason ? ` Reason: ${reason}.` : ''} You can appeal once from My Listings.`,
        link: `marketplace:listing:${id}`,
        data: { listingId: id, kind: 'listing_suspended' },
        force: true,
      })
      .catch((e) => logger.warn('suspend notification failed', { id, e }));
  }

  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: status === 'active' ? 'listing_activate' : 'listing_suspend',
    targetType: 'listing',
    targetId: id,
    reason: reason || undefined,
  });

  await invalidateListingCaches(cacheService, id);
  await cacheService.deletePattern('marketplace:listings:*');

  res.json({ success: true, data: { id, status } });
}));

router.get('/marketplace/orders', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = (req.query.status as string) || 'disputed';

  const { data, total } = await getMarketplaceOrdersService(supabaseService).getOrdersForAdmin({
    status,
    page,
    limit,
  });

  res.json({
    success: true,
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

router.patch('/marketplace/orders/:id/dispute', mappedRoute(respondDisputeError, async (req: any, res: any) => {
  const { id } = req.params;
  const { resolution, note } = req.body as {
    resolution?: 'release_to_seller' | 'refund_buyer';
    note?: string;
  };

  if (!resolution || !['release_to_seller', 'refund_buyer'].includes(resolution)) {
    return res.status(400).json({
      success: false,
      error: 'resolution must be release_to_seller or refund_buyer',
    });
  }

  const order = await getMarketplaceOrdersService(supabaseService).resolveDisputeAsAdmin(
    id,
    resolution,
    note,
    req.user.id
  );

  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action:
      resolution === 'release_to_seller'
        ? 'order_dispute_release_seller'
        : 'order_dispute_refund_buyer',
    targetType: 'marketplace_order',
    targetId: id,
    reason: note?.trim() || undefined,
    metadata: {
      resolution,
      listingId: order.listing_id,
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      amount: order.amount,
    },
  });

  await invalidateListingCaches(cacheService, order.listing_id);
  await cacheService.deletePattern('marketplace:listings:*');
  await invalidateSellerAnalyticsCache(order.seller_id);

  res.json({ success: true, data: order });
}));

// ===========================================================================
// Report queue and appeals
//
// One generic queue over `content_reports` for every target type, with the
// pre-Phase-1 console's shapes kept alive by aliasing rather than by a second
// code path: `status: 'open'` normalises to `pending`, the actions
// `remove_listing` and `warn_seller` map to `remove_content` and `warn`, and
// `adminNote` maps to `note`. `GET /jobs/reports` further below is the same
// queue filtered to `target_type: 'job_posting'`.
//
// These routes are the ones that use `respondModerationError`, so a service
// `PublicError` keeps its own status instead of becoming a 500.
// ===========================================================================

// GET /api/v1/admin/reports?status&targetType&page&limit — generic content
// report queue (content_reports; Phase 1 · E). Each row carries a `target`
// summary (title / status / owner) resolved per target type, plus the legacy
// `listing` / `listing_id` aliases for listing targets so the existing console
// keeps rendering.
router.get('/reports', moderationRoute(async (req: any, res: any) => {
  const result = await getModerationService(supabaseService).listReports({
    status: normalizeReportStatus((req.query.status as string) || 'open'),
    targetType: (req.query.targetType as string) || undefined,
    page: parseInt(req.query.page as string) || 1,
    limit: parseInt(req.query.limit as string) || 20,
  });
  res.json({ success: true, ...result });
}));

// PUT /api/v1/admin/reports/:id { action: dismiss|under_review|warn|remove_content|strike, note?, severity? }
// Legacy aliases from the pre-E console still work: remove_listing → remove_content,
// warn_seller → warn, adminNote → note.
router.put('/reports/:id', validateUuidParam('id'), handleValidationErrors, moderationRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const body = (req.body || {}) as { action?: string; note?: string; adminNote?: string; severity?: unknown };
  const legacy: Record<string, string> = { remove_listing: 'remove_content', warn_seller: 'warn' };
  const action = typeof body.action === 'string' ? legacy[body.action] ?? body.action : body.action;
  const note = body.note ?? body.adminNote;

  const result = await getModerationService(supabaseService).applyReportAction(
    id,
    { action, note, severity: body.severity },
    req.user.id
  );

  if (result.action === 'remove_content') {
    // Listing takedowns change what the public sees.
    const { data: report } = await adminData.getReportTarget(dataLayer, id);
    if (report && (report.target_type === 'listing' || report.target_type === 'question_bank')) {
      await invalidateListingCaches(cacheService, String(report.target_id));
      await cacheService.deletePattern('marketplace:listings:*');
    }
  }

  res.json({ success: true, data: { ...result, warned: result.action === 'warn' } });
}));

// GET /api/v1/admin/appeals — listings whose seller appealed a takedown
router.get('/appeals', moderationRoute(async (_req: any, res: any) => {
  const data = await getModerationService(supabaseService).listAppeals();
  res.json({ success: true, data });
}));

// PUT /api/v1/admin/marketplace/listings/:id/appeal { decision: upheld|reversed, note? }
router.put('/marketplace/listings/:id/appeal', validateUuidParam('id'), handleValidationErrors, moderationRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const result = await getModerationService(supabaseService).decideAppeal(
    id,
    req.body?.decision,
    req.body?.note,
    req.user.id
  );
  if (result.appeal_status === 'reversed') {
    await invalidateListingCaches(cacheService, id);
    await cacheService.deletePattern('marketplace:listings:*');
  }
  res.json({ success: true, data: result });
}));

// Thin job-posting filter over the generic queue (content_reports, target_type
// 'job_posting'; legacy job_reports rows were backfilled). Keeps the shape the
// jobs admin console reads (`posting: { id, title, status }`).
router.get('/jobs/reports', moderationRoute(async (req: any, res: any) => {
  const status = (req.query.status as string) || 'pending';
  const result = await getModerationService(supabaseService).listReports({
    status,
    targetType: 'job_posting',
    page: parseInt(req.query.page as string) || 1,
    limit: Math.min(100, parseInt(req.query.limit as string) || 100),
  });
  const data = result.data.map((r) => ({
    ...r,
    posting_id: r.target_id,
    posting: r.target?.exists
      ? { id: r.target.id, title: r.target.title ?? '', status: r.target.status ?? '' }
      : null,
  }));
  res.json({ success: true, data, pagination: result.pagination });
}));

router.patch('/jobs/reports/:id', validateUuidParam('id'), handleValidationErrors, moderationRoute(async (req: any, res: any) => {
  const { status, note } = req.body as { status: 'resolved' | 'dismissed'; note?: string };
  if (!['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be resolved or dismissed' });
  }
  // dismissed = closed as not actionable (generic dismiss action, audited);
  // resolved = reviewed, no automatic action on the posting (the jobs tools
  // handle suspend/remove) — mark resolved + audit.
  if (status === 'dismissed') {
    const result = await getModerationService(supabaseService).applyReportAction(
      req.params.id,
      { action: 'dismiss', note },
      req.user.id
    );
    return res.json({ success: true, data: result });
  }
  const { data: updated, error } = await adminData.resolveReport(dataLayer, req.params.id, {
    note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
    resolvedBy: req.user.id,
    resolvedAt: new Date().toISOString(),
  });
  if (error) throw error;
  if (!updated) return res.status(404).json({ success: false, error: 'Report not found' });
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'report_resolve',
    targetType: 'report',
    targetId: req.params.id,
    reason: typeof note === 'string' ? note : undefined,
  });
  res.json({ success: true, data: { action: 'resolve', status: 'resolved' } });
}));

export default router;
