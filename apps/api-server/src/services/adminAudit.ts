import { SupabaseService } from './supabase';
import { getRedisClient, redisKey } from './redisStore';

const BAN_CACHE_TTL_SEC = 60;

export type AdminAuditAction =
  | 'user_ban'
  | 'user_unban'
  | 'user_role_grant'
  | 'user_role_revoke'
  | 'listing_remove'
  | 'listing_suspend'
  | 'listing_activate'
  | 'report_dismiss'
  | 'report_warn_seller'
  | 'report_remove_listing'
  | 'points_award'
  | 'badge_award'
  | 'notification_send'
  | 'group_suspend'
  | 'group_archive'
  | 'message_delete'
  | 'deck_remove'
  | 'ai_quota_reset'
  | 'user_delete'
  | 'order_dispute_release_seller'
  | 'order_dispute_refund_buyer'
  | 'job_activate'
  | 'job_suspend'
  | 'job_status'
  | 'job_remove'
  | 'job_company_verification'
  | 'job_school_approve'
  | 'job_school_reject'
  // Phase 1 · E — generic content reports, strikes, suspension, appeals
  | 'report_under_review'
  | 'report_resolve'
  | 'report_warn'
  | 'report_remove_content'
  | 'report_strike'
  | 'strike_add'
  | 'user_suspend'
  | 'user_unsuspend'
  | 'listing_appeal_upheld'
  | 'listing_appeal_reversed'
  // Community governance (20260908120000) — the SAME audit log every other
  // moderation action writes. There is one moderation stack.
  | 'community_role_set'
  | 'community_member_mute'
  | 'community_member_unmute'
  | 'community_post_remove'
  | 'community_post_answer'
  | 'community_post_unanswer'
  | 'community_invite_create'
  | 'community_invite_revoke';

export async function logAdminAction(
  supabaseService: SupabaseService,
  params: {
    actorId: string;
    action: AdminAuditAction;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    reason?: string;
  }
): Promise<void> {
  try {
    await supabaseService.getClient().from('admin_audit_log').insert({
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? {},
      reason: params.reason ?? null,
    });
  } catch (err) {
    console.warn('Failed to write admin audit log:', err);
  }
}

export async function invalidateBanCache(userId: string): Promise<void> {
  const redis = await getRedisClient();
  if (redis?.isOpen) {
    await redis.del(redisKey(`ban:${userId}`));
  }
}

export interface UserBlockState {
  /** Permanent admin ban (settings.is_banned / account_status = 'banned'). */
  banned: boolean;
  /** settings.suspended_until when it lies in the future; null otherwise. */
  suspendedUntil: string | null;
}

/** True when `suspendedUntil` is a valid ISO timestamp in the future. */
export function isSuspendedUntilActive(suspendedUntil: unknown, now: Date = new Date()): suspendedUntil is string {
  if (typeof suspendedUntil !== 'string' || !suspendedUntil) return false;
  const until = new Date(suspendedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}

/** Derive the block state from a profile's settings JSONB (pure; used by the cache + tests). */
export function blockStateFromSettings(settings: unknown, now: Date = new Date()): UserBlockState {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const banned = s.is_banned === true || s.account_status === 'banned';
  const suspendedUntil = isSuspendedUntilActive(s.suspended_until, now) ? (s.suspended_until as string) : null;
  return { banned, suspendedUntil };
}

/**
 * Ban OR time-boxed suspension state for a user. Cached in Redis for
 * BAN_CACHE_TTL_SEC (the cache value is '1' banned / '0' clear / 's:<iso>'
 * suspended-until so an expiring suspension re-evaluates on every read).
 */
export async function getUserBlockState(supabaseService: SupabaseService, userId: string): Promise<UserBlockState> {
  const redis = await getRedisClient();
  const cacheKey = redisKey(`ban:${userId}`);
  if (redis?.isOpen) {
    const cached = await redis.get(cacheKey);
    if (cached === '1') return { banned: true, suspendedUntil: null };
    if (cached === '0') return { banned: false, suspendedUntil: null };
    if (cached && cached.startsWith('s:')) {
      const until = cached.slice(2);
      // A cached suspension that has since lapsed falls through to a fresh read.
      if (isSuspendedUntilActive(until)) return { banned: false, suspendedUntil: until };
    }
  }

  const { data, error } = await supabaseService
    .getClient()
    .from('profiles')
    .select('settings')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return { banned: false, suspendedUntil: null };
  const state = blockStateFromSettings(data.settings);

  if (redis?.isOpen) {
    const value = state.banned ? '1' : state.suspendedUntil ? `s:${state.suspendedUntil}` : '0';
    await redis.setEx(cacheKey, BAN_CACHE_TTL_SEC, value);
  }
  return state;
}

/** Blocked from using the service: banned OR currently suspended. */
export async function isUserBanned(supabaseService: SupabaseService, userId: string): Promise<boolean> {
  const state = await getUserBlockState(supabaseService, userId);
  return state.banned || state.suspendedUntil !== null;
}

export async function countPlatformAdmins(supabaseService: SupabaseService): Promise<number> {
  const { count } = await supabaseService
    .getClient()
    .from('platform_admins')
    .select('user_id', { count: 'exact', head: true });
  return count ?? 0;
}
