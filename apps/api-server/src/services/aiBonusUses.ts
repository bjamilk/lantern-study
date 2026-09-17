/**
 * Bonus AI uses — the banked pool.
 *
 * There are two pools of AI uses and they behave differently on purpose:
 *
 *   DAILY   the allowance every account gets. Keyed by UTC date in Redis (or
 *           memory in dev), reset at midnight, never owed to anyone.
 *   BONUS   uses that were EARNED — today, only by a referral activating.
 *           Banked in Postgres, never reset, and therefore owed. Spending
 *           makes room to earn again.
 *
 * Spend order is daily first (see middleware/aiRateLimit.ts). A student should
 * lose the thing that expires anyway before the thing they worked for.
 *
 * Every call here feature-detects the 20260907140000 migration. Until it is
 * hand-applied the balance reads 0, a grant records nothing and reports itself
 * as not granted, and the app charges the daily allowance exactly as it does
 * today. One warn log says so, once, rather than one per request.
 */
import type { DataLayer } from './data';
import { logger } from '../utils/logger';
import {
  REFERRAL_BONUS_AI_USES_CAP,
} from '@lantern/shared/utils/aiCredits';

/** Which pool a charge came out of, so a refund can go back to the same one. */
export type AiUsePool = 'daily' | 'bonus';

export interface BonusGrantResult {
  granted: boolean;
  /** What was actually added. 0 when already granted, or capped out. */
  amount: number;
  balance: number;
  /** True when the banked cap swallowed some or all of the grant. */
  capped: boolean;
  /** Set when the ledger is unavailable (migration not applied yet). */
  unavailable?: boolean;
}

let layer: DataLayer | null = null;
let warnedUnavailable = false;

export function initializeAiBonusUses(dataLayer: DataLayer): void {
  layer = dataLayer;
  warnedUnavailable = false;
}

/** Test seam — lets the suite install a stub client without a real server. */
export function __setAiBonusSupabaseForTests(stub: DataLayer | null): void {
  layer = stub;
  warnedUnavailable = false;
}

/**
 * "The migration is not applied yet" — a missing table, a missing function, or
 * PostgREST's schema-cache versions of both. Anything else is a real fault and
 * must not be mistaken for an unapplied migration, or a broken ledger would
 * quietly read as an empty one.
 */
export function isMissingBonusSchema(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code || '';
  if (
    code === '42P01' || // undefined_table
    code === '42883' || // undefined_function
    code === '42703' || // undefined_column
    code === 'PGRST202' || // function not found in the schema cache
    code === 'PGRST205' // table not found in the schema cache
  ) {
    return true;
  }
  return /does not exist|could not find (the )?(table|function)/i.test(error.message || '');
}

function warnOnce(operation: string, error: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  logger.warn(
    'Bonus AI uses are unavailable — apply supabase/migrations/20260907140000_ai_bonus_uses.sql. ' +
      'Until then the bonus balance reads 0 and only the daily allowance is charged.',
    { operation, error: error instanceof Error ? error.message : String(error) }
  );
}

function client() {
  return layer ? layer.getClient() : null;
}

/** Banked balance for one account. 0 when the ledger is not there yet. */
export async function getBonusBalance(userId: string): Promise<number> {
  const db = client();
  if (!db || !userId) return 0;
  try {
    const { data, error } = await db
      .from('ai_bonus_uses')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingBonusSchema(error)) {
        warnOnce('getBonusBalance', error);
        return 0;
      }
      throw error;
    }
    const balance = Number((data as { balance?: number } | null)?.balance ?? 0);
    return Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0;
  } catch (err) {
    if (isMissingBonusSchema(err as { code?: string; message?: string })) {
      warnOnce('getBonusBalance', err);
      return 0;
    }
    // A transient read failure must not read as "you have nothing" AND must not
    // break the request that asked. 0 is the safe answer: it can only ever
    // charge the daily allowance, never spend a balance that isn't there.
    logger.warn('Bonus AI balance read failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Grant bonus uses once for `sourceId`.
 *
 * Idempotency lives in the database: `ai_bonus_grants.source_id` is unique, so
 * two concurrent activations of the same referral insert one row and pay once.
 * This function does not need — and must not add — its own guard.
 */
export async function grantBonusUses(
  userId: string,
  params: { source: 'referral' | 'admin' | 'promo'; sourceId: string; amount: number; cap?: number }
): Promise<BonusGrantResult> {
  const db = client();
  const amount = Math.max(0, Math.floor(Number(params.amount) || 0));
  const empty: BonusGrantResult = { granted: false, amount: 0, balance: 0, capped: false };
  if (!db || !userId || !params.sourceId) return { ...empty, unavailable: !db };

  try {
    const { data, error } = await db.rpc('ai_bonus_grant', {
      p_user_id: userId,
      p_source: params.source,
      p_source_id: params.sourceId,
      p_amount: amount,
      p_cap: Math.max(0, Math.floor(params.cap ?? REFERRAL_BONUS_AI_USES_CAP)),
    });
    if (error) {
      if (isMissingBonusSchema(error)) {
        warnOnce('grantBonusUses', error);
        return { ...empty, unavailable: true };
      }
      throw error;
    }
    const payload = (data || {}) as {
      granted?: boolean;
      amount?: number;
      balance?: number;
      capped?: boolean;
    };
    return {
      granted: payload.granted === true,
      amount: Math.max(0, Number(payload.amount) || 0),
      balance: Math.max(0, Number(payload.balance) || 0),
      capped: payload.capped === true,
    };
  } catch (err) {
    if (isMissingBonusSchema(err as { code?: string; message?: string })) {
      warnOnce('grantBonusUses', err);
      return { ...empty, unavailable: true };
    }
    // Never throw: this runs off the back of an ordinary request (a study
    // event), and a reward failure must not break what the student was doing.
    logger.warn('Bonus AI grant failed', {
      userId,
      sourceId: params.sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

/**
 * Take `amount` from the banked pool, all or nothing.
 *
 * Returns false when the balance cannot cover it — including when the ledger
 * does not exist yet, which is the same answer for the caller: this request
 * cannot be paid for out of bonus.
 */
export async function spendBonusUses(userId: string, amount: number): Promise<boolean> {
  const db = client();
  const credits = Math.max(0, Math.floor(Number(amount) || 0));
  if (!db || !userId || credits <= 0) return false;
  try {
    const { data, error } = await db.rpc('ai_bonus_spend', {
      p_user_id: userId,
      p_amount: credits,
    });
    if (error) {
      if (isMissingBonusSchema(error)) {
        warnOnce('spendBonusUses', error);
        return false;
      }
      throw error;
    }
    return ((data || {}) as { spent?: boolean }).spent === true;
  } catch (err) {
    if (isMissingBonusSchema(err as { code?: string; message?: string })) {
      warnOnce('spendBonusUses', err);
      return false;
    }
    logger.warn('Bonus AI spend failed', {
      userId,
      credits,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Put bonus uses back where they came from.
 *
 * Refunding a bonus charge into the daily counter would turn a banked use that
 * never expires into one that dies at midnight — the student would be quietly
 * robbed by a failed job. Hence a separate refund path, and hence `pool` on
 * every reservation.
 */
export async function refundBonusUses(userId: string, amount: number): Promise<void> {
  const db = client();
  const credits = Math.max(0, Math.floor(Number(amount) || 0));
  if (!db || !userId || credits <= 0) return;
  try {
    const { error } = await db.rpc('ai_bonus_refund', {
      p_user_id: userId,
      p_amount: credits,
    });
    if (error) {
      if (isMissingBonusSchema(error)) {
        warnOnce('refundBonusUses', error);
        return;
      }
      throw error;
    }
  } catch (err) {
    if (isMissingBonusSchema(err as { code?: string; message?: string })) {
      warnOnce('refundBonusUses', err);
      return;
    }
    logger.warn('Bonus AI refund failed', {
      userId,
      credits,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
