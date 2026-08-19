/**
 * AI Rate Limiting Middleware
 * Distributed via Redis when REDIS_ENABLED=true; in-memory fallback for dev.
 * Each window resets at 00:00 UTC (midnight GMT).
 */
import { Request, Response, NextFunction } from 'express';
import { getRedisClient, redisKey } from '../services/redisStore';
import { logger } from '../utils/logger';

import { DEFAULT_AI_DAILY_LIMIT, DEFAULT_AI_FEATURE_LIMITS } from '@lantern/shared/utils/aiUsage';
import { AI_CREDIT_COSTS, MAX_AI_CREDIT_COST } from '@lantern/shared/utils/aiCredits';

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
  return reserveUsage(key, limit, 1);
}

/** Hand back credits reserved for work that never happened. */
async function releaseUsage(key: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  await reserveUsage(key, Number.MAX_SAFE_INTEGER, -credits);
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

  const result = await incrementUsage(userId, AI_DAILY_LIMIT);
  if (!result.allowed) {
    res.status(429).json({
      error: 'Daily AI limit reached. Try again tomorrow.',
      limit: AI_DAILY_LIMIT,
      used: result.count,
      resetsAt: toResetsAt(result.resetTime),
    });
    return;
  }

  setLegacyAndGlobalUsageHeaders(res, result);
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
  const credits = Math.max(0, Math.floor(amount));
  if (credits <= 0) return null;

  const result = await reserveUsage(userId, AI_DAILY_LIMIT, credits);
  if (!result.allowed) {
    const remaining = Math.max(0, AI_DAILY_LIMIT - result.count);
    return {
      error:
        credits > 1
          ? `Daily AI limit reached. ${label} needs ${credits} credits — you have ${remaining} left today.`
          : 'Daily AI limit reached. Try again tomorrow.',
      limit: AI_DAILY_LIMIT,
      used: result.count,
      resetsAt: toResetsAt(result.resetTime),
    };
  }
  return null;
}

/** Give back credits already reserved when a request bails before doing AI work. */
export async function refundAiCredits(userId: string, amount: number): Promise<void> {
  const credits = Math.max(0, Math.floor(amount));
  if (credits <= 0) return;
  await reserveUsage(userId, Number.MAX_SAFE_INTEGER, -credits);
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

    const result = await reserveUsage(userId, AI_DAILY_LIMIT, cost);
    res.setHeader(AI_COST_HEADER, String(cost));
    setLegacyAndGlobalUsageHeaders(res, result);

    if (!result.allowed) {
      const remaining = Math.max(0, AI_DAILY_LIMIT - result.count);
      res.status(429).json({
        error:
          cost > 1
            ? `${label} needs ${cost} AI credits — you have ${remaining} left today.`
            : 'Daily AI limit reached. Try again tomorrow.',
        limit: AI_DAILY_LIMIT,
        used: result.count,
        remaining,
        cost,
        resetsAt: toResetsAt(result.resetTime),
      });
      return;
    }

    (res.locals as Record<string, unknown>).aiCreditsCharged = cost;
    next();
  };
}

/** Attach current global AI usage headers (for OCR and other non-middleware charges). */
export async function applyGlobalUsageHeaders(res: Response, userId: string): Promise<void> {
  const usage = await getAIUsage(userId);
  const resetTime = usage.resetsAt ? Date.parse(usage.resetsAt) : Date.now();
  setLegacyAndGlobalUsageHeaders(res, {
    count: usage.used,
    resetTime: Number.isFinite(resetTime) ? resetTime : Date.now(),
  });
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

export function aiRateLimitForFeature(featureKey: string) {
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
    const globalResult = await incrementUsage(userId, AI_DAILY_LIMIT);
    if (!globalResult.allowed) {
      res.status(429).json({
        error: 'Daily AI limit reached. Try again tomorrow.',
        limit: AI_DAILY_LIMIT,
        used: globalResult.count,
        resetsAt: toResetsAt(globalResult.resetTime),
      });
      return;
    }

    const featureResult = await incrementUsage(key, limit);
    if (!featureResult.allowed) {
      // The global credit was reserved a few lines up. Give it back rather than
      // charging for a request this middleware is itself about to refuse.
      await releaseUsage(userId, 1);
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
      void Promise.all([releaseUsage(userId, 1), releaseUsage(key, 1)]).catch((error) => {
        logger.warn('Failed to refund AI credits for a request that did not succeed', {
          userId,
          featureKey,
          status: res.statusCode,
          error,
        });
      });
    });

    res.setHeader('X-AI-Feature', featureKey);
    // Feature-scoped counts (for inline "N left" next to that tool).
    res.setHeader('X-AI-Usage-Used', featureResult.count.toString());
    res.setHeader('X-AI-Usage-Limit', limit.toString());
    res.setHeader('X-AI-Usage-Resets-At', toResetsAt(featureResult.resetTime));
    // Global counts drive the sidebar / floating AI badge.
    setGlobalUsageHeaders(res, globalResult);
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
