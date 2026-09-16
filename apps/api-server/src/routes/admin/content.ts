/**
 * Admin console: groups, messages, decks, offline bundles and the jobs board.
 *
 * Content removal is soft wherever a user might appeal
 * (`decks.removed_by_admin_at`, `groups.is_archived`) and hard only for
 * messages, which are deleted outright. All of them audit.
 *
 * Jobs postings and companies are handled by `services/jobsBoard` with
 * `{ asAdmin: true }`, which is what lets these routes bypass the owner
 * predicate the seller-facing routes enforce. Company verification is the gate
 * that lets a posting go live, so it is audited with its new status. The jobs
 * REPORT routes are not here — they are the generic report queue, in
 * ./moderation.
 *
 * Gotcha: the jobs service is imported dynamically inside each handler, as it
 * was before the split. `services/jobsBoard.ts` is 3,969 lines and pulling it
 * into the module graph at require time would cost every admin request.
 *
 * Mounted by ./index into the admin router; see that file for the mount stack,
 * the live platform-admin gate and the audit convention every mutating route
 * here obeys. Shared state and helpers come from ./context, the error mapping
 * from ./errors, and every database access from services/adminData — this file
 * performs none of its own.
 */
import { Router } from 'express';
import { logAdminAction } from '../../services/adminAudit';
import * as adminData from '../../services/adminData';
import { escapePostgrestSearch, supabaseService } from './context';
import { adminRoute } from './errors';

const router = Router();

// ===========================================================================
// Study and social content — groups, messages, decks, offline bundles
//
// Removal is soft where a user might appeal (`decks.removed_by_admin_at`,
// `groups.is_archived`) and hard only for messages. All of them audit.
// ===========================================================================

// GET /api/v1/admin/groups
router.get('/groups', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const search = (req.query.search as string)?.trim() || '';
  const offset = (page - 1) * limit;
  const { data, error, count } = await adminData.listGroupsForAdmin(supabaseService, {
    escapedSearch: search ? escapePostgrestSearch(search) : undefined,
    offset,
    limit,
  });
  if (error) throw error;
  res.json({ success: true, data: data || [], pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) } });
}));

// PATCH /api/v1/admin/groups/:id
router.patch('/groups/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { isArchived, reason } = req.body as { isArchived: boolean; reason?: string };
  const { error } = await adminData.setGroupArchived(supabaseService, id, isArchived === true);
  if (error) throw error;
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: isArchived ? 'group_archive' : 'group_suspend',
    targetType: 'group',
    targetId: id,
    reason,
  });
  res.json({ success: true, data: { id, is_archived: isArchived === true } });
}));

// GET /api/v1/admin/messages
router.get('/messages', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const groupId = (req.query.groupId as string) || '';
  const offset = (page - 1) * limit;
  const { data, error, count } = await adminData.listMessagesForAdmin(supabaseService, {
    groupId: groupId || undefined,
    offset,
    limit,
  });
  if (error) throw error;
  res.json({ success: true, data: data || [], pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) } });
}));

// DELETE /api/v1/admin/messages/:id
router.delete('/messages/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const { error } = await adminData.deleteMessage(supabaseService, id);
  if (error) throw error;
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'message_delete',
    targetType: 'message',
    targetId: id,
    reason,
  });
  res.json({ success: true });
}));

// GET /api/v1/admin/decks
router.get('/decks', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const search = (req.query.search as string)?.trim() || '';
  const offset = (page - 1) * limit;
  const { data, error, count } = await adminData.listDecksForAdmin(supabaseService, {
    escapedSearch: search ? escapePostgrestSearch(search) : undefined,
    offset,
    limit,
  });
  if (error) throw error;

  const deckIds = (data || []).map((d: any) => d.id);
  const cardCounts: Record<string, number> = {};
  if (deckIds.length) {
    const { data: cards } = await adminData.listFlashcardDeckIds(supabaseService, deckIds);
    for (const c of cards || []) {
      cardCounts[c.deck_id] = (cardCounts[c.deck_id] || 0) + 1;
    }
  }

  res.json({
    success: true,
    data: (data || []).map((d: any) => ({ ...d, card_count: cardCounts[d.id] || 0 })),
    pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
  });
}));

// DELETE /api/v1/admin/decks/:id
router.delete('/decks/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const { error } = await adminData.removeDeck(supabaseService, id, new Date().toISOString());
  if (error) throw error;
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'deck_remove',
    targetType: 'deck',
    targetId: id,
    reason,
  });
  res.json({ success: true });
}));

// GET /api/v1/admin/offline/summary
router.get('/offline/summary', adminRoute(async (req: any, res: any) => {
  // count:'exact' so the console can say "showing 50 of N" — the hard cap
  // used to be invisible, indistinguishable from a complete list.
  const { data: bundles, error, count } = await adminData.listOfflineBundles(supabaseService);
  if (error) throw error;

  const rows = bundles || [];
  const userIds = [...new Set(rows.map((b: { user_id: string }) => b.user_id).filter(Boolean))] as string[];
  let profileById: Record<string, { id: string; name?: string; username?: string }> = {};

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await adminData.getProfileSummaries(
      supabaseService,
      userIds
    );
    if (profileError) throw profileError;
    profileById = Object.fromEntries((profiles || []).map((p: { id: string; name?: string; username?: string }) => [p.id, p]));
  }

  res.json({
    success: true,
    data: rows.map((b: { user_id: string }) => ({
      ...b,
      owner: profileById[b.user_id] || null,
    })),
    pagination: { page: 1, limit: 50, total: count ?? rows.length, pages: Math.ceil((count ?? rows.length) / 50) || 1 },
  });
}));

// ===========================================================================
// Jobs board admin
//
// Postings and companies are handled by `services/jobsBoard` with
// `{ asAdmin: true }`, which is what lets these routes bypass the owner
// predicate the seller-facing routes enforce. Company verification is the
// gate that lets a posting go live, so it is audited with its new status.
// `GET/PATCH /jobs/reports` are a filtered view of the generic report queue
// above, kept in the shape the jobs console already reads.
// ===========================================================================

// ─── Jobs board admin ────────────────────────────────────────────────────────

router.get('/jobs/postings', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = (req.query.status as string) || '';
  const result = await getJobsBoardService(supabaseService).adminListPostings(page, limit, status || undefined);
  res.json({ success: true, ...result });
}));

router.patch('/jobs/postings/:id', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  const { status } = req.body as { status: string };
  const allowed = ['active', 'suspended_by_admin', 'removed_by_admin', 'closed', 'paused'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of ${allowed.join(', ')}` });
  }
  const posting = await getJobsBoardService(supabaseService).updatePosting(
    req.params.id,
    req.user.id,
    { status: status as 'active' | 'suspended_by_admin' | 'removed_by_admin' | 'closed' | 'paused' },
    { asAdmin: true }
  );
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: status === 'active' ? 'job_activate' : status === 'suspended_by_admin' ? 'job_suspend' : 'job_status',
    targetType: 'job_posting',
    targetId: req.params.id,
  });
  res.json({ success: true, data: posting });
}));

router.delete('/jobs/postings/:id', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  await getJobsBoardService(supabaseService).updatePosting(
    req.params.id,
    req.user.id,
    { status: 'removed_by_admin' },
    { asAdmin: true }
  );
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'job_remove',
    targetType: 'job_posting',
    targetId: req.params.id,
  });
  res.json({ success: true });
}));

router.get('/jobs/companies', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = (req.query.status as string) || '';
  const result = await getJobsBoardService(supabaseService).adminListCompanies(page, limit, status || undefined);
  res.json({ success: true, ...result });
}));

router.patch('/jobs/companies/:id/verification', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  const { status, note } = req.body as { status: 'verified' | 'rejected' | 'pending' | 'unverified'; note?: string };
  if (!['verified', 'rejected', 'pending', 'unverified'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid verification status' });
  }
  const company = await getJobsBoardService(supabaseService).setCompanyVerification(
    req.params.id,
    status,
    note
  );
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: 'job_company_verification',
    targetType: 'job_company',
    targetId: req.params.id,
    metadata: { status },
  });
  res.json({ success: true, data: company });
}));

router.patch('/jobs/postings/:id/school-approval', adminRoute(async (req: any, res: any) => {
  const { getJobsBoardService } = await import('../../services/jobsBoard');
  const approve = req.body?.approve !== false;
  const posting = await getJobsBoardService(supabaseService).schoolApprovePosting(req.params.id, approve);
  await logAdminAction(supabaseService, {
    actorId: req.user.id,
    action: approve ? 'job_school_approve' : 'job_school_reject',
    targetType: 'job_posting',
    targetId: req.params.id,
  });
  res.json({ success: true, data: posting });
}));

export default router;
