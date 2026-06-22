/**
 * AI Rate Limiting Middleware
 * Distributed via Redis when REDIS_ENABLED=true; in-memory fallback for dev.
 * Each window resets at 00:00 UTC (midnight GMT).
 */
import { Request, Response, NextFunction } from 'express';
import { getRedisClient, redisKey } from '../services/redisStore';

const userAIUsage = new Map<string, { count: number; dateKey: string }>();

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '20', 10);

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

async function incrementUsage(
  key: string,
  limit: number
): Promise<{ allowed: boolean; count: number; resetTime: number }> {
  const now = Date.now();
  const dateKey = getUtcDateKey(new Date(now));
  const resetTime = new Date(now + msUntilNextUtcMidnight(now)).getTime();
  const redis = await getRedisClient();

  if (redis?.isOpen) {
    const rKey = redisKey(`ai:${dateKey}:${key}`);
    const raw = await redis.get(rKey);
    const current = raw ? parseInt(raw, 10) : 0;

    if (current >= limit) {
      return { allowed: false, count: current, resetTime };
    }

    const count = current === 0 ? 1 : await redis.incr(rKey);
    if (current === 0) {
      const ttlSec = Math.ceil(msUntilNextUtcMidnight(now) / 1000);
      await redis.set(rKey, '1', { EX: ttlSec });
      return { allowed: 1 <= limit, count: 1, resetTime };
    }

    return { allowed: count <= limit, count, resetTime };
  }

  const usage = userAIUsage.get(key);
  if (usage && usage.dateKey === dateKey) {
    if (usage.count >= limit) {
      return { allowed: false, count: usage.count, resetTime };
    }
    usage.count++;
    return { allowed: true, count: usage.count, resetTime };
  }

  userAIUsage.set(key, { count: 1, dateKey });
  return { allowed: true, count: 1, resetTime };
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

  res.setHeader('X-AI-Usage-Used', result.count.toString());
  res.setHeader('X-AI-Usage-Limit', AI_DAILY_LIMIT.toString());
  res.setHeader('X-AI-Usage-Resets-At', toResetsAt(result.resetTime));
  next();
}

const FEATURE_LIMITS: Record<string, number> = {
  companion: parseInt(process.env.AI_LIMIT_COMPANION || '15', 10),
  generate_questions: parseInt(process.env.AI_LIMIT_GENERATE_QUESTIONS || '3', 10),
  generate_flashcards: parseInt(process.env.AI_LIMIT_GENERATE_FLASHCARDS || '3', 10),
  explain: parseInt(process.env.AI_LIMIT_EXPLAIN || '8', 10),
  study_plan: parseInt(process.env.AI_LIMIT_STUDY_PLAN || '2', 10),
  enhance_flashcard: parseInt(process.env.AI_LIMIT_ENHANCE_FLASHCARD || '5', 10),
  study_recommendations: parseInt(process.env.AI_LIMIT_STUDY_RECOMMENDATIONS || '5', 10),
};

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
    const result = await incrementUsage(key, limit);

    if (!result.allowed) {
      res.status(429).json({
        error: `Daily limit reached for this feature (${featureKey}). Try again tomorrow.`,
        feature: featureKey,
        limit,
        used: result.count,
        resetsAt: toResetsAt(result.resetTime),
      });
      return;
    }

    res.setHeader('X-AI-Feature', featureKey);
    res.setHeader('X-AI-Usage-Used', result.count.toString());
    res.setHeader('X-AI-Usage-Limit', limit.toString());
    res.setHeader('X-AI-Usage-Resets-At', toResetsAt(result.resetTime));
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
