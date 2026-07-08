import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@lantern/shared/accountLifecycle';
import type { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { invalidateBanCache } from './adminAudit';
import { deleteUserAccountFully } from './userDataLifecycle';
import { logger } from '../utils/logger';

export interface AccountLifecycleRow {
  id: string;
  email?: string | null;
  deactivated_at?: string | null;
  deletion_scheduled_at?: string | null;
  settings?: Record<string, unknown> | null;
}

export async function getAccountLifecycle(
  supabaseService: SupabaseService,
  userId: string
): Promise<AccountLifecycleRow | null> {
  const { data, error } = await supabaseService
    .getClient()
    .from('profiles')
    .select('id, deactivated_at, deletion_scheduled_at, settings')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  let email: string | null = null;
  try {
    const { data: authData } = await supabaseService.getClient().auth.admin.getUserById(userId);
    email = authData?.user?.email ?? null;
  } catch {
    email = null;
  }

  return { ...(data as AccountLifecycleRow), email };
}

export function isAccountDeactivated(row: AccountLifecycleRow | null): boolean {
  if (!row) return false;
  const settings = (row.settings || {}) as Record<string, unknown>;
  if (settings.is_banned === true || settings.account_status === 'banned') return false;
  return (
    settings.account_status === 'deactivated' ||
    row.deletion_scheduled_at != null ||
    row.deactivated_at != null
  );
}

export function isDeactivatedLifecycleRoute(method: string, path: string, userId: string): boolean {
  const allowed: Array<[string, string]> = [
    ['GET', `/${userId}`],
    ['GET', `/${userId}/export`],
    ['GET', `/${userId}/lifecycle`],
    ['POST', `/${userId}/reactivate`],
    ['POST', `/${userId}/delete-immediate`],
    ['POST', `/${userId}/import`],
  ];
  return allowed.some(([m, p]) => m === method && path === p);
}

export async function scheduleAccountDeletion(
  supabaseService: SupabaseService,
  userId: string,
  graceDays = ACCOUNT_DELETION_GRACE_DAYS
): Promise<{ deletionScheduledAt: string; deactivatedAt: string }> {
  const row = await getAccountLifecycle(supabaseService, userId);
  if (!row) throw new Error('User not found');

  const now = new Date();
  const deletionDate = new Date(now);
  deletionDate.setDate(deletionDate.getDate() + graceDays);

  const deactivatedAt = now.toISOString();
  const deletionScheduledAt = deletionDate.toISOString();

  const baseSettings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? { ...(row.settings as Record<string, unknown>) }
      : {};

  const mergedSettings = {
    ...baseSettings,
    account_status: 'deactivated',
  };

  const { error } = await supabaseService
    .getClient()
    .from('profiles')
    .update({
      deactivated_at: deactivatedAt,
      deletion_scheduled_at: deletionScheduledAt,
      settings: mergedSettings,
      updated_at: deactivatedAt,
    })
    .eq('id', userId);

  if (error) throw error;

  await cacheService.invalidateUserCache(userId);
  await invalidateBanCache(userId);

  logger.info('Account scheduled for deletion', { userId, deletionScheduledAt });

  return { deletionScheduledAt, deactivatedAt };
}

export async function reactivateAccount(
  supabaseService: SupabaseService,
  userId: string
): Promise<boolean> {
  const row = await getAccountLifecycle(supabaseService, userId);
  if (!row || !isAccountDeactivated(row)) {
    return false;
  }

  const baseSettings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? { ...(row.settings as Record<string, unknown>) }
      : {};

  const mergedSettings: Record<string, unknown> = {
    ...baseSettings,
    account_status: 'active',
  };
  delete mergedSettings.deactivated_at;
  delete mergedSettings.deletion_scheduled_at;

  const { error } = await supabaseService
    .getClient()
    .from('profiles')
    .update({
      deactivated_at: null,
      deletion_scheduled_at: null,
      settings: mergedSettings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;

  await cacheService.invalidateUserCache(userId);
  await invalidateBanCache(userId);

  logger.info('Account reactivated', { userId });
  return true;
}

export async function verifyUserPassword(
  email: string,
  password: string
): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    logger.warn('SUPABASE_ANON_KEY missing — password verification skipped');
    return false;
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

export async function purgeScheduledAccountDeletions(
  supabaseService: SupabaseService
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseService
    .getClient()
    .from('profiles')
    .select('id')
    .not('deletion_scheduled_at', 'is', null)
    .lte('deletion_scheduled_at', now);

  if (error) {
    logger.error('Failed to list scheduled account deletions', { error: error.message });
    return 0;
  }

  let count = 0;
  for (const row of data || []) {
    try {
      const deleted = await deleteUserAccountFully(supabaseService, row.id);
      if (deleted) count += 1;
    } catch (err) {
      logger.error('Scheduled account deletion failed', { userId: row.id, err });
    }
  }

  if (count > 0) {
    logger.info('Purged scheduled account deletions', { count });
  }
  return count;
}
