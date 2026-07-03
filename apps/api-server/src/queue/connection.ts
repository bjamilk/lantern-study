import type { ConnectionOptions } from 'bullmq';

export function isBullMqEnabled(): boolean {
  return process.env.BULLMQ_ENABLED === 'true' && !!process.env.REDIS_URL;
}

export function getQueueConnectionOptions(): ConnectionOptions {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required for BullMQ');
  }
  return {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null,
  };
}

export async function closeQueueConnection(): Promise<void> {
  // Connection options are stateless; workers/queues close their own connections.
}
