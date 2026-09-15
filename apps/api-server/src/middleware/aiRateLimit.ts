/**
 * The AI credit ledger: who may run an AI action today, what it costs, and how a
 * charge is given back when the work does not happen. Every AI route in the API
 * goes through one of the middleware exported here. Provider selection, prompts
 * and the calls themselves live in `services/aiService.ts`.
 *
 * Credit model
 * - Two pools per user. The DAILY allowance (`AI_DAILY_LIMIT`, default
 *   `DEFAULT_AI_DAILY_LIMIT`) resets at 00:00 UTC. The BANKED bonus pool
 *   (`services/aiBonusUses.ts`, earned through referrals, capped at
 *   `REFERRAL_BONUS_AI_USES_CAP`) never expires. `chargeGlobalAllowance()` always
 *   tries daily first and falls back to bonus, and a charge is paid entirely from
 *   one pool — never split — so the `pool` on the reservation is the whole truth
 *   for the refund path.
 * - A third counter, the PER-FEATURE daily cap (`FEATURE_LIMITS`, overridable per
 *   feature with `AI_LIMIT_<FEATURE>`), is a fairness rule rather than a currency:
 *   it moves one step per request whatever the credit cost, and bonus uses do not
 *   extend it.
 * - Charging happens BEFORE the model call, in middleware, so a user who cannot
 *   afford the action is refused without any provider spend. `aiRateLimitForFeature`
 *   checks the feature cap first, so a spent feature budget never burns a global
 *   credit; if the global charge succeeds and the feature counter then trips, the
 *   global credit is released before the 429.
 * - Refunds return to the pool that paid. Every paid middleware registers a
 *   `res.on('finish')` refund for any non-2xx response, and the `res.json` wrapper
 *   restates the pre-charge usage headers so the client badge does not tick down
 *   for work that never happened. Async 202 handlers carry the charge on
 *   `res.locals.aiCharge` so a permanently failed job can refund it later.
 *
 * Atomicity
 * `reserveUsage()` is a single Redis `INCRBY` followed by a full-cost rollback
 * when it overshoots the limit. There is no read-modify-write and therefore no
 * double-spend race between concurrent requests, and a denial can never partially
 * consume credits. This is deliberate; `aiRateLimit.dualCharge.test.ts` and
 * `aiRateLimit.refund.test.ts` pin the behaviour.
 *
 * Exports
 * - Middleware: `aiRateLimit` (flat one-credit), `aiRateLimitWithCost` (cost
 *   derived from the request, clamped to `MAX_AI_CREDIT_COST`),
 *   `aiRateLimitForFeature` (global credit plus feature cap; zero-credit features
 *   get the cap-only limiter).
 * - Manual charge/refund for handlers that charge outside middleware (note OCR):
 *   `chargeAiCredits`, `chargeAiCreditsDetailed`, `refundAiCredits`,
 *   `refundFeatureAiCredit`, `applyGlobalUsageHeaders`, `NOTE_OCR_CREDIT_COST`.
 * - Reads for GET /ai/usage and the admin console: `getAIUsage`,
 *   `getFeatureAIUsage`, `getAIBonusUsage`, `getAllAIUsageForUser`,
 *   `resetAIUsageForUser`.
 * - Header names: `AI_COST_HEADER`, `AI_BONUS_REMAINING_HEADER`,
 *   `AI_USAGE_EXPOSED_HEADERS` (the CORS `Access-Control-Expose-Headers` list —
 *   a new header added here must be added there or browsers cannot read it).
 *
 * What it touches
 * - Redis keys `redisKey("ai:<YYYY-MM-DD>:<userId>")` for the global daily
 *   counter and `redisKey("ai:<YYYY-MM-DD>:<userId>:<featureKey>")` for the
 *   per-feature cap, each expiring at the next UTC midnight. The bonus pool is
 *   owned by `services/aiBonusUses.ts` and is not stored under these keys.
 * - No database and no provider API of its own.
 */
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
  describeAIDailyLimitReached,
  describeAIFeatureLimitReached,
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

/* --------------------------------- limits, windows and the fallback store -- */

// The per-process fallback counter, used whenever Redis is unavailable.
// FIXED (F7a): the fallback is still a per-process Map — it has to be, there is
// nowhere else to count — but it is no longer silent, and production no longer
// boots into it. `initializeAiRateLimitStore()` mirrors
// `initializeRateLimitStores()` in middleware/rateLimit.ts exactly: it throws in
// production when no Redis client can be had (so the process refuses to start
// rather than serving an unshared spend cap), and logs a loud one-line warning
// outside production. Every request-time fall-through then calls
// `noteAiLimiterFallback()`, which flips the store kind to 'memory' (readable by
// `getAiLimiterStoreKind()`, the same test hook shape `getLimiterStoreKind()`
// gives the HTTP limiters) and logs a throttled degraded-mode error, so a Redis
// incident is visible in the logs and in the degraded header instead of showing
// up as a provider bill.
const userAIUsage = new Map<string, { count: number; dateKey: string }>();

export type AiLimiterStoreKind = 'redis' | 'memory';

let aiLimiterStoreKind: AiLimiterStoreKind | undefined;
let lastFallbackWarnAt = 0;

/** Ten minutes between degraded-mode log lines: loud, not a flood. */
const FALLBACK_WARN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Which store the AI counters are actually using, or undefined before the first
 * counter call. `'memory'` means the daily allowance is per process and not
 * shared between instances — the degraded mode, never the intended one in
 * production. Exported so tests can assert the fallback is reported.
 */
export function getAiLimiterStoreKind(): AiLimiterStoreKind | undefined {
  return aiLimiterStoreKind;
}

/** Test seam: forget what the last call observed. */
export function resetAiLimiterStoreKindForTests(): void {
  aiLimiterStoreKind = undefined;
  lastFallbackWarnAt = 0;
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Record (and periodically shout about) a request served from the Map. */
function noteAiLimiterFallback(): void {
  aiLimiterStoreKind = 'memory';
  const now = Date.now();
  if (now - lastFallbackWarnAt < FALLBACK_WARN_INTERVAL_MS) return;
  lastFallbackWarnAt = now;
  logger.error(
    'AI rate limiter DEGRADED: Redis unavailable, counting AI credits in this process only. ' +
      'The daily allowance is no longer shared between instances and resets on restart.'
  );
}

function noteAiLimiterRedis(): void {
  aiLimiterStoreKind = 'redis';
}

/**
 * Startup check for the AI credit counters, mirroring
 * `initializeRateLimitStores()` (H2) decision for decision: Redis is REQUIRED in
 * production, and its absence is a startup failure rather than a silent
 * downgrade. Outside production the Map fallback is fine for development, but it
 * says so loudly once at boot.
 */
export async function initializeAiRateLimitStore(): Promise<void> {
  const client = await getRedisClient();
  if (isProductionEnv() && !client) {
    throw new Error(
      'Redis is required for AI credit limiting in production (REDIS_ENABLED=true, REDIS_URL set)'
    );
  }
  if (client) {
    noteAiLimiterRedis();
    return;
  }
  aiLimiterStoreKind = 'memory';
  logger.warn(
    'AI credit limiting is using the per-process fallback counter (no Redis). ' +
      'Counts are not shared between instances and reset on restart.'
  );
}

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

// Windows are calendar days in UTC, not rolling windows: the date key is part of
// the Redis key and the TTL is set to the remaining seconds of the day, so the
// counter expires rather than being reset by a job.
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

/* ---------------------------------------- the counter primitive and reads -- */

// The one place a counter moves. `reserveUsage` charges (positive cost) and
// refunds (negative cost) on both the global key `ai:<date>:<userId>` and the
// feature key `ai:<date>:<userId>:<featureKey>`; `readUsage` is the matching
// non-mutating read. Nothing else in this module touches Redis for counting.
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
    noteAiLimiterRedis();
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

  noteAiLimiterFallback();
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
  /**
   * FIXED (F10): why a refusal was NOT the student's fault. Both values mean
   * the request must answer 503, not the 429 "you've used your daily limit"
   * — telling a student they are out of credits when the platform ran out of
   * budget, or when Redis is down, is a lie they cannot act on.
   */
  denialReason?: 'platform_budget' | 'limiter_unavailable';
}

/**
 * Reserve `cost` against the global allowance, falling back to the bonus pool.
 * All-or-nothing in both pools: a refusal consumes nothing anywhere.
 */
/**
 * The platform-wide daily AI budget, in credits — the cap that bounds the
 * PROVIDER BILL rather than any one student.
 *
 * KNOWN ISSUE (tracked, deferred F10: product decision — the NUMBER is a
 * founder cost decision and nobody else can pick it; a wrong guess either
 * leaves the bill uncapped or cuts every student off mid-afternoon): every
 * other limit in this module is per user and per feature, sign-up is free and
 * unverified, so provider cost still scales linearly with the number of
 * accounts until this is set.
 *
 * What F10 did build is the mechanism, so setting it is one environment
 * variable and a redeploy: `AI_DAILY_BUDGET_CREDITS`. UNSET means unlimited,
 * which is today's behaviour exactly — the counter is not even touched — so
 * this is inert until the founder names a number. Set it to, say, 50000 and
 * every AI charge is reserved against one shared daily counter first; when the
 * day's budget is gone every AI route answers 503 AI_BUDGET_EXHAUSTED until
 * midnight UTC instead of spending money nobody approved.
 *
 * Read per call rather than at module load so the value can be changed without
 * a code change, and so tests can set it.
 */
function platformDailyBudget(): number | null {
  const raw = process.env.AI_DAILY_BUDGET_CREDITS;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The key the platform counter lives under. It shares `reserveUsage`'s
 * `ai:<date>:<key>` shape and its midnight-UTC expiry, so the budget resets with
 * everything else. The sentinel cannot collide with a user id: those are UUIDs.
 */
const PLATFORM_BUDGET_KEY = '__platform__';

async function chargeGlobalAllowance(userId: string, cost: number): Promise<GlobalCharge> {
  // FIXED (F10, coordinator R1): fail CLOSED when the authoritative counter is
  // gone. Falling through to the per-process Map means each replica keeps its
  // own allowance, so a Redis incident multiplies both the per-user cap and the
  // platform budget by the replica count — the spend cap disappearing exactly
  // during an incident. Outside production the Map is the intended dev store.
  const redis = await getRedisClient();
  if (!redis?.isOpen && isProductionEnv()) {
    noteAiLimiterFallback();
    return {
      allowed: false,
      count: 0,
      resetTime: Date.now() + msUntilNextUtcMidnight(),
      pool: 'daily',
      bonusRemaining: 0,
      denialReason: 'limiter_unavailable',
    };
  }

  // The platform budget is reserved BEFORE the user's own pools, so a refusal
  // here costs the student nothing, and released again below if the user cannot
  // pay — the platform must not be billed for a request that never ran.
  const budget = platformDailyBudget();
  const chargesPlatform = budget !== null && cost > 0;
  if (chargesPlatform) {
    const platform = await reserveUsage(PLATFORM_BUDGET_KEY, budget as number, cost);
    if (!platform.allowed) {
      logger.error(
        'Platform AI budget exhausted for the day; AI routes are answering 503 until midnight UTC.',
        { budget, used: platform.count }
      );
      return {
        allowed: false,
        count: 0,
        resetTime: platform.resetTime,
        pool: 'daily',
        bonusRemaining: await getBonusBalance(userId),
        denialReason: 'platform_budget',
      };
    }
  }

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
  if (!paidFromBonus && chargesPlatform) {
    await releaseUsage(PLATFORM_BUDGET_KEY, cost);
  }
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
  // The platform budget is charged for every allowed request whatever pool paid
  // the student's half, so it is given back for every refund the same way.
  if (platformDailyBudget() !== null) {
    await releaseUsage(PLATFORM_BUDGET_KEY, cost);
  }
  if (pool === 'bonus') {
    await refundBonusUses(userId, cost);
    return;
  }
  await releaseUsage(userId, cost);
}

/**
 * Answer a refusal that is the PLATFORM's fault, not the student's. Returns
 * true when it answered, so the caller returns immediately.
 */
function respondIfServiceDenial(res: Response, result: GlobalCharge): boolean {
  if (!result.denialReason) return false;
  res.status(503).json({
    error:
      result.denialReason === 'platform_budget'
        ? 'AI is at its limit for today across Lantern. It comes back at midnight UTC — nothing was charged to your account.'
        : 'AI is temporarily unavailable. Please try again in a few minutes — nothing was charged to your account.',
    code:
      result.denialReason === 'platform_budget'
        ? 'AI_BUDGET_EXHAUSTED'
        : 'AI_LIMITER_UNAVAILABLE',
    resetsAt: toResetsAt(result.resetTime),
  });
  return true;
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

/**
 * Current count for a key without charging it. Backs GET /ai/usage and the
 * soft feature check in `aiRateLimitForFeature`.
 * When Redis is down this reads the per-process Map, so it reports the count
 * this instance happens to hold — see the fallback note on `userAIUsage`.
 */
async function readUsage(
  key: string,
  limit: number
): Promise<{ used: number; limit: number; resetsAt: string }> {
  const now = Date.now();
  const dateKey = getUtcDateKey(new Date(now));
  const resetsAt = nextUtcMidnightIso(now);
  const redis = await getRedisClient();

  if (redis?.isOpen) {
    noteAiLimiterRedis();
    const rKey = redisKey(`ai:${dateKey}:${key}`);
    const raw = await redis.get(rKey);
    const used = raw ? parseInt(raw, 10) : 0;
    return { used, limit, resetsAt };
  }

  noteAiLimiterFallback();
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
/* ------------------------------------------- usage headers sent to clients -- */

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
  // FIXED (F7a): say so when the count came from the per-process fallback, so a
  // client is not told "3 used" by a counter that knows about one instance only.
  if (aiLimiterStoreKind === 'memory') {
    res.setHeader(AI_USAGE_DEGRADED_HEADER, 'memory');
  }
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

/* ------------------------------------------------------ the middleware -- */

/**
 * Flat one-credit gate for AI routes with no feature cap of their own. Requires
 * an authenticated request (`authMiddleware` must run first). Charges before the
 * handler and leaves the charge on `res.locals.aiCharge` for 202 async handlers.
 *
 * KNOWN ISSUE (tracked, deferred F10: product decision — the platform-wide cap
 * is now BUILT but deliberately unset, because the number is a founder cost
 * decision): every limit in this module is per user and per feature, so until
 * `AI_DAILY_BUDGET_CREDITS` is given a value provider cost still scales
 * linearly with the number of accounts and sign-up is free and unverified. See
 * `platformDailyBudget()` — setting that one variable is the whole change.
 */
export async function aiRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const result = await chargeGlobalAllowance(userId, AI_FEATURE_CREDIT_COST);
  setBonusHeader(res, result.bonusRemaining);
  if (respondIfServiceDenial(res, result)) return;
  if (!result.allowed) {
    res.status(429).json({
      // Plain words with the two facts a student can act on — how many they
      // get and when they come back. "Try again tomorrow" was wrong for most
      // of the world: these windows roll over at midnight UTC.
      error: describeAIDailyLimitReached({
        limit: AI_DAILY_LIMIT,
        resetsAt: toResetsAt(result.resetTime),
      }),
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

/* ------------------------------- manual charge/refund for non-middleware -- */
// Note OCR charges from inside its handler rather than from middleware, because
// the cost is only known once the upload is inspected. These helpers give that
// path the same all-or-nothing reservation and pool-aware refund.

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
        // FIXED (F10): this helper has no `res` to answer 503 on, so the
        // caller's 429 stands — but the SENTENCE must not blame the student
        // for a platform refusal they cannot act on.
        error: result.denialReason
          ? result.denialReason === 'platform_budget'
            ? 'AI is at its limit for today across Lantern. It comes back at midnight UTC — nothing was charged to your account.'
            : 'AI is temporarily unavailable. Please try again in a few minutes — nothing was charged to your account.'
          : credits > 1
            ? `Daily AI limit reached. ${label} needs ${credits} AI uses — you have ${describeRemaining(result)}.`
            : describeAIDailyLimitReached({
                limit: AI_DAILY_LIMIT,
                resetsAt: toResetsAt(result.resetTime),
              }),
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
 * Give back the global + feature credit reserved by aiRateLimitForFeature, for
 * handlers that answer 2xx without doing AI work (e.g. a quiz regenerate that
 * returns the existing quiz untouched). Non-2xx responses are refunded
 * automatically by the middleware itself.
 *
 * `credits` is the GLOBAL half and defaults to the one credit
 * aiRateLimitForFeature reserves. A queued job whose request reserved more than
 * that (a variable-cost route that also names a feature) hands back what it
 * actually took: hard-coding 1 here left the rest of a multi-credit charge on
 * the student's counter for work that never happened. The feature counter is a
 * cap rather than a currency — it moves one step per request whatever the
 * charge, so it always comes back one step.
 */
export async function refundFeatureAiCredit(
  userId: string,
  featureKey: string,
  pool: AiUsePool = 'daily',
  credits: number = AI_FEATURE_CREDIT_COST
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
    releaseGlobalAllowance(
      userId,
      Math.max(0, Math.floor(credits)) || AI_FEATURE_CREDIT_COST,
      pool
    ),
    releaseUsage(buildUsageKey(userId, featureKey), AI_FEATURE_CREDIT_COST),
  ]);
}

export const AI_COST_HEADER = 'X-AI-Cost';

/** Every response header this module can set. CORS must expose all of these. */
/** Present only while the counters are running on the per-process fallback. */
export const AI_USAGE_DEGRADED_HEADER = 'X-AI-Usage-Degraded';

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
  'X-AI-Usage-Degraded',
] as const;

/**
 * Charge a variable number of global AI credits based on the request, reserved
 * atomically BEFORE the handler runs: a user who cannot afford the action is
 * refused with a 429 without consuming anything or doing any work.
 */
/**
 * Variable-cost gate. `getCost(req)` is clamped into `[1, MAX_AI_CREDIT_COST]`,
 * so a malformed or hostile request body cannot ask for a free action or an
 * unbounded charge — but the cost still derives from what the client sent, and
 * any cross-check against the real workload belongs in the route.
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

    if (respondIfServiceDenial(res, result)) return;
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
            : describeAIDailyLimitReached({
                limit: AI_DAILY_LIMIT,
                resetsAt: toResetsAt(result.resetTime),
              }),
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

/* --------------------------------------- per-feature caps and key shapes -- */
// A feature with no entry in FEATURE_LIMITS falls back to the global daily
// limit, so an unknown key is capped but not free.

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
        // The feature KEY is a routing detail. It used to be shown to
        // students in brackets; the noun and the countdown replace it.
        error: describeAIFeatureLimitReached({
          featureKey,
          limit,
          resetsAt: toResetsAt(featureResult.resetTime),
        }),
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

/**
 * The gate for a named feature. Zero-credit features get the cap-only limiter
 * above; everything else runs, in order: soft feature-cap read, global charge
 * (daily then bonus), feature-cap increment, refund-on-non-2xx registration,
 * usage headers. The feature cap is deliberately checked before the global
 * charge so a spent feature budget cannot consume a credit.
 */
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
        error: describeAIFeatureLimitReached({
          featureKey,
          limit,
          resetsAt: featureSnapshot.resetsAt,
        }),
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
    if (respondIfServiceDenial(res, globalResult)) return;
    if (!globalResult.allowed) {
      res.status(429).json({
        error: describeAIDailyLimitReached({
          limit: AI_DAILY_LIMIT,
          resetsAt: toResetsAt(globalResult.resetTime),
        }),
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
        error: describeAIFeatureLimitReached({
          featureKey,
          limit,
          resetsAt: toResetsAt(featureResult.resetTime),
        }),
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

/* -------------------------------------------- admin and usage-screen reads -- */

/**
 * Clears today's counters for a user, one feature or all of them. Only today's
 * date key is deleted — older keys have already expired. The Map branch scans
 * this process only, so after a Redis outage other instances keep their own
 * stale fallback counts.
 */
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

/** Global row plus one row per configured feature, for the Usage & limits screen. */
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
