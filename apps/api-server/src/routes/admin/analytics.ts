/**
 * Admin console: dashboard, analytics, activity feed and audit log.
 *
 * Read-only, so none of these routes audit — `GET /audit` READS the trail that
 * the mutating routes elsewhere write. Every aggregation runs in Node over a
 * capped row scan (`ROW_LIMIT`), and the ones that can be truncated say so in
 * the payload: a silently short answer here would read as a real drop in usage.
 * `GET /audit` degrades to `{data: [], tableReady: false}` when
 * `admin_audit_log` has not been migrated yet, so an un-migrated environment
 * still gets a working console.
 *
 * Gotcha: `GET /ai/provider-probe` bills one real completion against a live AI
 * provider. It is the only route in the whole console that spends money on
 * being called.
 *
 * Mounted by ./index into the admin router; see that file for the mount stack,
 * the live platform-admin gate and the audit convention every mutating route
 * here obeys. Shared state and helpers come from ./context, the error mapping
 * from ./errors, and every database access from services/adminData — this file
 * performs none of its own.
 */
import { Router } from 'express';
import { probeProvider, getProviderStatus } from '../../services/aiService';
import { aggregateAiTokenRows, aggregateProductEventRows } from '../../services/adminAggregations';
import * as adminData from '../../services/adminData';
import { dataLayer, supabaseService } from './context';
import {
  AI_EVENT_ESTIMATED_COST_USD,
  daysAgoIso,
  getAuthUserInfoForUserIds,
  resolveRoleManagementEnabled,
  startOfDayIso,
} from './context';
import { adminRoute } from './errors';

const router = Router();


// ===========================================================================
// Dashboard — probe, stats
//
// `GET /stats` is one Promise.all of head-only `count: 'exact'` queries plus
// two bounded scans, so the console's landing page is a single round trip.
// Cost figures prefer real `ai_inference_log` token totals and fall back to
// an events-times-flat-guess only for windows recorded before token logging
// existed; the blended rate is env-tunable because it is pricing, not code.
// ===========================================================================

// GET /api/v1/admin/ai/provider-probe?provider=fireworks
// Sends one real request to a single AI provider so a newly added key can be
// checked without waiting for the fallback chain to reach it in production.
// Admin-only and rate-limited at mount time; it bills one tiny completion.
router.get('/ai/provider-probe', adminRoute(async (req: any, res: any) => {
  const requested = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
  if (!requested) {
    res.status(400).json({
      success: false,
      error: 'provider query parameter is required',
      knownProviders: getProviderStatus().map((p) => p.name),
    });
    return;
  }

  const result = await probeProvider(requested);
  // 200 with ok:false — the probe ran and produced a verdict. A non-2xx here
  // would be ambiguous with the probe endpoint itself failing.
  res.json({ success: true, data: result });
}));

// GET /api/v1/admin/stats
router.get('/stats', adminRoute(async (req: any, res: any) => {
  const todayStart = startOfDayIso();
  const last7d = daysAgoIso(7);
  const last24h = daysAgoIso(1);

  const {
    userCount,
    listingCount,
    activeListingCount,
    reportCount,
    aiEventCount,
    newUsersToday,
    reportsResolved7d,
    aiEventsLast7d,
    groupCount,
    messageCount24h,
    deckCount,
    offlineBundleCount,
    openDisputeCount,
  } = await adminData.getDashboardCounts(dataLayer, { todayStart, last7d, last24h });

  // Distinct study_activity users in the last 7 days (same definition as Analytics tab WAU/DAU family).
  const sevenDaysAgoDate = new Date();
  sevenDaysAgoDate.setUTCDate(sevenDaysAgoDate.getUTCDate() - 6);
  const sevenDaysAgoYmd = sevenDaysAgoDate.toISOString().slice(0, 10);
  const { data: recentStudyUsers } = await adminData.listRecentStudyActivityUsers(dataLayer,
    sevenDaysAgoYmd
  );
  const activeUsers7d = new Set((recentStudyUsers || []).map((r: any) => r.user_id).filter(Boolean)).size;

  // Real token spend when the inference log has it (recorded since the
  // usage-tracking change); the old events-times-flat-guess only as fallback
  // for windows that predate token recording. Blended $/1M tokens is
  // env-tunable because it is pricing, not code.
  const { data: tokenRows } = await adminData.listAiTokenEstimates(dataLayer, last7d, 10000);
  const aiTokens7d = (tokenRows || []).reduce(
    (sum: number, r: any) => sum + (typeof r.token_estimate === 'number' ? r.token_estimate : 0),
    0
  );
  const costPerMTokenUsd = Number(process.env.AI_COST_PER_MTOKEN_USD) || 0.3;
  const estimatedAiCost7d =
    aiTokens7d > 0
      ? Number(((aiTokens7d / 1_000_000) * costPerMTokenUsd).toFixed(4))
      : Number(((aiEventsLast7d ?? 0) * AI_EVENT_ESTIMATED_COST_USD).toFixed(4));

  res.json({
    success: true,
    data: {
      // The console disables its Make admin / Revoke admin buttons and says
      // why when this is false, instead of failing on click with a 403.
      roleManagementEnabled: resolveRoleManagementEnabled(),
      totalUsers: userCount ?? 0,
      totalListings: listingCount ?? 0,
      activeListings: activeListingCount ?? 0,
      openReports: reportCount ?? 0,
      openDisputes: openDisputeCount ?? 0,
      aiEventsLast24h: aiEventCount ?? 0,
      newUsersToday: newUsersToday ?? 0,
      aiEventsLast7d: aiEventsLast7d ?? 0,
      reportsResolved7d: reportsResolved7d ?? 0,
      estimatedAiCost7d,
      aiTokens7d,
      aiEventEstimatedCostUsd: AI_EVENT_ESTIMATED_COST_USD,
      activeGroups: groupCount ?? 0,
      messagesLast24h: messageCount24h ?? 0,
      totalDecks: deckCount ?? 0,
      offlineBundles: offlineBundleCount ?? 0,
      activeUsers7d,
    },
  });
}));

// GET /api/v1/admin/learning-connections?weeks= — the north-star metric
// (Phase 3 · O). Weekly Active Learning Connections: distinct (actor,
// beneficiary, kind) pairs per ISO week, so the number measures NEW helping
// relationships rather than repeat activity between the same two people.
router.get('/learning-connections', adminRoute(async (req: any, res: any) => {
  const { getLearningConnectionsService } = await import('../../services/learningConnections');
  const data = await getLearningConnectionsService(dataLayer).weekly(
    req.query.weeks ? Number(req.query.weeks) : 12
  );
  res.json({ success: true, data });
}));

// ===========================================================================
// Analytics, activity feed and audit log
//
// Read-only, so none of these routes audit. Every aggregation runs in Node
// over a capped row scan (`ROW_LIMIT`), and the ones that can be truncated say
// so in the payload — a silently short answer here would read as a real drop
// in usage. `GET /audit` degrades to `{data: [], tableReady: false}` when
// `admin_audit_log` has not been migrated yet, so an un-migrated environment
// still gets a working console.
// ===========================================================================

// GET /api/v1/admin/analytics
router.get('/analytics', adminRoute(async (req: any, res: any) => {
  const rawDays = parseInt(req.query.days as string, 10);
  const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
  const data = await dataLayer.adminAnalytics.getAdminAnalytics(days);
  res.json({ success: true, data });
}));

router.get('/ai-analytics', adminRoute(async (req: any, res: any) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminData.listAiEvents(dataLayer, since, 5000);
  if (error) throw error;

  const byEvent: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  for (const row of data || []) {
    byEvent[row.event] = (byEvent[row.event] || 0) + 1;
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }

  res.json({
    success: true,
    data: {
      totalEvents: (data || []).length,
      byEvent,
      byDay,
      periodDays: days,
    },
  });
}));

// GET /api/v1/admin/ai-tokens — real token spend from ai_inference_log.
// token_estimate is provider-reported prompt+completion for paid calls and
// NULL for cache replays, so "tokens" here is genuine spend, never phantom.
router.get('/ai-tokens', adminRoute(async (req: any, res: any) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
  const since = daysAgoIso(days);
  const ROW_LIMIT = 10000;

  const { data, error } = await adminData.listAiInferenceRows(dataLayer, since, ROW_LIMIT);
  if (error) throw error;

  const rows = data || [];
  const aggregate = aggregateAiTokenRows(rows);

  res.json({
    success: true,
    data: {
      periodDays: days,
      ...aggregate,
      // Live per-provider gauges for TODAY (this instance), straight from the
      // providers' own usage reports — cachedTokens is the prefix-cache hit
      // volume that cached-input pricing discounts.
      providersToday: getProviderStatus().map((p) => ({ name: p.name, ...p.tokensToday })),
      // The reduce above only saw ROW_LIMIT rows; below that it is complete.
      truncated: rows.length === ROW_LIMIT,
    },
  });
}));

// GET /api/v1/admin/events — the raw product-event stream, aggregated.
// The analytics tab's funnels are curated views; this answers "what are users
// actually doing" without waiting for a funnel to be built around it.
router.get('/events', adminRoute(async (req: any, res: any) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
  const since = daysAgoIso(days);
  const ROW_LIMIT = 10000;

  const { data, error } = await adminData.listProductEvents(dataLayer, since, ROW_LIMIT);
  if (error) throw error;

  const rows = data || [];

  res.json({
    success: true,
    data: {
      periodDays: days,
      ...aggregateProductEventRows(rows),
      truncated: rows.length === ROW_LIMIT,
    },
  });
}));

router.get('/ai-analytics/users', adminRoute(async (req: any, res: any) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const since = daysAgoIso(days);

  const { data, error } = await adminData.listAiEventsByUser(dataLayer, since, 20000);
  if (error) throw error;

  const usageMap: Record<string, number> = {};
  for (const row of data || []) {
    const userId = row.user_id || 'unknown';
    usageMap[userId] = (usageMap[userId] || 0) + 1;
  }

  const top = Object.entries(usageMap)
    .map(([userId, events]) => ({ userId, events }))
    .sort((a, b) => b.events - a.events)
    .slice(0, limit);

  const userIds = top.map((u) => u.userId).filter((id) => id !== 'unknown');
  const authMap = await getAuthUserInfoForUserIds(userIds);

  const { data: profileRows } = await adminData.getProfileSummaries(dataLayer, userIds);
  const profileMap = Object.fromEntries((profileRows || []).map((p: any) => [p.id, p]));

  res.json({
    success: true,
    data: {
      periodDays: days,
      users: top.map((row) => ({
        user_id: row.userId,
        events: row.events,
        name: profileMap[row.userId]?.name,
        username: profileMap[row.userId]?.username,
        email: authMap[row.userId]?.email,
      })),
    },
  });
}));

router.get('/activity', adminRoute(async (req: any, res: any) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const [usersRes, reportsRes, listingsRes, aiRes] = await Promise.all([
    adminData.listRecentUsers(dataLayer, limit),
    adminData.listRecentMarketplaceReports(dataLayer, limit),
    adminData.listRecentListings(dataLayer, limit),
    adminData.listRecentAiEvents(dataLayer, limit),
  ]);

  const activities: Array<{
    id: string;
    type: 'user_joined' | 'report_created' | 'listing_created' | 'ai_event';
    title: string;
    description: string;
    created_at: string;
    user_id?: string;
  }> = [];

  for (const row of usersRes.data || []) {
    activities.push({
      id: `user:${row.id}`,
      type: 'user_joined',
      title: 'New user joined',
      description: row.name || row.username || row.id,
      created_at: row.created_at,
      user_id: row.id,
    });
  }

  for (const row of reportsRes.data || []) {
    activities.push({
      id: `report:${row.id}`,
      type: 'report_created',
      title: 'New marketplace report',
      description: row.reason || 'Report submitted',
      created_at: row.created_at,
      user_id: row.reporter_id,
    });
  }

  for (const row of listingsRes.data || []) {
    activities.push({
      id: `listing:${row.id}`,
      type: 'listing_created',
      title: 'New marketplace listing',
      description: row.title || row.id,
      created_at: row.created_at,
      user_id: row.user_id,
    });
  }

  for (const row of aiRes.data || []) {
    activities.push({
      id: `ai:${row.id}`,
      type: 'ai_event',
      title: 'AI usage event',
      description: row.event || 'AI event',
      created_at: row.created_at,
      user_id: row.user_id,
    });
  }

  activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json({ success: true, data: activities.slice(0, limit) });
}));

// GET /api/v1/admin/audit
router.get('/audit', adminRoute(async (req: any, res: any) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const { data, error } = await adminData.listAuditEntries(dataLayer, limit);

  if (error) {
    const code = error.code || '';
    const message = error.message || '';
    // Table not migrated yet — return empty list instead of breaking the admin console.
    if (code === '42P01' || message.includes('admin_audit_log') || message.includes('does not exist')) {
      console.warn('admin_audit_log table missing; run supabase migration 20260608100000_admin_audit_log.sql');
      return res.json({ success: true, data: [], tableReady: false });
    }
    throw error;
  }

  const actorIds = [...new Set((data || []).map((r: any) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await adminData.getProfileSummaries(dataLayer, actorIds)
    : { data: [] };
  const actorMap = Object.fromEntries((actors || []).map((a: any) => [a.id, a]));

  res.json({
    success: true,
    data: (data || []).map((row: any) => ({
      ...row,
      actor: actorMap[row.actor_id] || null,
    })),
    tableReady: true,
  });
}));

export default router;
