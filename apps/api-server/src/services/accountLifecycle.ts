import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@lantern/shared/accountLifecycle';
import type { DataLayer } from './data';
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
  layer: DataLayer,
  userId: string
): Promise<AccountLifecycleRow | null> {
  const { data, error } = await layer
    .getClient()
    .from('profiles')
    .select('id, deactivated_at, deletion_scheduled_at, settings')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  let email: string | null = null;
  try {
    const { data: authData } = await layer.getClient().auth.admin.getUserById(userId);
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
  const normalized = path.replace(/\/+$/, '') || '/';
  const allowed: Array<[string, string]> = [
    ['GET', `/${userId}`],
    ['GET', `/${userId}/export`],
    ['GET', `/${userId}/lifecycle`],
    ['POST', `/${userId}/deactivate`],
    ['POST', `/${userId}/reactivate`],
    ['POST', `/${userId}/delete-immediate`],
    ['POST', `/${userId}/import`],
    ['POST', '/logout'],
    ['GET', '/session'],
  ];
  return allowed.some(([m, p]) => {
    if (m !== method) return false;
    if (normalized === p) return true;
    // Auth router may be seen as /logout or a prefixed path depending on mount.
    if (p === '/logout' || p === '/session') {
      return normalized === p || normalized.endsWith(p);
    }
    return false;
  });
}

export async function scheduleAccountDeletion(
  layer: DataLayer,
  userId: string,
  graceDays = ACCOUNT_DELETION_GRACE_DAYS
): Promise<{ deletionScheduledAt: string; deactivatedAt: string }> {
  const row = await getAccountLifecycle(layer, userId);
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

  const { error } = await layer
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
  layer: DataLayer,
  userId: string
): Promise<boolean> {
  const row = await getAccountLifecycle(layer, userId);
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

  const { error } = await layer
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

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  // FIXED (F6): a successful re-verification minted a real GoTrue session whose
  // refresh token stayed valid server-side long after this request ended — a
  // password prompt shown before an irreversible action was quietly handing out
  // a spare key. Revoke it. `scope: 'local'` revokes only THIS session's
  // refresh token; a global sign-out would log the user out of every device
  // just for confirming their password.
  if (data?.session) {
    try {
      await client.auth.signOut({ scope: 'local' });
    } catch (err) {
      logger.warn('Failed to revoke password-verification session', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return !error;
}

export async function purgeScheduledAccountDeletions(
  layer: DataLayer
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await layer
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
      // FIXED (F6): `deleteUserAccountFully` now reports partial erasure rather
      // than a bare boolean. A partial run still counts — the account is gone —
      // but it is logged at error level with the failing buckets so support can
      // finish the storage cleanup by hand.
      // TRANSITIONAL (M2d): `deleteUserAccountFully` still takes the `SupabaseService` facade whole.
      const result = await deleteUserAccountFully(layer, row.id);
      if (result.found) count += 1;
      if (result.found && !result.ok) {
        logger.error('Scheduled account deletion partially completed', {
          userId: row.id,
          code: 'PARTIAL_DELETION',
          purged: result.purged,
          failures: result.failures,
        });
      }
    } catch (err) {
      logger.error('Scheduled account deletion failed', { userId: row.id, err });
    }
  }

  if (count > 0) {
    logger.info('Purged scheduled account deletions', { count });
  }
  return count;
}
