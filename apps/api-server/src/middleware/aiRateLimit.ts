/**
 * AI Rate Limiting Middleware
 * Distributed via Redis when REDIS_ENABLED=true; in-memory fallback for dev.
 * Each window resets at 00:00 UTC (midnight GMT).
 */
import { Request, Response, NextFunction } from 'express';
import { getRedisClient, redisKey } from '../services/redisStore';
import { logger } from '../utils/logger';

import {
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_AI_FEATURE_LIMITS,
  isZeroCreditAIFeature,
} from '@lantern/shared/utils/aiUsage';
import {
  AI_CREDIT_COSTS,
  AI_FEATURE_CREDIT_COST,
  MAX_AI_CREDIT_COST,
  REFERRAL_BONUS_AI_USES_CAP,
} from '@lantern/shared/utils/aiCredits';
import {
  getBonusBalance,
  refundBonusUses,
  spendBonusUses,
  type AiUsePool,
} from '../services/aiBonusUses';

const userAIUsage = new Map<string, { count: number; dateKey: string }>();

const AI_DAILY_LIMIT = parseInt(
  process.env.AI_DAILY_LIMIT || String(DEFAULT_AI_DAILY_LIMIT),
  10
);

function readFeatureLimitEnv(key: string, fallback: number): number {
  const raw = process.env[`AI_LIMIT_${key.toUpperCase()}`];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const FEATURE_LIMITS: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_AI_FEATURE_LIMITS).map(([key, fallback]) => [
    key,
    readFeatureLimitEnv(key, fallback),
  ])
);

function getUtcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function msUntilNextUtcMidnight(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now);
}

function nextUtcMidnightIso(now = Date.now()): string {
  return new Date(now + msUntilNextUtcMidnight(now)).toISOString();
}

function toResetsAt(resetTime: number): string {
  return new Date(resetTime).toISOString();
}

/**
 * Atomically reserve `cost` credits against `key`, all-or-nothing.
 * Redis path: a single INCRBY, rolled back in full if it overshoots the limit —
 * a denial can never partially consume credits (the old per-credit loop could).
 * Negative cost releases credits (see refundAiCredits) and never goes below 0.
 */
async function reserveUsage(
  key: string,
  limit: number,
  cost: number
): Promise<{ allowed: boolean; count: number; resetTime: number }> {
  const now = Date.now();
  const dateKey = getUtcDateKey(new Date(now));
  const resetTime = new Date(now + msUntilNextUtcMidnight(now)).getTime();
  const redis = await getRedisClient();

  if (redis?.isOpen) {
    const rKey = redisKey(`ai:${dateKey}:${key}`);
    const count = await redis.incrBy(rKey, cost);
    const ttlSec = Math.ceil(msUntilNextUtcMidnight(now) / 1000);
    if (count === cost || (await redis.ttl(rKey)) < 0) {
      await redis.expire(rKey, ttlSec);
    }
    if (cost < 0 && count < 0) {
      // Refund below zero (double refund): clamp back to 0.
      await redis.incrBy(rKey, -count);
      return { allowed: true, count: 0, resetTime };
    }
    if (cost > 0 && count > limit) {
      await redis.incrBy(rKey, -cost);
      return { allowed: false, count: count - cost, resetTime };
    }
    return { allowed: true, count, resetTime };
  }

  const usage = userAIUsage.get(key);
  if (usage && usage.dateKey === dateKey) {
    if (cost > 0 && usage.count + cost > limit) {
      return { allowed: false, count: usage.count, resetTime };
    }
    usage.count = Math.max(0, usage.count + cost);
    return { allowed: true, count: usage.count, resetTime };
  }

  if (cost > limit) {
    return { allowed: false, count: 0, resetTime };
  }
  userAIUsage.set(key, { count: Math.max(0, cost), dateKey });
  return { allowed: true, count: Math.max(0, cost), resetTime };
}

async function incrementUsage(
  key: string,
  limit: number
): Promise<{ allowed: boolean; count: number; resetTime: number }> {
  // `current >= limit` (old predicate) ⇔ `current + 1 > limit` — behavior-identical.
  // The charge is the shared constant, not a literal: the Usage & limits screen
  // prints the same number, and a divergence would make the counter lie.
  return reserveUsage(key, limit, AI_FEATURE_CREDIT_COST);
}

/** Hand back credits reserved for work that never happened. */
async function releaseUsage(key: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  await reserveUsage(key, Number.MAX_SAFE_INTEGER, -credits);
}

/* ------------------------------------------------------- the two pools -- */

/**
 * Spend order: the DAILY allowance first, the BANKED bonus only once the day
 * is gone.
 *
 * A student should lose the thing that expires at midnight anyway before the
 * thing they earned by inviting someone. Draining the bonus first would mean a
 * heavy Monday quietly burned a reward and left the free daily allowance
 * unused — the same total, but the student is poorer tomorrow.
 *
 * A charge comes out of ONE pool, never split across both. A cost of 3 with 1
 * daily left is paid entirely from bonus (if bonus can cover it) or refused —
 * so `pool` on the reservation is always the whole truth about where the money
 * came from, and a refund can put every unit back where it belongs. Splitting
 * would buy a student one extra request in a rare case at the price of a
 * refund path that can only ever be approximately right.
 */
export interface GlobalCharge {
  allowed: boolean;
  /** Daily counter after the charge (unchanged when it came from bonus). */
  count: number;
  resetTime: number;
  /** Which pool paid. 'daily' when nothing was charged at all. */
  pool: AiUsePool;
  /** Banked bonus left AFTER this charge — what the header reports. */
  bonusRemaining: number;
}

/**
 * Reserve `cost` against the global allowance, falling back to the bonus pool.
 * All-or-nothing in both pools: a refusal consumes nothing anywhere.
 */
async function chargeGlobalAllowance(userId: string, cost: number): Promise<GlobalCharge> {
  const daily = await reserveUsage(userId, AI_DAILY_LIMIT, cost);
  if (daily.allowed) {
    return {
      ...daily,
      pool: 'daily',
      bonusRemaining: await getBonusBalance(userId),
    };
  }

  const paidFromBonus = await spendBonusUses(userId, cost);
  const bonusRemaining = await getBonusBalance(userId);
  return {
    allowed: paidFromBonus,
    count: daily.count,
    resetTime: daily.resetTime,
    pool: paidFromBonus ? 'bonus' : 'daily',
    bonusRemaining,
  };
}

/**
 * Put a global charge back into the pool it came out of.
 *
 * Refunding a bonus charge into the daily counter would convert a banked use
 * that never expires into one that dies at midnight — a failed job would
 * quietly rob the student of the reward they earned.
 */
async function releaseGlobalAllowance(
  userId: string,
  cost: number,
  pool: AiUsePool = 'daily'
): Promise<void> {
  if (cost <= 0) return;
  if (pool === 'bonus') {
    await refundBonusUses(userId, cost);
    return;
  }
  await releaseUsage(userId, cost);
}

/**
 * "2 left today and 2 banked" — what a refusal quotes.
 *
 * The two pools are named separately because a single charge is paid from
 * ONE of them: adding them up would quote a figure the student cannot spend
 * on the very request being refused. The banked half is only mentioned when
 * there is one.
 */
function describeRemaining(result: Pick<GlobalCharge, 'count' | 'bonusRemaining'>): string {
  const dailyLeft = Math.max(0, AI_DAILY_LIMIT - result.count);
  const banked = Math.max(0, Math.floor(result.bonusRemaining));
  return banked > 0 ? `${dailyLeft} left today and ${banked} banked` : `${dailyLeft} left today`;
}

/** Banked bonus uses and the cap they are banked against, for GET /ai/usage. */
export async function getAIBonusUsage(
  userId: string
): Promise<{ bonusRemaining: number; bonusCap: number }> {
  return {
    bonusRemaining: await getBonusBalance(userId),
    bonusCap: REFERRAL_BONUS_AI_USES_CAP,
  };
}

async function readUsage(
  key: string,
  limit: number
): Promise<{ used: number; limit: number; resetsAt: string }> {
  const now = Date.now();
  const dateKey = getUtcDateKey(new Date(now));
  const resetsAt = nextUtcMidnightIso(now);
  const redis = await getRedisClient();

  if (redis?.isOpen) {
    const rKey = redisKey(`ai:${dateKey}:${key}`);
    const raw = await redis.get(rKey);
    const used = raw ? parseInt(raw, 10) : 0;
    return { used, limit, resetsAt };
  }

  const usage = userAIUsage.get(key);
  if (!usage || usage.dateKey !== dateKey) {
    return { used: 0, limit, resetsAt };
  }
  return { used: usage.count, limit, resetsAt };
}

export async function getAIUsage(
  userId: string
): Promise<{ used: number; limit: number; resetsAt: string }> {
  return readUsage(userId, AI_DAILY_LIMIT);
}

export async function getFeatureAIUsage(
  userId: string,
  featureKey: string
): Promise<{ used: number; limit: number; resetsAt: string }> {
  const limit = resolveFeatureLimit(featureKey);
  const key = buildUsageKey(userId, featureKey);
  return readUsage(key, limit);
}

/**
 * Banked bonus uses left after this request. Clients show it as a second line
 * under the counter, and hide the line entirely when the header is absent —
 * an absent header means "this server does not know", which is not the same
 * as zero and must not be printed as zero.
 */
export const AI_BONUS_REMAINING_HEADER = 'X-AI-Bonus-Remaining';

function setBonusHeader(res: Response, bonusRemaining: number): void {
  res.setHeader(AI_BONUS_REMAINING_HEADER, String(Math.max(0, Math.floor(bonusRemaining))));
}

/** Explicit global headers — clients prefer these for the sidebar AI badge. */
function setGlobalUsageHeaders(
  res: Response,
  usage: { count: number; resetTime: number }
): void {
  const resetsAt = toResetsAt(usage.resetTime);
  res.setHeader('X-AI-Global-Usage-Used', usage.count.toString());
  res.setHeader('X-AI-Global-Usage-Limit', AI_DAILY_LIMIT.toString());
  res.setHeader('X-AI-Global-Usage-Resets-At', resetsAt);
}

/** Global-only routes: legacy + explicit global headers carry the same counts. */
function setLegacyAndGlobalUsageHeaders(
  res: Response,
  usage: { count: number; resetTime: number }
): void {
  const resetsAt = toResetsAt(usage.resetTime);
  res.setHeader('X-AI-Usage-Used', usage.count.toString());
  res.setHeader('X-AI-Usage-Limit', AI_DAILY_LIMIT.toString());
  res.setHeader('X-AI-Usage-Resets-At', resetsAt);
  setGlobalUsageHeaders(res, usage);
}

export async function aiRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const result = await chargeGlobalAllowance(userId, AI_FEATURE_CREDIT_COST);
  setBonusHeader(res, result.bonusRemaining);
  if (!result.allowed) {
    res.status(429).json({
      error: 'Daily AI limit reached. Try again tomorrow.',
      limit: AI_DAILY_LIMIT,
      used: result.count,
      bonusRemaining: result.bonusRemaining,
      resetsAt: toResetsAt(result.resetTime),
    });
    return;
  }

  setLegacyAndGlobalUsageHeaders(res, result);
  // For 202 handlers: lets sendAsyncJobAccepted stamp the charge onto the job
  // record so a permanently failed async job can refund it. `pool` rides along
  // so the refund goes back to the balance that actually paid.
  (res.locals as Record<string, unknown>).aiCharge = {
    credits: AI_FEATURE_CREDIT_COST,
    pool: result.pool,
  };
  next();
}

/** Soft credit cost for local OCR imports (default 2). Set NOTE_OCR_CREDIT_COST=0 to disable. */
export const NOTE_OCR_CREDIT_COST = Math.max(
  0,
  Math.min(
    MAX_AI_CREDIT_COST,
    parseInt(process.env.NOTE_OCR_CREDIT_COST || String(AI_CREDIT_COSTS.note_ocr), 10) ||
      AI_CREDIT_COSTS.note_ocr
  )
);

/**
 * Charge multiple daily AI credits atomically (all-or-nothing). Returns null
 * when allowed, or a 429 payload when the user would exceed the daily limit —
 * in which case NOTHING was consumed.
 */
export async function chargeAiCredits(
  userId: string,
  amount: number,
  label = 'OCR'
): Promise<null | { error: string; limit: number; used: number; resetsAt: string }> {
  const outcome = await chargeAiCreditsDetailed(userId, amount, label);
  return outcome.ok ? null : outcome.denial;
}

/**
 * The same charge, but it says which pool paid — so a caller that refunds can
 * put the credits back where they came from. `chargeAiCredits` is the thin
 * wrapper for the callers that never refund.
 */
export async function chargeAiCreditsDetailed(
  userId: string,
  amount: number,
  label = 'OCR'
): Promise<
  | { ok: true; pool: AiUsePool; credits: number }
  | {
      ok: false;
      denial: { error: string; limit: number; used: number; resetsAt: string };
    }
> {
  const credits = Math.max(0, Math.floor(amount));
  if (credits <= 0) return { ok: true, pool: 'daily', credits: 0 };

  const result = await chargeGlobalAllowance(userId, credits);
  if (!result.allowed) {
    return {
      ok: false,
      denial: {
        error:
          credits > 1
            ? `Daily AI limit reached. ${label} needs ${credits} AI uses — you have ${describeRemaining(result)}.`
            : 'Daily AI limit reached. Try again tomorrow.',
        limit: AI_DAILY_LIMIT,
        used: result.count,
        resetsAt: toResetsAt(result.resetTime),
      },
    };
  }
  return { ok: true, pool: result.pool, credits };
}

/** Give back credits already reserved when a request bails before doing AI work. */
export async function refundAiCredits(
  userId: string,
  amount: number,
  pool: AiUsePool = 'daily'
): Promise<void> {
  const credits = Math.max(0, Math.floor(amount));
  if (credits <= 0) return;
  await releaseGlobalAllowance(userId, credits, pool);
}

/**
 * Give back the one global + one feature credit reserved by
 * aiRateLimitForFeature, for handlers that answer 2xx without doing AI work
 * (e.g. a quiz regenerate that returns the existing quiz untouched). Non-2xx
 * responses are refunded automatically by the middleware itself.
 */
export async function refundFeatureAiCredit(
  userId: string,
  featureKey: string,
  pool: AiUsePool = 'daily'
): Promise<void> {
  // A free feature never took a global credit, so refunding one would MINT an
  // AI use out of a failed voice question. Only the cap comes back.
  if (isZeroCreditAIFeature(featureKey)) {
    await releaseUsage(buildUsageKey(userId, featureKey), AI_FEATURE_CREDIT_COST);
    return;
  }
  // Two pools, two refunds. The global half goes back to whichever pool paid
  // it; the per-feature counter is a cap, not a currency, and always resets
  // against the same daily key it was charged on.
  await Promise.all([
    releaseGlobalAllowance(userId, AI_FEATURE_CREDIT_COST, pool),
    releaseUsage(buildUsageKey(userId, featureKey), AI_FEATURE_CREDIT_COST),
  ]);
}

export const AI_COST_HEADER = 'X-AI-Cost';

/** Every response header this module can set. CORS must expose all of these. */
export const AI_USAGE_EXPOSED_HEADERS = [
  'X-AI-Feature',
  'X-AI-Cost',
  'X-AI-Usage-Used',
  'X-AI-Usage-Limit',
  'X-AI-Usage-Resets-At',
  'X-AI-Global-Usage-Used',
  'X-AI-Global-Usage-Limit',
  'X-AI-Global-Usage-Resets-At',
  'X-AI-Bonus-Remaining',
] as const;

/**
 * Charge a variable number of global AI credits based on the request, reserved
 * atomically BEFORE the handler runs: a user who cannot afford the action is
 * refused with a 429 without consuming anything or doing any work.
 */
export function aiRateLimitWithCost(
  getCost: (req: Request) => number,
  options: { label?: string } = {}
) {
  const label = options.label || 'This action';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const raw = Number(getCost(req));
    const cost = Math.max(
      1,
      Math.min(MAX_AI_CREDIT_COST, Number.isFinite(raw) ? Math.floor(raw) : 1)
    );

    const result = await chargeGlobalAllowance(userId, cost);
    res.setHeader(AI_COST_HEADER, String(cost));
    setLegacyAndGlobalUsageHeaders(res, result);
    setBonusHeader(res, result.bonusRemaining);

    if (!result.allowed) {
      // `remaining` is the day's remainder PLUS anything banked, so a client
      // can show a total. The SENTENCE keeps the two apart: a charge is paid
      // from one pool, never split, so "you have 4 left" for 2 daily + 2
      // banked would tell a student they can afford the 3 they were just
      // refused. Quoting only the daily remainder would be the opposite lie —
      // someone with 6 banked uses told they have 0.
      const remaining = Math.max(0, AI_DAILY_LIMIT - result.count) + result.bonusRemaining;
      res.status(429).json({
        error:
          cost > 1
            ? `${label} needs ${cost} AI uses — you have ${describeRemaining(result)}.`
            : 'Daily AI limit reached. Try again tomorrow.',
        limit: AI_DAILY_LIMIT,
        used: result.count,
        remaining,
        bonusRemaining: result.bonusRemaining,
        cost,
        resetsAt: toResetsAt(result.resetTime),
      });
      return;
    }

    // Same guarantee as aiRateLimitForFeature below: credits reserved up front
    // must not survive a request that never produced a completion. Without
    // this, a failed Smart Notes run kept its 1-3 credit charge.
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) return;
      void refundAiCredits(userId, cost, result.pool).catch((error) => {
        logger.warn('Failed to refund AI credits for a request that did not succeed', {
          userId,
          cost,
          pool: result.pool,
          status: res.statusCode,
          error,
        });
      });
    });

    // Restate pre-charge global counts on a failed answer so the badge does
    // not tick down for work that was never done (mirrors the feature
    // middleware's json wrapper below).
    const sendJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (!succeeded && !res.headersSent) {
        // Only restate the pool that actually moved. A bonus charge never
        // touched the daily counter, so "un-charging" it here would hand the
        // badge a credit the student does not have.
        if (result.pool === 'daily') {
          setLegacyAndGlobalUsageHeaders(res, {
            count: Math.max(0, result.count - cost),
            resetTime: result.resetTime,
          });
        } else {
          setBonusHeader(res, result.bonusRemaining + cost);
        }
      }
      return sendJson(body);
    }) as Response['json'];

    (res.locals as Record<string, unknown>).aiCreditsCharged = cost;
    (res.locals as Record<string, unknown>).aiCharge = { credits: cost, pool: result.pool };
    next();
  };
}

/** Attach current global AI usage headers (for OCR and other non-middleware charges). */
export async function applyGlobalUsageHeaders(res: Response, userId: string): Promise<void> {
  const [usage, bonusRemaining] = await Promise.all([
    getAIUsage(userId),
    getBonusBalance(userId),
  ]);
  const resetTime = usage.resetsAt ? Date.parse(usage.resetsAt) : Date.now();
  setLegacyAndGlobalUsageHeaders(res, {
    count: usage.used,
    resetTime: Number.isFinite(resetTime) ? resetTime : Date.now(),
  });
  // The OCR path charges outside the middleware, so without this the bonus
  // line on the badge would go stale on exactly the requests that spent it.
  setBonusHeader(res, bonusRemaining);
}

function resolveFeatureLimit(featureKey?: string): number {
  if (featureKey && FEATURE_LIMITS[featureKey] !== undefined) {
    return FEATURE_LIMITS[featureKey];
  }
  return AI_DAILY_LIMIT;
}

function buildUsageKey(userId: string, featureKey?: string): string {
  return featureKey ? `${userId}:${featureKey}` : userId;
}

/**
 * The cap-only limiter, for features the app says cost nothing.
 *
 * It enforces the feature's own daily cap and NOTHING else: no global charge,
 * no bonus spend, no global usage headers. Asking a question out loud is the
 * same question typed, and the typed one is answered by the tutor the student
 * already paid for — so the meter must not move, and the badge must not even
 * be restated, or the student would watch their allowance drop on the one
 * action the Usage screen lists as free.
 *
 * The cap is still refunded when the request does not finish 2xx, exactly as
 * the paid path refunds credits: a failed transcription must not eat one of
 * the day's questions.
 */
function zeroCreditFeatureLimiter(featureKey: string) {
  const limit = resolveFeatureLimit(featureKey);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const key = buildUsageKey(userId as string, featureKey);

    const featureResult = await incrementUsage(key, limit);
    if (!featureResult.allowed) {
      res.status(429).json({
        error: `Daily limit reached for this feature (${featureKey}). Try again tomorrow.`,
        feature: featureKey,
        limit,
        used: featureResult.count,
        cost: 0,
        resetsAt: toResetsAt(featureResult.resetTime),
      });
      return;
    }

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) return;
      void releaseUsage(key, AI_FEATURE_CREDIT_COST).catch((error) => {
        logger.warn('Failed to refund a free-feature use for a request that did not succeed', {
          userId,
          featureKey,
          status: res.statusCode,
          error,
        });
      });
    });

    res.setHeader('X-AI-Feature', featureKey);
    // Zero, stated rather than omitted: a client reading this header learns the
    // action was free instead of assuming the default charge of one.
    res.setHeader(AI_COST_HEADER, '0');
    res.setHeader('X-AI-Usage-Used', featureResult.count.toString());
    res.setHeader('X-AI-Usage-Limit', limit.toString());
    res.setHeader('X-AI-Usage-Resets-At', toResetsAt(featureResult.resetTime));

    // Same restatement as the paid path, for the feature counter only.
    const sendJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (!succeeded && !res.headersSent) {
        res.setHeader('X-AI-Usage-Used', Math.max(0, featureResult.count - 1).toString());
      }
      return sendJson(body);
    }) as typeof res.json;

    next();
  };
}

export function aiRateLimitForFeature(featureKey: string) {
  if (isZeroCreditAIFeature(featureKey)) return zeroCreditFeatureLimiter(featureKey);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const limit = resolveFeatureLimit(featureKey);
    const key = buildUsageKey(userId as string, featureKey);

    // Soft-check feature first so a spent feature budget does not burn a global credit.
    const featureSnapshot = await readUsage(key, limit);
    if (featureSnapshot.used >= limit) {
      res.status(429).json({
        error: `Daily limit reached for this feature (${featureKey}). Try again tomorrow.`,
        feature: featureKey,
        limit,
        used: featureSnapshot.used,
        resetsAt: featureSnapshot.resetsAt,
      });
      return;
    }

    // Every feature AI action also counts toward the global badge counter.
    // Bonus uses extend the GLOBAL allowance only — the per-feature cap above
    // is a fairness rule about how much of one tool you may run in a day, and
    // an earned reward is not a reason to run 30 flashcard generations.
    const globalResult = await chargeGlobalAllowance(userId, AI_FEATURE_CREDIT_COST);
    setBonusHeader(res, globalResult.bonusRemaining);
    if (!globalResult.allowed) {
      res.status(429).json({
        error: 'Daily AI limit reached. Try again tomorrow.',
        limit: AI_DAILY_LIMIT,
        used: globalResult.count,
        bonusRemaining: globalResult.bonusRemaining,
        resetsAt: toResetsAt(globalResult.resetTime),
      });
      return;
    }

    const featureResult = await incrementUsage(key, limit);
    if (!featureResult.allowed) {
      // The global credit was reserved a few lines up. Give it back — to the
      // pool it came from — rather than charging for a request this middleware
      // is itself about to refuse.
      await releaseGlobalAllowance(userId, AI_FEATURE_CREDIT_COST, globalResult.pool);
      res.status(429).json({
        error: `Daily limit reached for this feature (${featureKey}). Try again tomorrow.`,
        feature: featureKey,
        limit,
        used: featureResult.count,
        resetsAt: toResetsAt(featureResult.resetTime),
      });
      return;
    }

    // Credits are reserved up front because the cap has to be enforced before
    // the work starts — but a request that never produced a completion must not
    // keep them. Without this a failing provider burned a user's entire daily
    // allowance one doomed attempt at a time (and a 400 for a too-short note
    // cost a credit as well). Anything that does not finish 2xx is refunded.
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) return;
      void Promise.all([
        releaseGlobalAllowance(userId, AI_FEATURE_CREDIT_COST, globalResult.pool),
        releaseUsage(key, AI_FEATURE_CREDIT_COST),
      ]).catch((error) => {
        logger.warn('Failed to refund AI credits for a request that did not succeed', {
          userId,
          featureKey,
          pool: globalResult.pool,
          status: res.statusCode,
          error,
        });
      });
    });

    res.setHeader('X-AI-Feature', featureKey);
    (res.locals as Record<string, unknown>).aiCharge = {
      credits: AI_FEATURE_CREDIT_COST,
      featureKey,
      pool: globalResult.pool,
    };
    // Feature-scoped counts (for inline "N left" next to that tool).
    res.setHeader('X-AI-Usage-Used', featureResult.count.toString());
    res.setHeader('X-AI-Usage-Limit', limit.toString());
    res.setHeader('X-AI-Usage-Resets-At', toResetsAt(featureResult.resetTime));
    // Global counts drive the sidebar / floating AI badge.
    setGlobalUsageHeaders(res, globalResult);

    // These headers are written now but only flushed when the handler answers,
    // and by then a failed request has been refunded above. The client reads
    // them before it checks response.ok, so leaving them at the charged value
    // made the badge tick down for work that was never done — the refund was
    // real but invisible. Restate the pre-charge counts on the way out.
    const sendJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (!succeeded && !res.headersSent) {
        res.setHeader('X-AI-Usage-Used', Math.max(0, featureResult.count - 1).toString());
        if (globalResult.pool === 'daily') {
          setGlobalUsageHeaders(res, {
            count: Math.max(0, globalResult.count - 1),
            resetTime: globalResult.resetTime,
          });
        } else {
          setBonusHeader(res, globalResult.bonusRemaining + AI_FEATURE_CREDIT_COST);
        }
      }
      return sendJson(body);
    }) as typeof res.json;

    next();
  };
}

export async function resetAIUsageForUser(userId: string, featureKey?: string): Promise<void> {
  const dateKey = getUtcDateKey();
  const redis = await getRedisClient();
  if (featureKey) {
    const key = buildUsageKey(userId, featureKey);
    userAIUsage.delete(key);
    if (redis?.isOpen) await redis.del(redisKey(`ai:${dateKey}:${key}`));
  } else {
    for (const key of userAIUsage.keys()) {
      if (key === userId || key.startsWith(`${userId}:`)) {
        userAIUsage.delete(key);
        if (redis?.isOpen) await redis.del(redisKey(`ai:${dateKey}:${key}`));
      }
    }
  }
}

export async function getAllAIUsageForUser(
  userId: string
): Promise<Array<{ feature: string; used: number; limit: number; resetsAt: string }>> {
  const features = ['', ...Object.keys(FEATURE_LIMITS)];
  const results = await Promise.all(
    features.map(async (featureKey) => {
      const key = buildUsageKey(userId, featureKey || undefined);
      const limit = resolveFeatureLimit(featureKey || undefined);
      const usage = await readUsage(key, limit);
      return { feature: featureKey || 'global', ...usage };
    })
  );
  return results;
}
