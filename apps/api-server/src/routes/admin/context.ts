/**
 * Shared state and helpers for the admin sub-routers.
 *
 * `supabaseService` and `cacheService` are injected once from server.ts (via
 * `initializeAdminRoutes` in ./index) and then read as live ES-module bindings
 * by every sub-router — the same single-assignment shape the file had before
 * the M4 split, without threading the services through five modules.
 *
 * Everything else here is a helper more than one sub-router needs. Two of them
 * are load-bearing rather than convenient:
 *
 *   `escapePostgrestSearch` is the only thing standing between an admin's
 *   search box and a PostgREST `.or()` filter, where `%`, `_` and `,` are
 *   syntax. Every free-text search in the console goes through it.
 *
 *   `resolveRoleManagementEnabled` is read PER REQUEST, never at module load,
 *   so the state the console reports and the state the role route enforces can
 *   never disagree.
 *
 * `getAuthUserInfoForUserIds` is the console's one join across the two halves
 * of a user: `profiles` holds the display row, GoTrue holds the email and
 * `app_metadata.is_platform_admin`. It is cached for ten minutes under
 * `authMeta:<id>` — the same key `invalidateBanCache` clears, so a ban or a
 * role change is not hidden behind the TTL.
 */
import { SupabaseService } from '../../services/supabase';
import { CacheService } from '../../services/cache';
import * as adminData from '../../services/adminData';

// Initialized from the main server; every sub-router imports these bindings.
export let supabaseService: SupabaseService;
export let cacheService: CacheService;

export const initializeAdminContext = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

/**
 * The flat per-event cost used only for windows recorded before token logging
 * existed. Env-tunable because it is pricing, not code.
 */
export const AI_EVENT_ESTIMATED_COST_USD = parseFloat(
  process.env.ADMIN_AI_EVENT_COST_USD || '0.0025'
);

/**
 * Platform-admin role management from the admin console.
 *
 * This was opt-in (ENABLE_ADMIN_ROLE_MANAGEMENT=true) and therefore off
 * everywhere, so the console's "Make admin" button always 403'd and the only
 * way to grant admin was the Supabase dashboard. The rails that actually
 * matter live on the route itself — platform-admin auth, a typed confirmation
 * phrase, no revoking your own role, no removing the last admin, an audit
 * entry, and a forced global sign-out on revoke — so the default is now ON.
 * The variable stays as a kill switch: set it to "false" to disable.
 *
 * Read per request rather than at module load so the console's reported state
 * and the route's behaviour can never disagree.
 */
export function resolveRoleManagementEnabled(
  raw: string | undefined = process.env.ENABLE_ADMIN_ROLE_MANAGEMENT
): boolean {
  return String(raw ?? '').trim().toLowerCase() !== 'false';
}

export function startOfDayIso(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Escape user input for PostgREST .or() ilike filters (% _ , are special). */
export function escapePostgrestSearch(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '\\,');
}

export function normalizeReportStatus(status: string): string {
  return status === 'open' ? 'pending' : status;
}

export async function getAuthUserInfoForUserIds(
  userIds: string[]
): Promise<Record<string, { email?: string; isPlatformAdmin?: boolean }>> {
  if (!userIds.length) return {};

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
          const { data, error } = await adminData.getAuthUser(supabaseService, userId);
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
