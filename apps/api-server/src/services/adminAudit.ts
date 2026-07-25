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
  | 'job_school_reject';

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

export async function isUserBanned(supabaseService: SupabaseService, userId: string): Promise<boolean> {
  const redis = await getRedisClient();
  const cacheKey = redisKey(`ban:${userId}`);
  if (redis?.isOpen) {
    const cached = await redis.get(cacheKey);
    if (cached === '1') return true;
    if (cached === '0') return false;
  }

  const { data, error } = await supabaseService
    .getClient()
    .from('profiles')
    .select('settings')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return false;
  const settings = (data.settings || {}) as Record<string, unknown>;
  const banned = settings.is_banned === true || settings.account_status === 'banned';

  if (redis?.isOpen) {
    await redis.setEx(cacheKey, BAN_CACHE_TTL_SEC, banned ? '1' : '0');
  }
  return banned;
}

export async function countPlatformAdmins(supabaseService: SupabaseService): Promise<number> {
  const { count } = await supabaseService
    .getClient()
    .from('platform_admins')
    .select('user_id', { count: 'exact', head: true });
  return count ?? 0;
}
