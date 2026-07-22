import { randomUUID } from 'crypto';
import { getQueue } from './queues';
import { createJobRecord } from './jobStatus';
import { isBullMqEnabled } from './connection';
import type { JobName, QueueName } from './jobs/types';

const QUEUE_FOR_JOB: Record<JobName, QueueName> = {
  'ai.generate.questions': 'ai-generation',
  'ai.generate.flashcards': 'ai-generation',
  'ai.explain.answer': 'ai-generation',
  'ai.study.recommendations': 'ai-generation',
  'ai.ask.tutor': 'ai-generation',
  'ai.enhance.flashcard': 'ai-generation',
  'ai.companion.message': 'ai-generation',
  'notes.ai.summarize': 'ai-generation',
  'notes.ai.quiz': 'ai-generation',
  'notes.ai.flashcards': 'ai-generation',
  'deck.importApkg': 'file-processing',
  'notes.presentation.preview': 'file-processing',
  'notes.youtube.transcript': 'file-processing',
  'export.userData': 'data-export',
  'cron.dataRetention': 'marketplace-alerts',
  'cron.marketplaceAlerts': 'marketplace-alerts',
};

export interface EnqueueResult {
  jobId: string;
  async: true;
}

export async function enqueueJob(
  name: JobName,
  payload: Record<string, unknown>,
  userId?: string
): Promise<EnqueueResult | null> {
  if (!isBullMqEnabled()) return null;

  const queueName = QUEUE_FOR_JOB[name];
  const queue = getQueue(queueName);
  if (!queue) return null;

  const jobId = randomUUID();
  await createJobRecord({ id: jobId, queue: queueName, name, userId });

  await queue.add(name, { ...payload, userId }, {
    jobId,
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  return { jobId, async: true };
}

export async function runSyncOrEnqueue<T>(
  name: JobName,
  payload: Record<string, unknown>,
  userId: string | undefined,
  syncFn: () => Promise<T>
): Promise<{ mode: 'sync'; result: T } | { mode: 'async'; jobId: string }> {
  const enqueued = await enqueueJob(name, payload, userId);
  if (enqueued) {
    return { mode: 'async', jobId: enqueued.jobId };
  }
  const result = await syncFn();
  return { mode: 'sync', result };
}

/**
 * Force in-request AI (e.g. audio transcription that must return immediately).
 * Prefer `runSyncOrEnqueue` for other note/AI tools so BullMQ can offload the web process.
 */
export async function runNoteAiSync<T>(syncFn: () => Promise<T>): Promise<T> {
  return syncFn();
}
