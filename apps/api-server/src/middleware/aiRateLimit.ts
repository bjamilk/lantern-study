/**
 * AI Rate Limiting Middleware
 * Limits each user to a configurable number of AI requests per day.
 * Uses in-memory tracking that resets at midnight UTC.
 */
import { Request, Response, NextFunction } from 'express';

const userAIUsage = new Map<string, { count: number; resetTime: number }>();

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '10', 10);

// compute next reset timestamp at midnight GMT+1 (Europe/Paris zone) to match user's requested timezone
function computeNextReset(): number {
  const now = new Date();
  // create a Date string in the target timezone, then set its hours to 24:00 and parse back to UTC
  const tzString = now.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
  const local = new Date(tzString);
  local.setHours(24, 0, 0, 0);
  // convert back to UTC ms by calculating difference between local and tzString parsed as UTC
  const iso = local.toISOString();
  return new Date(iso).getTime();
}

/**
 * Get the current AI usage for a user (read-only).
 */
export function getAIUsage(userId: string): { used: number; limit: number; resetsAt: string } {
  const now = Date.now();
  const usage = userAIUsage.get(userId);

  if (!usage || now > usage.resetTime) {
    const next = new Date(computeNextReset());
    return { used: 0, limit: AI_DAILY_LIMIT, resetsAt: next.toISOString() };
  }

  return {
    used: usage.count,
    limit: AI_DAILY_LIMIT,
    resetsAt: new Date(usage.resetTime).toISOString(),
  };
}

export function aiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = req.body?.userId || req.query?.userId || req.ip || 'anonymous';
  const limit = AI_DAILY_LIMIT;
  const now = Date.now();

  const usage = userAIUsage.get(userId);

  if (usage && usage.resetTime > now) {
    if (usage.count >= limit) {
      res.status(429).json({
        error: 'Daily AI limit reached. Try again tomorrow.',
        limit,
        used: usage.count,
        resetsAt: new Date(usage.resetTime).toISOString(),
      });
      return;
    }
    usage.count++;
  } else {
    const nextReset = computeNextReset();
    userAIUsage.set(userId, { count: 1, resetTime: nextReset });
  }

  // Attach usage info to response headers for the client
  const current = userAIUsage.get(userId)!;
  res.setHeader('X-AI-Usage-Used', current.count.toString());
  res.setHeader('X-AI-Usage-Limit', AI_DAILY_LIMIT.toString());
  res.setHeader('X-AI-Usage-Resets-At', new Date(current.resetTime).toISOString());

  // Periodically clean up stale entries
  if (userAIUsage.size > 10000) {
    for (const [key, val] of userAIUsage) {
      if (val.resetTime < now) userAIUsage.delete(key);
    }
  }

  next();
}
