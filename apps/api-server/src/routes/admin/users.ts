/**
 * Admin console: user administration, enforcement and per-user tools.
 *
 * `GET /users` searches in three modes: an exact UUID, an email (the
 * `admin_search_users_by_email` RPC, with a bounded legacy page scan only if
 * the migration is not applied), or a name/username ilike. Free-text always
 * goes through `escapePostgrestSearch` before it reaches a PostgREST `.or()`
 * filter. Email and admin flags come from GoTrue and are cached for ten
 * minutes under `authMeta:<id>`.
 *
 * Three escalating enforcement levels, all audited:
 *   strike     — `POST /users/:id/strikes`; three active strikes auto-suspend
 *   suspended  — time-boxed (`settings.suspended_until`, at most
 *                MAX_SUSPENSION_DAYS), no sign-out; the API answers
 *                ACCOUNT_SUSPENDED until it lapses, and the user is notified
 *   banned     — `settings.is_banned` + global sign-out + session cutoff +
 *                a GoTrue `banned_until` write
 * `status: 'active'` is the single un-do: it clears the ban, the suspension
 * and the GoTrue ban together.
 *
 * `PATCH /users/:id/role` is the highest-privilege route in the API and
 * carries six rails. Read the comment on it before touching it.
 *
 * The direct tools at the end — notifications, points, badges, AI quota — all
 * audit too, and `force: true` on a notification bypasses the recipient's
 * preferences because these are moderation and support messages, not
 * marketing. `GET /ai/companion/:userId` reads a named student's private
 * conversation and audits BEFORE the read (F10).
 *
 * Mounted by ./index into the admin router; see that file for the mount stack,
 * the live platform-admin gate and the audit convention every mutating route
 * here obeys. Shared state and helpers come from ./context, the error mapping
 * from ./errors, and every database access from services/adminData — this file
 * performs none of its own.
 */
import { Router } from 'express';
import {
  handleValidationErrors,
  validateUuidParam,
  validateAdminUserStatus,
  validateAdminUserRole,
  validateAdminPointsAdjust,
  validateAdminNotification,
  validateAdminBulkNotification,
} from '../../middleware/validation';
import { getAIUsage, resetAIUsageForUser, getAllAIUsageForUser } from '../../middleware/aiRateLimit';
import { clearAuthTokenCache } from '../../middleware/auth';
import { logAdminAction, countPlatformAdmins, invalidateBanCache } from '../../services/adminAudit';
import { getModerationService } from '../../services/moderation';
import { setUserSessionCutoff } from '../../services/tokenDenylist';
import * as adminData from '../../services/adminData';
import { AUTH_BAN_DURATION } from '../../services/adminData';
import { logger } from '../../utils/logger';
import { MAX_SUSPENSION_DAYS, isSuspensionActive } from '@lantern/shared/moderation';
import { cacheService, dataLayer } from './context';
import {
  daysAgoIso,
  escapePostgrestSearch,
  getAuthUserInfoForUserIds,
  resolveRoleManagementEnabled,
} from './context';
import { adminRoute, mappedRoute, moderationRoute, respondBadgeError } from './errors';

const router = Router();


// ===========================================================================
// User administration — search, status, strikes, role
//
// `GET /users` searches in three modes: an exact UUID, an email (the
// `admin_search_users_by_email` RPC, with a bounded legacy page scan only if
// the migration is not applied), or a name/username ilike. Free-text always
// goes through `escapePostgrestSearch` before it reaches a PostgREST `.or()`
// filter. Email and admin flags come from GoTrue and are cached for ten
// minutes under `authMeta:<id>`.
//
// Three escalating enforcement levels, all audited:
//   strike     — `POST /users/:id/strikes`; three active strikes auto-suspend
//   suspended  — time-boxed (`settings.suspended_until`, at most
//                MAX_SUSPENSION_DAYS), no sign-out; the API answers
//                ACCOUNT_SUSPENDED until it lapses, and the user is notified
//   banned     — `settings.is_banned` + global sign-out + session cutoff +
//                a GoTrue `banned_until` write
// `status: 'active'` is the single un-do: it clears the ban, the suspension
// and the GoTrue ban together.
// ===========================================================================

// GET /api/v1/admin/users
router.get('/users', adminRoute(async (req: any, res: any) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const search = (req.query.search as string)?.trim() || '';
  const offset = (page - 1) * limit;

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (search && uuidPattern.test(search)) {
    const { data: profile, error } = await adminData.getUserForAdminList(dataLayer, search);
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
    const { data: emailMatches, error: rpcError } = await adminData.searchUsersByEmail(dataLayer,
      search,
      limit
    );

    if (!rpcError && Array.isArray(emailMatches) && emailMatches.length > 0) {
      const ids = emailMatches.map((m: any) => m.id);
      const { data: profiles } = await adminData.getUsersForAdminList(dataLayer, ids);
      const profileById = new Map<string, any>((profiles || []).map((p: any) => [p.id, p]));
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
      let matchedUser: any = null;
      for (let authPage = 1; authPage <= 5 && !matchedUser; authPage++) {
        const { data: authData } = await adminData.listAuthUsers(dataLayer, authPage, 200);
        matchedUser = (authData?.users || []).find((u: any) =>
          u.email?.toLowerCase().includes(search.toLowerCase())
        );
        if ((authData?.users || []).length < 200) break;
      }
      if (matchedUser) {
        const { data: profile } = await adminData.getUserForAdminList(dataLayer,
          matchedUser.id
        );
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

  const { data, error, count } = await adminData.listUsersPage(dataLayer, {
    escapedSearch: search ? escapePostgrestSearch(search) : undefined,
    offset,
    limit,
  });
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
}));

router.patch('/users/:id/status', validateAdminUserStatus, handleValidationErrors, adminRoute(async (req: any, res: any) => {
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

  const { data: profile, error: fetchErr } = await adminData.getUserSettings(dataLayer, id);

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

  const { error } = await adminData.setUserSettings(dataLayer, id, nextSettings);
  if (error) throw error;

  await logAdminAction(dataLayer, {
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

  let authBanApplied: boolean | null = null;

  if (status === 'banned') {
    try {
      await adminData.signOutEverywhere(dataLayer, id);
    } catch (signOutErr) {
      logger.warn('Supabase global signOut failed on ban', { id, signOutErr });
    }
    await setUserSessionCutoff(id);
    // Ban at the AUTH layer too, not just in profiles.settings. Signing the
    // user out only invalidates the tokens they already hold — without this
    // they can sign in again immediately and get a fresh one. GoTrue refuses
    // to issue tokens at all while banned_until is in the future.
    // Best-effort by design: `setAuthBan` swallows its own failure and
    // returns false, which is surfaced to the console as `authBanApplied`.
    // The authoritative ban is the `profiles.settings` record written above
    // — `authMiddleware` and `POST /api/v1/auth/refresh` both consult it
    // through `rejectIfBanned`, so a failed GoTrue write does not reopen the
    // API. What it does reopen is token minting outside the API: a client
    // talking to GoTrue directly with the anon key can still sign in. Treat
    // `authBanApplied: false` as work to redo, not as noise.
    authBanApplied = await adminData.applyAuthBan(dataLayer, id, AUTH_BAN_DURATION);
  } else if (status === 'active') {
    // Lift the auth-layer ban, or an unbanned user could never sign in again.
    authBanApplied = await adminData.applyAuthBan(dataLayer, id, 'none');
  } else if (status === 'suspended') {
    await dataLayer.notifications.createNotification(id, {
        type: 'warning',
        message: `Your account has been suspended by Lantern moderation until ${new Date(suspendedUntil!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.${reason ? ` Reason: ${reason}.` : ''} Contact support@lanternstudy.com to appeal.`,
        link: 'settings:account',
        data: { suspendedUntil, kind: 'account_suspended' },
        force: true,
      })
      .catch((notifyErr) => logger.warn('Suspension notification failed', { id, notifyErr }));
  }

  res.json({ success: true, data: { id, status, suspendedUntil, authBanApplied } });
}));

// POST /api/v1/admin/users/:id/strikes — add a moderation strike by hand
// (3 active strikes auto-suspend for 14 days; audited inside the service).
router.post('/users/:id/strikes', validateUuidParam('id'), handleValidationErrors, moderationRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { reason, severity, reportId } = req.body || {};
  const result = await getModerationService(dataLayer).addStrike(id, {
    reason,
    severity,
    reportId,
    createdBy: req.user.id,
  });
  await logAdminAction(dataLayer, {
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
}));

// GET /api/v1/admin/users/:id/strikes
router.get('/users/:id/strikes', validateUuidParam('id'), handleValidationErrors, moderationRoute(async (req: any, res: any) => {
  const moderation = getModerationService(dataLayer);
  const [strikes, state] = await Promise.all([
    moderation.listStrikes(req.params.id),
    moderation.getModerationState(req.params.id),
  ]);
  res.json({ success: true, data: { strikes, ...state } });
}));

// PATCH /api/v1/admin/users/:id/role — grant or revoke platform admin.
//
// The highest-privilege route in the API. It carries six rails, and every one
// of them exists because the alternative is an account that cannot be
// recovered. Do not remove or soften any of them:
//
//   1. The platform-admin gate at the mount (a live `platform_admins` lookup,
//      never a JWT claim — see the file header).
//   2. A kill switch, `ENABLE_ADMIN_ROLE_MANAGEMENT=false`, read per request
//      via `resolveRoleManagementEnabled` so the console's reported state and
//      the route's behaviour can never disagree. Default is ON.
//   3. A typed confirmation phrase — the body must carry
//      `confirmationPhrase: 'CONFIRM_ADMIN_ROLE_CHANGE'`, so the change cannot
//      be a mis-click or a replayed URL.
//   4. No self-revoke: an admin may not remove their own role.
//   5. A last-admin guard — `countPlatformAdmins` must exceed one before the
//      current admin flag can be cleared, so the platform can never be left
//      with nobody who can administer it.
//   6. An audit entry (`user_role_grant` / `user_role_revoke`) and, on revoke,
//      a forced global sign-out plus `setUserSessionCutoff`, so tokens already
//      issued to the demoted account stop working immediately.
//
// The grant is written in three places that must stay in step: GoTrue
// `app_metadata.is_platform_admin`, `profiles.settings.is_platform_admin`
// (display only) and the `platform_admins` row that `isLivePlatformAdmin`
// actually reads. `clearAuthTokenCache()` at the end drops the 15-second JWT
// verification cache so the change is not delayed by a TTL.
router.patch('/users/:id/role', validateAdminUserRole, handleValidationErrors, adminRoute(async (req: any, res: any) => {
  if (!resolveRoleManagementEnabled()) {
    return res.status(403).json({
      success: false,
      error:
        'Role management is switched off on this server (ENABLE_ADMIN_ROLE_MANAGEMENT=false). Remove that variable to allow it.',
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

  const { data: userData, error: fetchErr } = await adminData.getAuthUser(dataLayer, id);
  if (fetchErr || !userData?.user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const currentlyAdmin = userData.user.app_metadata?.is_platform_admin === true;
  if (currentlyAdmin && isPlatformAdmin !== true) {
    const adminCount = await countPlatformAdmins(dataLayer);
    if (adminCount <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot remove the last platform admin.' });
    }
  }

  const existingMetadata = userData.user.app_metadata || {};
  const nextMetadata = {
    ...existingMetadata,
    is_platform_admin: isPlatformAdmin === true,
  };

  const { error: updateErr } = await adminData.setAuthUserMetadata(dataLayer, id, nextMetadata);
  if (updateErr) throw updateErr;

  const { data: profile } = await adminData.getUserSettings(dataLayer, id);
  const nextSettings = {
    ...(profile?.settings || {}),
    is_platform_admin: isPlatformAdmin === true,
  };
  await adminData.setUserSettings(dataLayer, id, nextSettings);

  if (isPlatformAdmin === true) {
    await adminData.grantPlatformAdmin(dataLayer, id, req.user.id);
  } else {
    await adminData.revokePlatformAdmin(dataLayer, id);
  }

  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: isPlatformAdmin ? 'user_role_grant' : 'user_role_revoke',
    targetType: 'user',
    targetId: id,
  });

  if (isPlatformAdmin !== true) {
    try {
      await adminData.signOutEverywhere(dataLayer, id);
    } catch (signOutErr) {
      logger.warn('Supabase global signOut failed on role revoke', { id, signOutErr });
    }
    await setUserSessionCutoff(id);
  }

  // SEC-09: drop JWT verification cache so grant/revoke is not delayed by TTL.
  clearAuthTokenCache();

  res.json({ success: true, data: { id, is_platform_admin: isPlatformAdmin === true } });
}));

// GET /api/v1/admin/users/:id
router.get('/users/:id', adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const last7d = daysAgoIso(7);

  const { data: profile, error } = await adminData.getUserDetail(dataLayer, id);
  if (error) throw error;
  if (!profile) return res.status(404).json({ success: false, error: 'User not found' });

  const authMap = await getAuthUserInfoForUserIds([id]);
  const [{ groupCount, listingCount, deckCount, aiEvents7d }, activeStrikes] = await Promise.all([
    adminData.getUserCounts(dataLayer, id, last7d),
    getModerationService(dataLayer).countActiveStrikes(id).catch(() => 0),
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
}));

// ===========================================================================
// Direct user tools — notifications, points, badges, content removal
//
// `force: true` on the single notification bypasses the recipient's
// notification preferences: these are moderation and support messages, not
// marketing. Content removal is soft where a user might appeal
// (`decks.removed_by_admin_at`, `groups.is_archived`) and hard only for
// messages. All of them audit.
// ===========================================================================

// POST /api/v1/admin/notifications
router.post('/notifications', validateAdminNotification, handleValidationErrors, adminRoute(async (req: any, res: any) => {
  const { userId, message, link, type = 'info' } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ success: false, error: 'userId and message are required' });
  }
  const notification = await dataLayer.notifications.createNotification(userId, { message, link, type, force: true });
  await cacheService.deletePattern(`notifications:${userId}:*`);
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'notification_send',
    targetType: 'user',
    targetId: userId,
    metadata: { type },
  });
  res.status(201).json({ success: true, data: notification });
}));

// POST /api/v1/admin/notifications/bulk
router.post('/notifications/bulk', validateAdminBulkNotification, handleValidationErrors, adminRoute(async (req: any, res: any) => {
  const { userIds, message, link, type = 'info' } = req.body;
  const notifications = userIds.map((uid: string) => ({ userId: uid, message, link, type }));
  const created = await dataLayer.notifications.createBulkNotifications(notifications);
  for (const uid of userIds) {
    await cacheService.deletePattern(`notifications:${uid}:*`);
  }
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'notification_send',
    targetType: 'bulk',
    metadata: { count: userIds.length, type },
  });
  res.status(201).json({ success: true, data: created, count: created.length });
}));

// POST /api/v1/admin/users/:id/points
router.post('/users/:id/points', validateAdminPointsAdjust, handleValidationErrors, adminRoute(async (req: any, res: any) => {
  const { id } = req.params;
  const { points, reason, source = 'admin' } = req.body;
  if (typeof points !== 'number' || !Number.isFinite(points)) {
    return res.status(400).json({ success: false, error: 'points must be a number' });
  }
  const result = await dataLayer.gamification.awardPoints(id, points, reason || 'Admin adjustment', source);
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'points_award',
    targetType: 'user',
    targetId: id,
    metadata: { points, reason },
  });
  res.json({ success: true, data: result });
}));

// POST /api/v1/admin/users/:id/badge
router.post('/users/:id/badge', mappedRoute(respondBadgeError, async (req: any, res: any) => {
  const { id } = req.params;
  const { badgeId } = req.body;
  if (!badgeId) return res.status(400).json({ success: false, error: 'badgeId is required' });
  const result = await dataLayer.gamification.awardBadge(id, badgeId, req.user.id);
  await cacheService.deletePattern(`gamification:user:badges:${id}:*`);
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'badge_award',
    targetType: 'user',
    targetId: id,
    metadata: { badgeId, awarded: result.awarded },
  });
  res.json({ success: true, data: result });
}));

// ===========================================================================
// AI quota and companion history
//
// Quota lives in `middleware/aiRateLimit`, not in a table, so a reset is a
// counter write rather than a row update — it is audited here because it hands
// a user more paid inference.
// ===========================================================================

// POST /api/v1/admin/ai/quota/reset
router.post('/ai/quota/reset', adminRoute(async (req: any, res: any) => {
  const { userId, feature } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  await resetAIUsageForUser(userId, feature || undefined);
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'ai_quota_reset',
    targetType: 'user',
    targetId: userId,
    metadata: { feature: feature || 'all' },
  });
  res.json({ success: true, data: { userId, feature: feature || 'all', usage: await getAllAIUsageForUser(userId) } });
}));

// GET /api/v1/admin/ai/companion/:userId
//
// FIXED (F10): this reads a named student's private AI companion conversation,
// so it now audits like its neighbours. The audit is written BEFORE the read,
// not after: an admin who opens a conversation and then hits a 500 still read
// the request, and a trail that only records successful reads is a trail an
// admin can step around. `logAdminAction` swallows its own errors, so a failing
// audit table cannot break the console.
router.get('/ai/companion/:userId', adminRoute(async (req: any, res: any) => {
  const { userId } = req.params;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  await logAdminAction(dataLayer, {
    actorId: req.user.id,
    action: 'ai_companion_history_view',
    targetType: 'user',
    targetId: userId,
    metadata: { limit },
  });
  const { data, error } = await adminData.listCompanionMessages(dataLayer, userId, limit);
  if (error) throw error;
  res.json({ success: true, data: (data || []).reverse() });
}));

// GET /api/v1/admin/ai/quota/:userId
router.get('/ai/quota/:userId', adminRoute(async (req: any, res: any) => {
  const { userId } = req.params;
  res.json({ success: true, data: { userId, quotas: await getAllAIUsageForUser(userId), global: await getAIUsage(userId) } });
}));

export default router;
