/**
 * AI Rate Limiting Middleware
 * Limits each user to a configurable number of AI requests per day.
 * Uses in-memory tracking that resets at midnight UTC.
 */
import { Request, Response, NextFunction } from 'express';

const userAIUsage = new Map<string, { count: number; resetTime: number }>();

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '10', 10);

/**
 * Get the current AI usage for a user (read-only).
 */
export function getAIUsage(userId: string): { used: number; limit: number; resetsAt: string } {
  const now = Date.now();
  const usage = userAIUsage.get(userId);

  if (!usage || now > usage.resetTime) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return { used: 0, limit: AI_DAILY_LIMIT, resetsAt: tomorrow.toISOString() };
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
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    userAIUsage.set(userId, { count: 1, resetTime: tomorrow.getTime() });
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
