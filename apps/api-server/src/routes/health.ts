import v8 from 'v8';
import { Router, Request, Response } from 'express';
import { requireOperationalAccess } from '../middleware/operationalAuth';
import { isProductionEnv } from '../utils/safeError';
import { concurrencySnapshots } from '../utils/concurrencyGate';
import { turnstileConfigStatus } from '../middleware/turnstile';

const router = Router();
const startTime = Date.now();

// Short commit SHA of the running build. Render injects RENDER_GIT_COMMIT; the
// generic names cover other hosts. Without this there is no way to tell whether
// a deploy has actually landed — /health returned a bare "ok", and Render keeps
// the previous build serving when a deploy fails, so a healthy response proved
// nothing about which code was live.
const COMMIT =
  (
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    ''
  ).slice(0, 7) || 'unknown';

router.get('/health', (req: Request, res: Response) => {
  // Whether bot protection is actually switched on. A boolean only — it leaks
  // no secret, and the alternative was discovering the answer by sending a
  // real contact-form submission, which delivers an email. Enforcement needs
  // TURNSTILE_SECRET and TURNSTILE_HOSTNAMES together, so a half-configured
  // deployment reads "off" here rather than looking configured.
  const turnstile = turnstileConfigStatus();
  // Presence only, same lesson as turnstile: whether error monitoring is
  // actually on should be checkable without triggering a real error.
  const sentry = process.env.SENTRY_DSN ? 'on' : 'off';
  // Which AI providers hold a key, presence only — same reasoning as turnstile
  // above. Without this the only way to find out whether a newly added key
  // reached the running service was to spend a user's daily AI credits on a
  // request and read the failure, which is a poor diagnostic and costs the
  // user something. No key material, just configured or not.
  const ai = {
    groq: process.env.GROQ_API_KEY ? 'on' : 'off',
    fireworks: process.env.FIREWORKS_API_KEY ? 'on' : 'off',
    gemini: process.env.GEMINI_API_KEY ? 'on' : 'off',
    cloudflare: process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID ? 'on' : 'off',
    huggingface: process.env.HF_API_TOKEN ? 'on' : 'off',
  };

  if (isProductionEnv()) {
    // Deliberately no build details beyond the commit: this endpoint is public.
    return res.status(200).json({ status: 'ok', commit: COMMIT, turnstile, sentry, ai });
  }
  res.status(200).json({
    status: 'ok',
    commit: COMMIT,
    turnstile,
    sentry,
    ai,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

router.get('/ready', requireOperationalAccess, async (req: Request, res: Response) => {
  const checks: Record<string, { status: 'ok' | 'error'; latency?: number; error?: string }> = {};
  let isHealthy = true;

  const dbStart = Date.now();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || 'http://127.0.0.1:55421',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    const { error } = await supabase.from('profiles').select('id').limit(1);

    if (error && error.code !== 'PGRST116') throw error;

    checks.database = {
      status: 'ok',
      latency: Date.now() - dbStart,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Database check failed';
    checks.database = {
      status: 'error',
      latency: Date.now() - dbStart,
      error: isProductionEnv() ? 'Database check failed' : message,
    };
    isHealthy = false;
  }

  const memUsage = process.memoryUsage();
  // Compare against V8 heap_size_limit — heapUsed/heapTotal is misleading on cold processes.
  const heapStats = v8.getHeapStatistics();
  const memUsedPercent =
    heapStats.heap_size_limit > 0
      ? (heapStats.used_heap_size / heapStats.heap_size_limit) * 100
      : (memUsage.heapUsed / Math.max(memUsage.heapTotal, 1)) * 100;

  checks.memory = {
    status: memUsedPercent < 90 ? 'ok' : 'error',
    latency: Math.round(memUsedPercent),
  };

  if (memUsedPercent >= 90) {
    checks.memory.error = 'Memory usage above 90% of heap limit';
    isHealthy = false;
  }

  const eventLoopStart = Date.now();
  await new Promise((resolve) => setImmediate(resolve));
  const eventLoopLag = Date.now() - eventLoopStart;

  checks.eventLoop = {
    status: eventLoopLag < 100 ? 'ok' : 'error',
    latency: eventLoopLag,
  };

  if (eventLoopLag >= 100) {
    checks.eventLoop.error = 'Event loop lag too high';
    isHealthy = false;
  }

  if (process.env.REDIS_ENABLED === 'true') {
    const redisStart = Date.now();
    try {
      const { getRedisClient } = await import('../services/redisStore');
      const client = await getRedisClient();
      if (!client) throw new Error('Redis client unavailable');
      await client.ping();
      checks.redis = { status: 'ok', latency: Date.now() - redisStart };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Redis check failed';
      checks.redis = {
        status: 'error',
        latency: Date.now() - redisStart,
        error: isProductionEnv() ? 'Redis check failed' : message,
      };
      isHealthy = false;
    }
  }

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

router.get('/metrics', requireOperationalAccess, (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  res.json({
    uptime: process.uptime(),
    uptimeHuman: formatUptime(process.uptime()),
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: memUsage.external,
      rss: memUsage.rss,
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    concurrency: concurrencySnapshots(),
    pid: process.pid,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  });
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export default router;
