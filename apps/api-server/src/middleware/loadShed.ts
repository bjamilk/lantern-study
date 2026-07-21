import v8 from 'v8';
import { Request, Response, NextFunction } from 'express';
import { aiInflightGate, companionStreamGate } from '../utils/concurrencyGate';

let shuttingDown = false;

export function markServerShuttingDown(): void {
  shuttingDown = true;
}

export function isServerShuttingDown(): boolean {
  return shuttingDown;
}

function isExemptPath(path: string): boolean {
  return path === '/health' || path === '/ready' || path === '/metrics';
}

/**
 * Use heap_size_limit (true V8 ceiling), not heapTotal.
 * heapUsed/heapTotal is often >90% on a cold process because V8 keeps
 * heapTotal small until it needs to grow — that was falsely 503'ing all traffic.
 */
export function isUnderMemoryPressure(): boolean {
  const mem = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();
  const limit = heapStats.heap_size_limit || 0;
  const used = heapStats.used_heap_size || mem.heapUsed;
  const limitRatio = limit > 0 ? used / limit : 0;
  const shedLimitRatio = parseFloat(process.env.LOAD_SHED_HEAP_RATIO || '0.90');
  const rssLimit = parseInt(
    process.env.LOAD_SHED_RSS_BYTES || String(1.5 * 1024 * 1024 * 1024),
    10
  );
  return limitRatio >= shedLimitRatio || mem.rss >= rssLimit;
}

/**
 * Fail fast under memory / AI saturation so the process stays responsive
 * for health checks and short requests. Clients should honor Retry-After.
 */
export function loadShedMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isExemptPath(req.path)) {
    next();
    return;
  }

  if (shuttingDown) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Server is shutting down. Please retry.',
    });
    return;
  }

  if (isUnderMemoryPressure()) {
    res.setHeader('Retry-After', '10');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Server under memory pressure. Please retry shortly.',
    });
    return;
  }

  // Shed new AI work when this process is already at AI capacity.
  const isAiWork =
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    req.method !== 'OPTIONS' &&
    (req.path.startsWith('/api/v1/ai/') || req.path === '/api/v1/ai');

  if (isAiWork && aiInflightGate.available <= 0) {
    res.setHeader('Retry-After', '5');
    res.setHeader('X-AI-Capacity', 'exhausted');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'AI capacity temporarily exhausted on this instance. Please retry.',
      capacity: {
        ai: aiInflightGate.snapshot(),
        companionStreams: companionStreamGate.snapshot(),
      },
    });
    return;
  }

  next();
}
