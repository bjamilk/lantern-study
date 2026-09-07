import { randomUUID } from "crypto";
import { getQueue } from "./queues";
import { createJobRecord } from "./jobStatus";
import { isBullMqEnabled } from "./connection";
import type { JobName, QueueName } from "./jobs/types";

const QUEUE_FOR_JOB: Record<JobName, QueueName> = {
  "ai.generate.questions": "ai-generation",
  "ai.generate.flashcards": "ai-generation",
  "ai.explain.answer": "ai-generation",
  "ai.study.recommendations": "ai-generation",
  "ai.ask.tutor": "ai-generation",
  "ai.enhance.flashcard": "ai-generation",
  "ai.companion.message": "ai-generation",
  "notes.ai.summarize": "ai-generation",
  "notes.ai.quiz": "ai-generation",
  "notes.ai.flashcards": "ai-generation",
  "ai.studyPack.generate": "ai-generation",
  "deck.importApkg": "file-processing",
  "notes.presentation.preview": "file-processing",
  "notes.youtube.transcript": "file-processing",
  "notes.ocr.extract": "file-processing",
  "export.userData": "data-export",
  "cron.dataRetention": "marketplace-alerts",
  "cron.marketplaceAlerts": "marketplace-alerts",
  "cron.jobAlerts": "marketplace-alerts",
  "cron.jobReminders": "marketplace-alerts",
  "cron.studyReminders": "marketplace-alerts",
  "cron.weeklySummary": "marketplace-alerts",
};

/**
 * The material a job was started from, for the completion push's subtitle.
 * Routes that already pass a `title` (or an explicit `sourceTitle`) get it for
 * free; the rest just have no suffix, which is honest.
 */
function sourceTitleFromPayload(payload: Record<string, unknown>): string | undefined {
  for (const key of ["sourceTitle", "title", "fileName"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return undefined;
}

export interface EnqueueResult {
  jobId: string;
  async: true;
}

export type AiJobCharge = { credits: number; featureKey?: string };

export async function enqueueJob(
  name: JobName,
  payload: Record<string, unknown>,
  userId?: string,
  charge?: AiJobCharge,
): Promise<EnqueueResult | null> {
  if (!isBullMqEnabled()) return null;

  const queueName = QUEUE_FOR_JOB[name];
  const queue = getQueue(queueName);
  if (!queue) return null;

  const jobId = randomUUID();
  await createJobRecord({
    id: jobId,
    queue: queueName,
    name,
    userId,
    charge,
    sourceTitle: sourceTitleFromPayload(payload),
  });

  await queue.add(
    name,
    { ...payload, userId },
    {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );

  return { jobId, async: true };
}

export async function runSyncOrEnqueue<T>(
  name: JobName,
  payload: Record<string, unknown>,
  userId: string | undefined,
  syncFn: () => Promise<T>,
  charge?: AiJobCharge,
): Promise<{ mode: "sync"; result: T } | { mode: "async"; jobId: string }> {
  const enqueued = await enqueueJob(name, payload, userId, charge);
  if (enqueued) {
    return { mode: "async", jobId: enqueued.jobId };
  }
  const result = await syncFn();
  return { mode: "sync", result };
}

/**
 * Force in-request AI (e.g. audio transcription that must return immediately).
 * Prefer `runSyncOrEnqueue` for other note/AI tools so BullMQ can offload the web process.
 */
export async function runNoteAiSync<T>(syncFn: () => Promise<T>): Promise<T> {
  return syncFn();
}
