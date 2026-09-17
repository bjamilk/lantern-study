import { config } from 'dotenv';
config();

import { createRuntimeDataLayer } from './services/data/bootstrap';
import { initializeWorkerServices, scheduleRepeatableCronJobs, startWorkers } from './queue/processors';
import { isBullMqEnabled } from './queue/connection';
import { closeQueues } from './queue/queues';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  if (!isBullMqEnabled()) {
    console.error('BULLMQ_ENABLED=true and REDIS_URL required for worker process');
    process.exit(1);
  }

  // The same factory call `server.ts` makes: one wiring, two processes.
  const { dataLayer } = createRuntimeDataLayer({
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  });

  initializeWorkerServices(dataLayer);
  const workers = startWorkers();
  await scheduleRepeatableCronJobs();

  logger.info('BullMQ worker started', { workers: workers.length });

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
