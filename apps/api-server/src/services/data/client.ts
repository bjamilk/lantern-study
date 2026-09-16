/**
 * data/client.ts — how the API server gets its ONE Supabase client, and the
 * four things that operate on the client itself rather than on a domain.
 *
 * ## Purpose
 *
 * First module extracted from the 18k-line `services/supabase.ts`
 * (`TEAM-S1-api-structure.md` §3, P0, step 2). It owns:
 *
 *  - `createDataClient` — the single `createClient(url, serviceRoleKey, …)`
 *    call the whole server runs on;
 *  - `healthCheck` — the readiness probe;
 *  - `isPlatformAdmin` — the only privilege check in the data layer;
 *  - `verifySupabaseToken` / `verifySupabaseTokenDetailed` +
 *    `isTransientAuthError` — access-token validation against gotrue.
 *
 * Every function takes the client as its first argument: measurement says the
 * data layer has no instance state to hold (100% of `SupabaseService`'s 381
 * methods touch at most one field), so these are plain functions, not a class.
 *
 * ## What it touches
 *
 * Tables: `platform_admins` (the admin gate), `profiles` (the health probe's
 * `select id limit 1`). Plus `auth.admin.getUserById` and `auth.getUser` on
 * gotrue. No storage buckets.
 *
 * ## The gotcha
 *
 * The key handed to `createDataClient` is the SERVICE ROLE key: it bypasses
 * row-level security entirely. `getClient()` / `getSupabaseClient()` on
 * `SupabaseService` hand that same client out raw, so anything built on it
 * inherits the RLS bypass and must carry its own ownership predicate — no
 * policy in `supabase/migrations/*` will catch the omission.
 *
 * The second gotcha is `isTransientAuthError`, and it is the reason
 * `verifySupabaseTokenDetailed` exists at all: see the FIXED (F10) note on it.
 */
import { createClient } from "@supabase/supabase-js";

import { DatabaseConfig } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Build the server's one Supabase client from the SERVICE ROLE key.
 *
 * `autoRefreshToken`/`persistSession` are off because this is a server-side
 * superuser credential, not a user session: there is nothing to refresh and
 * nowhere to persist it to.
 *
 * TRAP: do NOT give this an explicit return type of
 * `ReturnType<typeof createClient>`. `createClient` is generic over the
 * database schema, and naming it that way resolves the generics to their
 * DEFAULTS rather than to what this call site infers — which collapses every
 * row type in the server to `never` and produces ~500 TS errors in files this
 * lane never touched. Let the inference stand and derive the alias from it.
 */
export function createDataClient(config: DatabaseConfig) {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/** The service-role client every data-layer function is called with. */
export type DataClient = ReturnType<typeof createDataClient>;

/**
 * FIXED (F10): is this GoTrue failure the INFRASTRUCTURE's fault rather than
 * the token's?
 *
 * supabase-js reports a network failure as `AuthRetryableFetchError` (status 0
 * or absent) and a gateway failure as a 5xx; a token that is simply bad comes
 * back as a 401/403. Everything unrecognised is treated as transient on
 * purpose: mistaking an outage for a bad token silently signs a student out,
 * while mistaking a bad token for an outage only answers 503 to a caller whose
 * credential was not going to work anyway.
 */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const name = (error as { name?: unknown }).name;
  if (name === 'AuthRetryableFetchError') return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number' || status === 0) return true;
  return status >= 500;
}

export async function isPlatformAdmin(
  supabase: DataClient,
  userId: string,
): Promise<boolean> {
  const { data: row } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (row) return true;

  const { data: authData, error } = await supabase.auth.admin.getUserById(
    userId,
  );
  if (error || !authData?.user) return false;
  return authData.user.app_metadata?.is_platform_admin === true;
}

export async function healthCheck(supabase: DataClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) throw error;
    return true;
  } catch (error) {
    logger.error("Database health check failed:", error);
    return false;
  }
}

// FIXED (F10): verification used to collapse "this token is bad" and
// "Supabase is unreachable" into the same `{ isValid: false }`, which is what
// let one network blip downgrade a signed-in caller to anonymous in
// `optionalAuthMiddleware`. `verifySupabaseTokenDetailed` keeps the two apart
// with a `transient` flag; `verifySupabaseToken` is unchanged for the callers
// that only ever answer 401 either way.
export async function verifySupabaseToken(
  supabase: DataClient,
  accessToken: string,
): Promise<{ user: any; isValid: boolean }> {
  const result = await verifySupabaseTokenDetailed(supabase, accessToken);
  return { user: result.user, isValid: result.isValid };
}

export async function verifySupabaseTokenDetailed(
  supabase: DataClient,
  accessToken: string,
): Promise<{ user: any; isValid: boolean; transient: boolean }> {
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) {
      return { user: null, isValid: false, transient: isTransientAuthError(error) };
    }
    return { user: data.user, isValid: true, transient: false };
  } catch (error) {
    // A throw out of getUser is never a statement about the token — the SDK
    // returns bad-credential outcomes in `error`, so reaching here means the
    // call itself failed.
    logger.error("Token verification failed:", error);
    return { user: null, isValid: false, transient: true };
  }
}
