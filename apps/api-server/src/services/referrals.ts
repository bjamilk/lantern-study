/**
 * Referrals and ambassadors (Phase 4 · Q).
 *
 * Attribution is NOT done here — `handle_new_user()` records the referral row at
 * signup, server-side, from `auth.users.raw_user_meta_data`. See the
 * 20260825120000 migration for why the client is the wrong place for it.
 *
 * This service owns the half that involves money: deciding when a referee has
 * genuinely ACTIVATED, and granting coins exactly once to each side.
 *
 * The reward is deliberately split from the claim. Signup is worth nothing;
 * mobile signup has no Turnstile, so anything payable at signup would be free
 * money for a script. Activation requires real study events across two distinct
 * calendar days, which cannot be manufactured in one burst.
 */
import type { DataLayer } from './data';
import { getWalletService, type WalletService } from './walletService';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import { grantBonusUses, type BonusGrantResult } from './aiBonusUses';
import {
  REFERRAL_BONUS_AI_USES,
  REFERRAL_BONUS_AI_USES_CAP,
} from '@lantern/shared/utils/aiCredits';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coins granted to each side once the referee activates. */
export const REFERRAL_REWARD_REFERRER = 200;
export const REFERRAL_REWARD_REFEREE = 100;

/**
 * Bonus AI uses granted to each side at the same moment as the coins.
 *
 * Read from shared, not typed here: the Usage & limits screen prints this
 * number as the offer, and the two must be the same number or the offer is a
 * lie. The founder's decision is that this — not a Paystack top-up — is what a
 * student at zero AI uses is shown.
 */
export const REFERRAL_BONUS_AI_USES_EACH = REFERRAL_BONUS_AI_USES;

/** A referral that has not activated within this window is not worth chasing. */
export const REFERRAL_QUALIFY_WINDOW_DAYS = 45;

export interface ReferralRow {
  id: string;
  refereeId: string;
  refereeName: string | null;
  status: 'pending' | 'qualified' | 'rewarded';
  createdAt: string;
  qualifiedAt: string | null;
  rewardAmount: number | null;
}

export interface ReferralSummary {
  code: string | null;
  isAmbassador: boolean;
  total: number;
  pending: number;
  qualified: number;
  coinsEarned: number;
  referrals: ReferralRow[];
}

export class ReferralsService {
  constructor(
    private data: DataLayer,
    private wallet: WalletService
  ) {}

  private get db() {
    return this.data.getClient();
  }

  /**
   * The caller's own referral code, minted lazily for accounts that predate the
   * column (the migration backfills, but a race or a restore could leave one
   * null, and an empty invite screen is worse than a lazy write).
   */
  async ensureCode(userId: string): Promise<string | null> {
    if (!UUID_RE.test(String(userId))) return null;
    const { data } = await this.db
      .from('profiles')
      .select('referral_code')
      .eq('id', userId)
      .maybeSingle();
    const existing = (data as { referral_code?: string | null } | null)?.referral_code;
    if (existing) return existing;

    try {
      const { data: generated } = await this.db.rpc('generate_referral_code');
      const code = typeof generated === 'string' ? generated : null;
      if (!code) return null;
      await this.db.from('profiles').update({ referral_code: code }).eq('id', userId);
      return code;
    } catch (err) {
      logger.warn('referral code mint failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Everything the invite screen renders. Names come from a batched profile
   * lookup rather than a join, because `referrals` is service-role only and the
   * embed would not resolve.
   */
  async summary(userId: string): Promise<ReferralSummary> {
    const [code, profile, { data: rows }] = await Promise.all([
      this.ensureCode(userId),
      this.db.from('profiles').select('is_ambassador').eq('id', userId).maybeSingle(),
      this.db
        .from('referrals')
        .select('id, referee_id, qualified_at, rewarded_at, reward_amount, created_at')
        .eq('referrer_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const list = (rows || []) as Array<{
      id: string;
      referee_id: string;
      qualified_at: string | null;
      rewarded_at: string | null;
      reward_amount: number | null;
      created_at: string;
    }>;

    const nameById = new Map<string, string>();
    if (list.length > 0) {
      const { data: profiles } = await this.db
        .from('profiles')
        .select('id, name')
        .in('id', list.map((r) => r.referee_id));
      for (const p of profiles || []) nameById.set((p as any).id, (p as any).name);
    }

    const referrals: ReferralRow[] = list.map((r) => ({
      id: r.id,
      refereeId: r.referee_id,
      // First name only: a referrer should not get a directory of full names
      // for people who merely clicked their link.
      refereeName: (nameById.get(r.referee_id) || '').split(' ')[0] || null,
      status: r.rewarded_at ? 'rewarded' : r.qualified_at ? 'qualified' : 'pending',
      createdAt: r.created_at,
      qualifiedAt: r.qualified_at,
      rewardAmount: r.reward_amount,
    }));

    return {
      code,
      isAmbassador: (profile.data as { is_ambassador?: boolean } | null)?.is_ambassador === true,
      total: referrals.length,
      pending: referrals.filter((r) => r.status === 'pending').length,
      qualified: referrals.filter((r) => r.status !== 'pending').length,
      coinsEarned: referrals.reduce((sum, r) => sum + (r.rewardAmount || 0), 0),
      referrals,
    };
  }

  /**
   * Called for a user who has just been seen active. If they were referred and
   * have now activated, pay BOTH sides.
   *
   * Never throws: this runs off the back of an ordinary request, and a reward
   * failure must not break whatever the user was actually doing.
   *
   * A referral pays in two currencies, and `rewarded_at` is honest about only
   * one of them: it records that the COINS were paid, because that is the half
   * `reward_amount` and `wallet_award_once` represent. The AI-use half lives in
   * its own ledger (`ai_bonus_grants`, keyed by source id) and is recorded
   * separately, so a `rewarded_at` stamp never claims an AI grant that did not
   * happen.
   *
   * Idempotency is layered:
   *   1. `wallet_award_once` is the coin guard — the award key is derived from
   *      the referral id, so even a concurrent double-call grants once;
   *   2. the UNIQUE `ai_bonus_grants.source_id` is the AI-use guard, so the same
   *      grant re-attempted over an already-paid pair is a no-op.
   *
   * Because the AI-use guard lives in the database, a pair already stamped
   * `rewarded_at` but missing its AI grant (every pair rewarded before the
   * 20260907140000 migration existed) can be healed forward: re-attempting the
   * grant on a later check is exactly-once and needs no backfill.
   */
  async checkActivation(refereeId: string): Promise<{ rewarded: boolean }> {
    if (!UUID_RE.test(String(refereeId))) return { rewarded: false };
    try {
      const { data: referral } = await this.db
        .from('referrals')
        .select('id, referrer_id, referee_id, qualified_at, rewarded_at, created_at')
        .eq('referee_id', refereeId)
        .maybeSingle();

      const row = referral as {
        id: string;
        referrer_id: string;
        referee_id: string;
        qualified_at: string | null;
        rewarded_at: string | null;
        created_at: string;
      } | null;

      // Activation is defined only by referral_activation_check. Stamp
      // profiles.activated_at even when this user was never referred — do not
      // copy the 10-events / 2-days constants here.
      const { data: activated, error } = await this.db.rpc('referral_activation_check', {
        p_user_id: refereeId,
      });
      if (error) throw error;
      if (activated === true) {
        await this.db
          .from('profiles')
          .update({ activated_at: new Date().toISOString() })
          .eq('id', refereeId)
          .is('activated_at', null);
      }

      if (!row) return { rewarded: false };

      // Stale referrals stop costing a query on every request.
      const ageDays = (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
      const withinWindow = ageDays <= REFERRAL_QUALIFY_WINDOW_DAYS;

      // Already paid in coins. Do NOT return early — the AI-use half may be
      // absent (every pair rewarded before the 20260907140000 migration existed
      // got coins and no AI uses, and the old early return meant it could never
      // retry). Re-attempt the grant: the UNIQUE `ai_bonus_grants.source_id`
      // makes this exactly-once, so it is a no-op once the grant is present and
      // safe to run over already-paid pairs. Bounded by the qualify window so it
      // stops chasing ancient pairs; older debts are the founder's backfill call.
      if (row.rewarded_at) {
        if (withinWindow) {
          const [referrerUses, refereeUses] = await this.grantReferralBonusUses(row);
          if (referrerUses.granted || refereeUses.granted) {
            logger.info('referral bonus AI uses self-healed', {
              referralId: row.id,
              referrerAiUses: referrerUses.amount,
              refereeAiUses: refereeUses.amount,
            });
          }
        }
        return { rewarded: false };
      }

      if (!withinWindow) return { rewarded: false };

      if (activated !== true) return { rewarded: false };

      const now = new Date().toISOString();
      // Coins first, each under `wallet_award_once` keyed on the referral id, so
      // the pair can never be paid twice even if two requests race past the
      // rewarded_at check above.
      const [referrerAward, refereeAward] = await Promise.all([
        this.wallet.awardWalletOnce(
          row.referrer_id,
          `referral:referrer:${row.id}`,
          REFERRAL_REWARD_REFERRER,
          'Referral bonus'
        ),
        this.wallet.awardWalletOnce(
          row.referee_id,
          `referral:referee:${row.id}`,
          REFERRAL_REWARD_REFEREE,
          'Welcome bonus'
        ),
      ]);

      // Stamp for the COIN reward and nothing else: `rewarded_at`/`reward_amount`
      // are honest only about the half `wallet_award_once` just paid. The stamp
      // goes on before the AI grant so that if the AI ledger is absent, the
      // rewarded_at branch above heals it forward on a later check.
      await this.db
        .from('referrals')
        .update({
          qualified_at: row.qualified_at ?? now,
          rewarded_at: now,
          reward_amount: REFERRAL_REWARD_REFERRER,
        })
        .eq('id', row.id);

      // AI uses are a separate ledger and are NEVER allowed to fail or reverse
      // the coins above: `grantReferralBonusUses` cannot throw, and when the
      // ledger is absent it reports itself unavailable and grants nothing — the
      // coins still stand, and the self-heal will land the grant once the
      // migration is applied.
      const [referrerUses, refereeUses] = await this.grantReferralBonusUses(row);

      logger.info('referral rewarded', {
        referralId: row.id,
        referrerAwarded: referrerAward.awarded,
        refereeAwarded: refereeAward.awarded,
        referrerAiUses: referrerUses.amount,
        refereeAiUses: refereeUses.amount,
        aiUsesCapped: referrerUses.capped || refereeUses.capped,
        aiUsesUnavailable: referrerUses.unavailable || refereeUses.unavailable || false,
      });
      return { rewarded: true };
    } catch (err) {
      logger.warn('referral activation check failed', {
        refereeId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { rewarded: false };
    }
  }

  /**
   * Grant the referral's AI-use half to both sides, exactly once.
   *
   * Keyed on the referral id — the same key the coin awards use — so the DB's
   * UNIQUE `ai_bonus_grants.source_id` makes a re-attempt over an already-paid
   * pair a no-op. Used both when a referral first activates and when an older
   * pair is healed forward.
   *
   * This can never throw: `grantBonusUses` already swallows its own faults, and
   * the try/catch here is belt-and-suspenders so the AI-use half can never fail
   * or reverse the coin half of the reward, whatever a future change to
   * `grantBonusUses` might do.
   */
  private async grantReferralBonusUses(row: {
    id: string;
    referrer_id: string;
    referee_id: string;
  }): Promise<[BonusGrantResult, BonusGrantResult]> {
    try {
      return await Promise.all([
        grantBonusUses(row.referrer_id, {
          source: 'referral',
          sourceId: `referral:referrer:${row.id}`,
          amount: REFERRAL_BONUS_AI_USES_EACH,
          cap: REFERRAL_BONUS_AI_USES_CAP,
        }),
        grantBonusUses(row.referee_id, {
          source: 'referral',
          sourceId: `referral:referee:${row.id}`,
          amount: REFERRAL_BONUS_AI_USES_EACH,
          cap: REFERRAL_BONUS_AI_USES_CAP,
        }),
      ]);
    } catch (err) {
      logger.warn('referral bonus AI grant threw', {
        referralId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      const unavailable: BonusGrantResult = {
        granted: false,
        amount: 0,
        balance: 0,
        capped: false,
        unavailable: true,
      };
      return [unavailable, unavailable];
    }
  }

  /** Ambassadors for a campus — the seed list a campus playbook is built on. */
  async listAmbassadors(institutionId: string, limit = 25): Promise<
    Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>
  > {
    if (!UUID_RE.test(String(institutionId))) throw new PublicError('Invalid institution');
    const bounded = Math.min(50, Math.max(1, Math.floor(Number(limit) || 25)));
    const { data, error } = await this.db
      .from('profiles')
      .select('id, name, avatar_url, programme')
      .eq('institution_id', institutionId)
      .eq('is_ambassador', true)
      .limit(bounded);
    if (error) throw error;
    return (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatar_url ?? null,
      programme: p.programme ?? null,
    }));
  }
}

let service: ReferralsService | null = null;

export function getReferralsService(data: DataLayer): ReferralsService {
  // WalletService is a no-arg singleton initialised at server boot, so it is
  // resolved lazily here rather than threaded through every caller.
  if (!service) service = new ReferralsService(data, getWalletService());
  return service;
}
