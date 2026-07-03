import { Queue } from 'bullmq';
import { getQueueConnectionOptions, isBullMqEnabled } from './connection';
import { QUEUE_NAMES, type QueueName } from './jobs/types';

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue | null {
  if (!isBullMqEnabled()) return null;
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getQueueConnectionOptions() });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

export { QUEUE_NAMES };
