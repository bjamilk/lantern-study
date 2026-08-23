/**
 * Admin Routes — platform system-admin console endpoints.
 * All routes are pre-protected by authMiddleware + requirePlatformAdmin
 * applied at mount time in server.ts.
 */
import { Router } from 'express';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { logAdminAction, countPlatformAdmins, invalidateBanCache } from '../services/adminAudit';
import {
  handleValidationErrors,
  validateUuidParam,
  validateAdminUserStatus,
  validateAdminUserRole,
  validateAdminPointsAdjust,
  validateAdminNotification,
  validateAdminBulkNotification,
} from '../middleware/validation';
import { getAIUsage, resetAIUsageForUser, getAllAIUsageForUser } from '../middleware/aiRateLimit';
import { probeProvider, getProviderStatus } from '../services/aiService';
import { aggregateAiTokenRows, aggregateProductEventRows } from '../services/adminAggregations';
import { clientErrorMessage } from '../utils/safeError';
import { getMarketplaceOrdersService, invalidateSellerAnalyticsCache } from '../services/marketplaceOrders';
import { setUserSessionCutoff } from '../services/tokenDenylist';
import { clearAuthTokenCache } from '../middleware/auth';
import { logger } from '../utils/logger';
import { invalidateListingCaches } from '../utils/marketplaceCache';
import { getModerationService } from '../services/moderation';
import { PublicError } from '../utils/safeError';
import { MAX_SUSPENSION_DAYS, isSuspensionActive } from '@lantern/shared/moderation';
import { isMarketplaceListingModerated } from '@lantern/shared/marketplace';

const router = Router();

/** PublicError(+statusCode) from the moderation service → 4xx; everything else → 500. */
function respondModerationError(res: any, err: any): void {
  if (err instanceof PublicError) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    res.status(typeof statusCode === 'number' ? statusCode : 400).json({ success: false, error: err.message });
    return;
  }
  res.status(500).json({ success: false, error: clientErrorMessage(err) });
}
let supabaseService: SupabaseService;
let cacheService: CacheService;

export function initializeAdminRoutes(svc: SupabaseService, cache: CacheService) {
  supabaseService = svc;
  cacheService = cache;
}

const AI_EVENT_ESTIMATED_COST_USD = parseFloat(process.env.ADMIN_AI_EVENT_COST_USD || '0.0025');
const ENABLE_ADMIN_ROLE_MANAGEMENT = process.env.ENABLE_ADMIN_ROLE_MANAGEMENT === 'true';

function startOfDayIso(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Escape user input for PostgREST .or() ilike filters (% _ , are special). */
function escapePostgrestSearch(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '\\,');
}

function normalizeReportStatus(status: string): string {
  return status === 'open' ? 'pending' : status;
}

async function getAuthUserInfoForUserIds(
  userIds: string[]
): Promise<Record<string, { email?: string; isPlatformAdmin?: boolean }>> {
  if (!userIds.length) return {};

  const client: any = supabaseService.getClient();
  const result: Record<string, { email?: string; isPlatformAdmin?: boolean }> = {};
  const uncached: string[] = [];

  for (const userId of userIds) {
    const cached = await cacheService.get(`authMeta:${userId}`) as { email?: string; isPlatformAdmin?: boolean } | null;
    if (cached) {
      result[userId] = cached;
    } else {
      uncached.push(userId);
    }
  }

  if (uncached.length) {
    const entries = await Promise.all(
      uncached.map(async (userId) => {
        try {
          const { data, error } = await client.auth.admin.getUserById(userId);
          if (error) return [userId, {}] as const;
          const info = {
            email: data?.user?.email,
            isPlatformAdmin: data?.user?.app_metadata?.is_platform_admin === true,
          };
          await cacheService.set(`authMeta:${userId}`, info, 600);
          return [userId, info] as const;
        } catch {
          return [userId, {}] as const;
        }
      })
    );
    for (const [userId, info] of entries) {
      result[userId] = info;
    }
  }

  return result;
}

// GET /api/v1/admin/ai/provider-probe?provider=fireworks
// Sends one real request to a single AI provider so a newly added key can be
// checked without waiting for the fallback chain to reach it in production.
// Admin-only and rate-limited at mount time; it bills one tiny completion.
router.get('/ai/provider-probe', async (req: any, res: any) => {
  const requested = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
  if (!requested) {
    res.status(400).json({
      success: false,
      error: 'provider query parameter is required',
      knownProviders: getProviderStatus().map((p) => p.name),
    });
    return;
  }

  try {
    const result = await probeProvider(requested);
    // 200 with ok:false — the probe ran and produced a verdict. A non-2xx here
    // would be ambiguous with the probe endpoint itself failing.
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: clientErrorMessage(error) });
  }
});

// GET /api/v1/admin/stats
router.get('/stats', async (req: any, res: any) => {
  try {
    const client = supabaseService.getClient();
    const todayStart = startOfDayIso();
    const last7d = daysAgoIso(7);
    const last24h = daysAgoIso(1);

    const [
      { count: userCount },
      { count: listingCount },
      { count: activeListingCount },
      { count: reportCount },
      { count: aiEventCount },
      { count: newUsersToday },
      { count: reportsResolved7d },
      { count: aiEventsLast7d },
      { count: groupCount },
      { count: messageCount24h },
      { count: deckCount },
      { count: offlineBundleCount },
      { count: openDisputeCount },
    ] = await Promise.all([
      client.from('profiles').select('id', { count: 'exact', head: true }),
      client.from('marketplace_listings').select('id', { count: 'exact', head: true }),
      client.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      client.from('marketplace_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('ai_analytics').select('id', { count: 'exact', head: true }).gte('created_at', last24h),
      client.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      client.from('marketplace_reports').select('id', { count: 'exact', head: true }).eq('status', 'resolved').gte('resolved_at', last7d),
      client.from('ai_analytics').select('id', { count: 'exact', head: true }).gte('created_at', last7d),
      client.from('groups').select('id', { count: 'exact', head: true }).eq('is_archived', false),
      client.from('messages').select('id', { count: 'exact', head: true }).gte('timestamp', last24h),
      client.from('decks').select('id', { count: 'exact', head: true }).is('removed_by_admin_at', null),
      client.from('offline_bundles').select('id', { count: 'exact', head: true }),
      client.from('marketplace_orders').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
    ]);

    // Distinct study_activity users in the last 7 days (same definition as Analytics tab WAU/DAU family).
    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setUTCDate(sevenDaysAgoDate.getUTCDate() - 6);
    const sevenDaysAgoYmd = sevenDaysAgoDate.toISOString().slice(0, 10);
    const { data: recentStudyUsers } = await client
      .from('study_activity')
      .select('user_id')
      .gte('activity_date', sevenDaysAgoYmd)
      .gt('count', 0)
      .limit(10000);
    const activeUsers7d = new Set((recentStudyUsers || []).map((r: any) => r.user_id).filter(Boolean)).size;

    // Real token spend when the inference log has it (recorded since the
    // usage-tracking change); the old events-times-flat-guess only as fallback
    // for windows that predate token recording. Blended $/1M tokens is
    // env-tunable because it is pricing, not code.
    const { data: tokenRows } = await client
      .from('ai_inference_log')
      .select('token_estimate')
      .gte('created_at', last7d)
      .not('token_estimate', 'is', null)
      .limit(10000);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/users
router.get('/users', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const search = (req.query.search as string)?.trim() || '';
    const offset = (page - 1) * limit;
    const client = supabaseService.getClient();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (search && uuidPattern.test(search)) {
      const { data: profile, error } = await client
        .from('profiles')
        .select('id, name, username, first_name, last_name, avatar_url, points, settings, created_at')
        .eq('id', search)
        .maybeSingle();
      if (error) throw error;
      const authMap = profile ? await getAuthUserInfoForUserIds([profile.id]) : {};
      const normalized = profile
        ? [{
            ...profile,
            email: authMap[profile.id]?.email,
            is_banned: profile?.settings?.is_banned === true || profile?.settings?.account_status === 'banned',
            is_platform_admin: authMap[profile.id]?.isPlatformAdmin === true,
          }]
        : [];
      return res.json({
        success: true,
        data: normalized,
        pagination: { page: 1, limit, total: normalized.length, pages: 1 },
      });
    }

    if (search && search.includes('@')) {
      // Match against auth.users directly via the admin_search_users_by_email
      // RPC (20260817120000): the old listUsers page scan stopped at 1000
      // users and silently fell back to name-only matching, so a real email
      // could return "no results". Returns every match, not just the first.
      const { data: emailMatches, error: rpcError } = await client.rpc(
        'admin_search_users_by_email',
        { search_query: search, result_limit: limit }
      );

      if (!rpcError && Array.isArray(emailMatches) && emailMatches.length > 0) {
        const ids = emailMatches.map((m: any) => m.id);
        const { data: profiles } = await client
          .from('profiles')
          .select('id, name, username, first_name, last_name, avatar_url, points, settings, created_at')
          .in('id', ids);
        const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));
        const normalized = emailMatches.map((m: any) => {
          const row = profileById.get(m.id) || { id: m.id, name: m.email, settings: {} };
          return {
            ...row,
            email: m.email,
            is_banned: row?.settings?.is_banned === true || row?.settings?.account_status === 'banned',
            is_platform_admin: m.is_platform_admin === true,
          };
        });
        return res.json({
          success: true,
          data: normalized,
          pagination: { page: 1, limit, total: normalized.length, pages: 1 },
        });
      }

      // Function not deployed yet (or no match): legacy bounded page scan so
      // the search keeps working before the migration is applied.
      if (rpcError) {
        const authClient: any = client;
        let matchedUser: any = null;
        for (let authPage = 1; authPage <= 5 && !matchedUser; authPage++) {
          const { data: authData } = await authClient.auth.admin.listUsers({ page: authPage, perPage: 200 });
          matchedUser = (authData?.users || []).find((u: any) =>
            u.email?.toLowerCase().includes(search.toLowerCase())
          );
          if ((authData?.users || []).length < 200) break;
        }
        if (matchedUser) {
          const { data: profile } = await client
            .from('profiles')
            .select('id, name, username, first_name, last_name, avatar_url, points, settings, created_at')
            .eq('id', matchedUser.id)
            .maybeSingle();
          const row = profile || {
            id: matchedUser.id,
            name: matchedUser.user_metadata?.name || matchedUser.email,
            created_at: matchedUser.created_at,
            settings: {},
          };
          const normalized = [{
            ...row,
            email: matchedUser.email,
            is_banned: row?.settings?.is_banned === true || row?.settings?.account_status === 'banned',
            is_platform_admin: matchedUser.app_metadata?.is_platform_admin === true,
          }];
          return res.json({
            success: true,
            data: normalized,
            pagination: { page: 1, limit, total: normalized.length, pages: 1 },
          });
        }
      }
    }

    let query = client
      .from('profiles')
      .select('id, name, username, first_name, last_name, avatar_url, points, settings, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      const safeSearch = escapePostgrestSearch(search);
      query = query.or(`name.ilike.%${safeSearch}%,username.ilike.%${safeSearch}%,first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const userIds = (data || []).map((u: any) => u.id);
    const authMap = await getAuthUserInfoForUserIds(userIds);

    const normalized = (data || []).map((u: any) => ({
      ...u,
      email: authMap[u.id]?.email,
      is_banned: u?.settings?.is_banned === true || u?.settings?.account_status === 'banned',
      is_platform_admin: authMap[u.id]?.isPlatformAdmin === true,
    }));

    res.json({
      success: true,
      data: normalized,
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.patch('/users/:id/status', validateAdminUserStatus, handleValidationErrors, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { status, reason, until } = req.body as {
      status: 'active' | 'banned' | 'suspended';
      reason?: string;
      /** suspended only: ISO end date, at most MAX_SUSPENSION_DAYS ahead. */
      until?: string;
    };

    if (!['active', 'banned', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be "active", "banned" or "suspended"' });
    }

    // Time-boxed suspension: settings.suspended_until (no global sign-out —
    // the API answers ACCOUNT_SUSPENDED until the date passes). 'active'
    // clears both the ban and any suspension.
    let suspendedUntil: string | null = null;
    if (status === 'suspended') {
      const parsed = typeof until === 'string' ? new Date(until) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, error: 'until must be an ISO date for a suspension' });
      }
      const maxMs = MAX_SUSPENSION_DAYS * 86_400_000;
      if (parsed.getTime() <= Date.now() || parsed.getTime() - Date.now() > maxMs) {
        return res
          .status(400)
          .json({ success: false, error: `until must be in the future and at most ${MAX_SUSPENSION_DAYS} days ahead` });
      }
      suspendedUntil = parsed.toISOString();
    }

    const client = supabaseService.getClient();
    const { data: profile, error: fetchErr } = await client.from('profiles').select('settings').eq('id', id).single();

    if (fetchErr || !profile) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const currentSettings = (profile.settings || {}) as Record<string, any>;
    const wasSuspended = isSuspensionActive(currentSettings.suspended_until);
    const nextSettings: Record<string, any> = {
      ...currentSettings,
      account_status: status === 'suspended' ? currentSettings.account_status ?? 'active' : status,
      is_banned: status === 'banned',
      ...(status === 'banned'
        ? { banned_at: new Date().toISOString(), ban_reason: reason || null }
        : status === 'active'
          ? { banned_at: null, ban_reason: null }
          : {}),
    };
    if (status === 'suspended') nextSettings.suspended_until = suspendedUntil;
    else if (status === 'active') delete nextSettings.suspended_until;

    const { error } = await client.from('profiles').update({ settings: nextSettings }).eq('id', id);
    if (error) throw error;

    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action:
        status === 'banned'
          ? 'user_ban'
          : status === 'suspended'
            ? 'user_suspend'
            : wasSuspended && !currentSettings.is_banned
              ? 'user_unsuspend'
              : 'user_unban',
      targetType: 'user',
      targetId: id,
      metadata: status === 'suspended' ? { until: suspendedUntil, trigger: 'admin' } : {},
      reason,
    });
    await invalidateBanCache(id);

    if (status === 'banned') {
      try {
        await client.auth.admin.signOut(id, 'global');
      } catch (signOutErr) {
        logger.warn('Supabase global signOut failed on ban', { id, signOutErr });
      }
      await setUserSessionCutoff(id);
    } else if (status === 'suspended') {
      await supabaseService
        .createNotification(id, {
          type: 'warning',
          message: `Your account has been suspended by Lantern moderation until ${new Date(suspendedUntil!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.${reason ? ` Reason: ${reason}.` : ''} Contact support@lanternstudy.com to appeal.`,
          link: 'settings:account',
          data: { suspendedUntil, kind: 'account_suspended' },
          force: true,
        })
        .catch((notifyErr) => logger.warn('Suspension notification failed', { id, notifyErr }));
    }

    res.json({ success: true, data: { id, status, suspendedUntil } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/users/:id/strikes — add a moderation strike by hand
// (3 active strikes auto-suspend for 14 days; audited inside the service).
router.post('/users/:id/strikes', validateUuidParam('id'), handleValidationErrors, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { reason, severity, reportId } = req.body || {};
    const result = await getModerationService(supabaseService).addStrike(id, {
      reason,
      severity,
      reportId,
      createdBy: req.user.id,
    });
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'strike_add',
      targetType: 'user',
      targetId: id,
      metadata: {
        strike_id: result.strike.id,
        severity: result.strike.severity,
        report_id: reportId ?? null,
        active_strikes: result.activeStrikes,
        suspended_until: result.suspendedUntil,
      },
      reason: typeof reason === 'string' ? reason : undefined,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

// GET /api/v1/admin/users/:id/strikes
router.get('/users/:id/strikes', validateUuidParam('id'), handleValidationErrors, async (req: any, res: any) => {
  try {
    const moderation = getModerationService(supabaseService);
    const [strikes, state] = await Promise.all([
      moderation.listStrikes(req.params.id),
      moderation.getModerationState(req.params.id),
    ]);
    res.json({ success: true, data: { strikes, ...state } });
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

router.patch('/users/:id/role', validateAdminUserRole, handleValidationErrors, async (req: any, res: any) => {
  try {
    if (!ENABLE_ADMIN_ROLE_MANAGEMENT) {
      return res.status(403).json({
        success: false,
        error: 'Role management is disabled. Use Supabase dashboard or set ENABLE_ADMIN_ROLE_MANAGEMENT=true.',
      });
    }

    const { id } = req.params;
    const { isPlatformAdmin, confirmationPhrase } = req.body as {
      isPlatformAdmin: boolean;
      confirmationPhrase?: string;
    };

    if (confirmationPhrase !== 'CONFIRM_ADMIN_ROLE_CHANGE') {
      return res.status(400).json({ success: false, error: 'Missing or invalid confirmation phrase.' });
    }

    if (id === req.user.id && isPlatformAdmin !== true) {
      return res.status(400).json({ success: false, error: 'You cannot revoke your own admin role.' });
    }

    const client: any = supabaseService.getClient();
    const { data: userData, error: fetchErr } = await client.auth.admin.getUserById(id);
    if (fetchErr || !userData?.user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const currentlyAdmin = userData.user.app_metadata?.is_platform_admin === true;
    if (currentlyAdmin && isPlatformAdmin !== true) {
      const adminCount = await countPlatformAdmins(supabaseService);
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot remove the last platform admin.' });
      }
    }

    const existingMetadata = userData.user.app_metadata || {};
    const nextMetadata = {
      ...existingMetadata,
      is_platform_admin: isPlatformAdmin === true,
    };

    const { error: updateErr } = await client.auth.admin.updateUserById(id, {
      app_metadata: nextMetadata,
    });
    if (updateErr) throw updateErr;

    const { data: profile } = await client.from('profiles').select('settings').eq('id', id).single();
    const nextSettings = {
      ...(profile?.settings || {}),
      is_platform_admin: isPlatformAdmin === true,
    };
    await client.from('profiles').update({ settings: nextSettings }).eq('id', id);

    if (isPlatformAdmin === true) {
      await client.from('platform_admins').upsert({ user_id: id, granted_by: req.user.id }, { onConflict: 'user_id' });
    } else {
      await client.from('platform_admins').delete().eq('user_id', id);
    }

    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: isPlatformAdmin ? 'user_role_grant' : 'user_role_revoke',
      targetType: 'user',
      targetId: id,
    });

    if (isPlatformAdmin !== true) {
      try {
        await client.auth.admin.signOut(id, 'global');
      } catch (signOutErr) {
        logger.warn('Supabase global signOut failed on role revoke', { id, signOutErr });
      }
      await setUserSessionCutoff(id);
    }

    // SEC-09: drop JWT verification cache so grant/revoke is not delayed by TTL.
    clearAuthTokenCache();

    res.json({ success: true, data: { id, is_platform_admin: isPlatformAdmin === true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/marketplace/listings', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || '';
    const offset = (page - 1) * limit;

    let query = supabaseService
      .getClient()
      .from('marketplace_listings')
      .select('id, title, price, category, status, created_at, views_count, user_id, seller:profiles!marketplace_listings_user_id_fkey(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.delete('/marketplace/listings/:id', async (req: any, res: any) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.patch('/marketplace/listings/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: 'active' | 'suspended_by_admin' };

    if (!['active', 'suspended_by_admin'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be active or suspended_by_admin' });
    }

    const client = supabaseService.getClient();
    const { data: current } = await client
      .from('marketplace_listings')
      .select('id, status, user_id, title')
      .eq('id', id)
      .maybeSingle();
    if (!current) return res.status(404).json({ success: false, error: 'Listing not found' });

    const moderation = getModerationService(supabaseService);
    // Restoring from a takedown must not blindly re-list a unique item that was
    // reserved/sold before it was removed (double-sell) — derive the real status.
    const statusToWrite =
      status === 'active' && isMarketplaceListingModerated(current.status)
        ? await moderation.resolveRestoredListingStatus(id)
        : status;

    const { error } = await client
      .from('marketplace_listings')
      .update({ status: statusToWrite })
      .eq('id', id);
    if (error) throw error;

    // Restoring a listing outside the appeal flow clears its takedown state
    // (rights_status 'cleared'); suspending records the reason for the seller.
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (status === 'active' && isMarketplaceListingModerated(current.status)) {
      await moderation.clearListingTakedown(id).catch((e) => logger.warn('clearListingTakedown failed', { id, e }));
    } else if (status === 'suspended_by_admin' && current.status !== 'suspended_by_admin') {
      await client
        .from('marketplace_listings')
        .update({
          rights_status: 'under_review',
          takedown_reason: reason || 'Suspended pending Lantern review',
          takedown_at: new Date().toISOString(),
          takedown_by: req.user.id,
        })
        .eq('id', id)
        .then(({ error: e }) => e && logger.warn('suspend takedown fields failed', { id, e }));
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/learning-connections?weeks= — the north-star metric
// (Phase 3 · O). Weekly Active Learning Connections: distinct (actor,
// beneficiary, kind) pairs per ISO week, so the number measures NEW helping
// relationships rather than repeat activity between the same two people.
router.get('/learning-connections', async (req: any, res: any) => {
  try {
    const { getLearningConnectionsService } = await import('../services/learningConnections');
    const data = await getLearningConnectionsService(supabaseService).weekly(
      req.query.weeks ? Number(req.query.weeks) : 12
    );
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/marketplace/orders', async (req: any, res: any) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.patch('/marketplace/orders/:id/dispute', async (req: any, res: any) => {
  try {
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
  } catch (err: any) {
    const message = clientErrorMessage(err);
    const status = message.includes('not found') ? 404 : message.includes('Only disputed') ? 400 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

// GET /api/v1/admin/reports?status&targetType&page&limit — generic content
// report queue (content_reports; Phase 1 · E). Each row carries a `target`
// summary (title / status / owner) resolved per target type, plus the legacy
// `listing` / `listing_id` aliases for listing targets so the existing console
// keeps rendering.
router.get('/reports', async (req: any, res: any) => {
  try {
    const result = await getModerationService(supabaseService).listReports({
      status: normalizeReportStatus((req.query.status as string) || 'open'),
      targetType: (req.query.targetType as string) || undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

// PUT /api/v1/admin/reports/:id { action: dismiss|under_review|warn|remove_content|strike, note?, severity? }
// Legacy aliases from the pre-E console still work: remove_listing → remove_content,
// warn_seller → warn, adminNote → note.
router.put('/reports/:id', validateUuidParam('id'), handleValidationErrors, async (req: any, res: any) => {
  try {
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
      const { data: report } = await supabaseService
        .getClient()
        .from('content_reports')
        .select('target_type, target_id')
        .eq('id', id)
        .maybeSingle();
      if (report && (report.target_type === 'listing' || report.target_type === 'question_bank')) {
        await invalidateListingCaches(cacheService, String(report.target_id));
        await cacheService.deletePattern('marketplace:listings:*');
      }
    }

    res.json({ success: true, data: { ...result, warned: result.action === 'warn' } });
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

// GET /api/v1/admin/appeals — listings whose seller appealed a takedown
router.get('/appeals', async (_req: any, res: any) => {
  try {
    const data = await getModerationService(supabaseService).listAppeals();
    res.json({ success: true, data });
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

// PUT /api/v1/admin/marketplace/listings/:id/appeal { decision: upheld|reversed, note? }
router.put('/marketplace/listings/:id/appeal', validateUuidParam('id'), handleValidationErrors, async (req: any, res: any) => {
  try {
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
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

// GET /api/v1/admin/analytics
router.get('/analytics', async (req: any, res: any) => {
  try {
    const rawDays = parseInt(req.query.days as string, 10);
    const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
    const data = await supabaseService.getAdminAnalytics(days);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/ai-analytics', async (req: any, res: any) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseService.getClient().from('ai_analytics').select('event, created_at, user_id').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/ai-tokens — real token spend from ai_inference_log.
// token_estimate is provider-reported prompt+completion for paid calls and
// NULL for cache replays, so "tokens" here is genuine spend, never phantom.
router.get('/ai-tokens', async (req: any, res: any) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = daysAgoIso(days);
    const ROW_LIMIT = 10000;

    const { data, error } = await supabaseService
      .getClient()
      .from('ai_inference_log')
      .select('feature, provider, token_estimate, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/events — the raw product-event stream, aggregated.
// The analytics tab's funnels are curated views; this answers "what are users
// actually doing" without waiting for a funnel to be built around it.
router.get('/events', async (req: any, res: any) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = daysAgoIso(days);
    const ROW_LIMIT = 10000;

    const { data, error } = await supabaseService
      .getClient()
      .from('product_events')
      .select('event, surface, user_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/ai-analytics/users', async (req: any, res: any) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const since = daysAgoIso(days);

    const { data, error } = await supabaseService.getClient().from('ai_analytics').select('user_id, event, created_at').gte('created_at', since).limit(20000);
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

    const { data: profileRows } = await supabaseService.getClient().from('profiles').select('id, name, username').in('id', userIds);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/activity', async (req: any, res: any) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const client = supabaseService.getClient();

    const [usersRes, reportsRes, listingsRes, aiRes] = await Promise.all([
      client.from('profiles').select('id, name, username, created_at').order('created_at', { ascending: false }).limit(limit),
      client.from('marketplace_reports').select('id, reason, created_at, reporter_id').order('created_at', { ascending: false }).limit(limit),
      client.from('marketplace_listings').select('id, title, created_at, user_id, status').order('created_at', { ascending: false }).limit(limit),
      client.from('ai_analytics').select('id, event, created_at, user_id').order('created_at', { ascending: false }).limit(limit),
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/audit
router.get('/audit', async (req: any, res: any) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
    const client = supabaseService.getClient();
    const { data, error } = await client
      .from('admin_audit_log')
      .select('id, actor_id, action, target_type, target_id, metadata, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

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

    const actorIds = [...new Set((data || []).map((r: any) => r.actor_id).filter(Boolean))];
    const { data: actors } = actorIds.length
      ? await client.from('profiles').select('id, name, username').in('id', actorIds)
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/users/:id
router.get('/users/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const client = supabaseService.getClient();
    const last7d = daysAgoIso(7);

    const { data: profile, error } = await client
      .from('profiles')
      .select('id, name, username, first_name, last_name, avatar_url, points, badges, settings, stats, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return res.status(404).json({ success: false, error: 'User not found' });

    const authMap = await getAuthUserInfoForUserIds([id]);
    const [
      { count: groupCount },
      { count: listingCount },
      { count: deckCount },
      { count: aiEvents7d },
      activeStrikes,
    ] = await Promise.all([
      client.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', id),
      client.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('user_id', id),
      client.from('decks').select('id', { count: 'exact', head: true }).eq('user_id', id).is('removed_by_admin_at', null),
      client.from('ai_analytics').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('created_at', last7d),
      getModerationService(supabaseService).countActiveStrikes(id).catch(() => 0),
    ]);

    const suspendedUntil = isSuspensionActive(profile?.settings?.suspended_until)
      ? (profile.settings.suspended_until as string)
      : null;

    res.json({
      success: true,
      data: {
        ...profile,
        email: authMap[id]?.email,
        is_banned: profile?.settings?.is_banned === true || profile?.settings?.account_status === 'banned',
        suspended_until: suspendedUntil,
        active_strikes: activeStrikes,
        is_platform_admin: authMap[id]?.isPlatformAdmin === true,
        counts: {
          groups: groupCount ?? 0,
          listings: listingCount ?? 0,
          decks: deckCount ?? 0,
          aiEvents7d: aiEvents7d ?? 0,
        },
        aiQuota: await getAllAIUsageForUser(id),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/notifications
router.post('/notifications', validateAdminNotification, handleValidationErrors, async (req: any, res: any) => {
  try {
    const { userId, message, link, type = 'info' } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ success: false, error: 'userId and message are required' });
    }
    const notification = await supabaseService.createNotification(userId, { message, link, type, force: true });
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'notification_send',
      targetType: 'user',
      targetId: userId,
      metadata: { type },
    });
    res.status(201).json({ success: true, data: notification });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/notifications/bulk
router.post('/notifications/bulk', validateAdminBulkNotification, handleValidationErrors, async (req: any, res: any) => {
  try {
    const { userIds, message, link, type = 'info' } = req.body;
    const notifications = userIds.map((uid: string) => ({ userId: uid, message, link, type }));
    const created = await supabaseService.createBulkNotifications(notifications);
    for (const uid of userIds) {
      await cacheService.deletePattern(`notifications:${uid}:*`);
    }
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'notification_send',
      targetType: 'bulk',
      metadata: { count: userIds.length, type },
    });
    res.status(201).json({ success: true, data: created, count: created.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/users/:id/points
router.post('/users/:id/points', validateAdminPointsAdjust, handleValidationErrors, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { points, reason, source = 'admin' } = req.body;
    if (typeof points !== 'number' || !Number.isFinite(points)) {
      return res.status(400).json({ success: false, error: 'points must be a number' });
    }
    const result = await supabaseService.awardPoints(id, points, reason || 'Admin adjustment', source);
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'points_award',
      targetType: 'user',
      targetId: id,
      metadata: { points, reason },
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/users/:id/badge
router.post('/users/:id/badge', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { badgeId } = req.body;
    if (!badgeId) return res.status(400).json({ success: false, error: 'badgeId is required' });
    const result = await supabaseService.awardBadge(id, badgeId, req.user.id);
    await cacheService.deletePattern(`gamification:user:badges:${id}:*`);
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'badge_award',
      targetType: 'user',
      targetId: id,
      metadata: { badgeId, awarded: result.awarded },
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    // awardBadge raises 400 (unknown badge id) / 404 (no such user) as
    // PublicError with a statusCode; surface those instead of a blanket 500.
    const status = typeof err?.statusCode === 'number' && err.statusCode < 500 ? err.statusCode : 500;
    res.status(status).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/groups
router.get('/groups', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const search = (req.query.search as string)?.trim() || '';
    const offset = (page - 1) * limit;
    let query = supabaseService.getClient()
      .from('groups')
      .select('id, name, description, is_archived, created_at, last_message_time', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (search) {
      const safe = escapePostgrestSearch(search);
      query = query.ilike('name', `%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// PATCH /api/v1/admin/groups/:id
router.patch('/groups/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { isArchived, reason } = req.body as { isArchived: boolean; reason?: string };
    const { error } = await supabaseService.getClient().from('groups').update({ is_archived: isArchived === true }).eq('id', id);
    if (error) throw error;
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: isArchived ? 'group_archive' : 'group_suspend',
      targetType: 'group',
      targetId: id,
      reason,
    });
    res.json({ success: true, data: { id, is_archived: isArchived === true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/messages
router.get('/messages', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const groupId = (req.query.groupId as string) || '';
    const offset = (page - 1) * limit;
    let query = supabaseService.getClient()
      .from('messages')
      .select('id, group_id, sender_id, text, timestamp, type, sender:profiles!messages_sender_id_fkey(id, name, username)', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    if (groupId) query = query.eq('group_id', groupId);
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// DELETE /api/v1/admin/messages/:id
router.delete('/messages/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const { error } = await supabaseService.getClient().from('messages').delete().eq('id', id);
    if (error) throw error;
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'message_delete',
      targetType: 'message',
      targetId: id,
      reason,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/decks
router.get('/decks', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const search = (req.query.search as string)?.trim() || '';
    const offset = (page - 1) * limit;
    let query = supabaseService.getClient()
      .from('decks')
      .select('id, name, description, user_id, created_at, removed_by_admin_at, owner:profiles!decks_user_id_fkey(id, name, username)', { count: 'exact' })
      .is('removed_by_admin_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (search) {
      const safe = escapePostgrestSearch(search);
      query = query.ilike('name', `%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;

    const deckIds = (data || []).map((d: any) => d.id);
    const cardCounts: Record<string, number> = {};
    if (deckIds.length) {
      const { data: cards } = await supabaseService.getClient().from('flashcards').select('deck_id').in('deck_id', deckIds);
      for (const c of cards || []) {
        cardCounts[c.deck_id] = (cardCounts[c.deck_id] || 0) + 1;
      }
    }

    res.json({
      success: true,
      data: (data || []).map((d: any) => ({ ...d, card_count: cardCounts[d.id] || 0 })),
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// DELETE /api/v1/admin/decks/:id
router.delete('/decks/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const { error } = await supabaseService.getClient().from('decks').update({ removed_by_admin_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'deck_remove',
      targetType: 'deck',
      targetId: id,
      reason,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/offline/summary
router.get('/offline/summary', async (req: any, res: any) => {
  try {
    // count:'exact' so the console can say "showing 50 of N" — the hard cap
    // used to be invisible, indistinguishable from a complete list.
    const { data: bundles, error, count } = await supabaseService.getClient()
      .from('offline_bundles')
      .select('id, user_id, display_name, group_name, updated_at, created_at', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const rows = bundles || [];
    const userIds = [...new Set(rows.map((b: { user_id: string }) => b.user_id).filter(Boolean))];
    let profileById: Record<string, { id: string; name?: string; username?: string }> = {};

    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await supabaseService.getClient()
        .from('profiles')
        .select('id, name, username')
        .in('id', userIds);
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// POST /api/v1/admin/ai/quota/reset
router.post('/ai/quota/reset', async (req: any, res: any) => {
  try {
    const { userId, feature } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
    await resetAIUsageForUser(userId, feature || undefined);
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: 'ai_quota_reset',
      targetType: 'user',
      targetId: userId,
      metadata: { feature: feature || 'all' },
    });
    res.json({ success: true, data: { userId, feature: feature || 'all', usage: await getAllAIUsageForUser(userId) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/ai/companion/:userId
router.get('/ai/companion/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const { data, error } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ success: true, data: (data || []).reverse() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// GET /api/v1/admin/ai/quota/:userId
router.get('/ai/quota/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    res.json({ success: true, data: { userId, quotas: await getAllAIUsageForUser(userId), global: await getAIUsage(userId) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// ─── Jobs board admin ────────────────────────────────────────────────────────

router.get('/jobs/postings', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || '';
    const result = await getJobsBoardService(supabaseService).adminListPostings(page, limit, status || undefined);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.patch('/jobs/postings/:id', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.delete('/jobs/postings/:id', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.get('/jobs/companies', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const status = (req.query.status as string) || '';
    const result = await getJobsBoardService(supabaseService).adminListCompanies(page, limit, status || undefined);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

router.patch('/jobs/companies/:id/verification', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

// Thin job-posting filter over the generic queue (content_reports, target_type
// 'job_posting'; legacy job_reports rows were backfilled). Keeps the shape the
// jobs admin console reads (`posting: { id, title, status }`).
router.get('/jobs/reports', async (req: any, res: any) => {
  try {
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
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

router.patch('/jobs/reports/:id', validateUuidParam('id'), handleValidationErrors, async (req: any, res: any) => {
  try {
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
    const { data: updated, error } = await supabaseService
      .getClient()
      .from('content_reports')
      .update({
        status: 'resolved',
        admin_note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
        resolved_by: req.user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
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
  } catch (err: any) {
    respondModerationError(res, err);
  }
});

router.patch('/jobs/postings/:id/school-approval', async (req: any, res: any) => {
  try {
    const { getJobsBoardService } = await import('../services/jobsBoard');
    const approve = req.body?.approve !== false;
    const posting = await getJobsBoardService(supabaseService).schoolApprovePosting(req.params.id, approve);
    await logAdminAction(supabaseService, {
      actorId: req.user.id,
      action: approve ? 'job_school_approve' : 'job_school_reject',
      targetType: 'job_posting',
      targetId: req.params.id,
    });
    res.json({ success: true, data: posting });
  } catch (err: any) {
    res.status(500).json({ success: false, error: clientErrorMessage(err) });
  }
});

export default router;
