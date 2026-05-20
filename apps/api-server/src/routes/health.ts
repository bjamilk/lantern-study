import { Router, Request, Response } from 'express';

const router = Router();
const startTime = Date.now();

// Simple health check - for load balancer probes
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// Detailed readiness check - verifies all dependencies
router.get('/ready', async (req: Request, res: Response) => {
  const checks: Record<string, { status: 'ok' | 'error'; latency?: number; error?: string }> = {};
  let isHealthy = true;

  // Check database connection
  const dbStart = Date.now();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    
    const { error } = await supabase.from('profiles').select('id').limit(1);
    
    if (error && error.code !== 'PGRST116') throw error;
    
    checks.database = { 
      status: 'ok', 
      latency: Date.now() - dbStart 
    };
  } catch (error: any) {
    checks.database = { 
      status: 'error', 
      latency: Date.now() - dbStart,
      error: error.message 
    };
    isHealthy = false;
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  const memUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  checks.memory = {
    status: memUsedPercent < 90 ? 'ok' : 'error',
    latency: Math.round(memUsedPercent),
  };
  
  if (memUsedPercent >= 90) {
    checks.memory.error = 'Memory usage above 90%';
    isHealthy = false;
  }

  // Check event loop lag
  const eventLoopStart = Date.now();
  await new Promise(resolve => setImmediate(resolve));
  const eventLoopLag = Date.now() - eventLoopStart;
  
  checks.eventLoop = {
    status: eventLoopLag < 100 ? 'ok' : 'error',
    latency: eventLoopLag,
  };

  if (eventLoopLag >= 100) {
    checks.eventLoop.error = 'Event loop lag too high';
    isHealthy = false;
  }

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Metrics endpoint for monitoring systems
router.get('/metrics', (req: Request, res: Response) => {
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
