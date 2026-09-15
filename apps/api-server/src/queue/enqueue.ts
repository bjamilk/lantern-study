/**
 * The front door of the job lifecycle: turns a request into a BullMQ job plus
 * the Redis job record the client polls.
 *
 * Exports:
 * - `enqueueJob` — the raw enqueue; returns null when BullMQ is not configured.
 * - `runSyncOrEnqueue` — what routes actually call: queue the work if a worker
 *   can take it, otherwise run the same work in-request and answer with the
 *   result. A route therefore has two shapes of success (202 + jobId, or 200 +
 *   payload) and must handle both.
 * - `runNoteAiSync` — the explicit opt-out for work that must return inline.
 * - `retryOptionsForJob` — the `attempts`/`backoff` a job name is queued with.
 * - `AiJobCharge` — the charge descriptor a route stamps onto the record.
 *
 * What it touches:
 * - BullMQ queues `ai-generation`, `file-processing`, `data-export` and
 *   `marketplace-alerts` (`QUEUE_FOR_JOB` is the only mapping of job name to
 *   queue; `queue/processors/index.ts` starts one worker per queue).
 * - Redis, indirectly, through `createJobRecord` — key `job:<uuid>`, 24 h TTL.
 *
 * Charge contract: the route charges the AI credit BEFORE calling in here, and
 * passes what it charged as `charge`. A 202 is a 2xx, so the rate-limit
 * middleware's non-2xx auto-refund never fires for async work; the queue owns
 * the refund instead (`refundJobCreditOnce` in `queue/jobStatus.ts`), and it
 * refunds to the pool named here.
 */
import { randomUUID } from "crypto";
import { getQueue } from "./queues";
import { createJobRecord } from "./jobStatus";
import { isBullMqEnabled } from "./connection";
import type { JobName, QueueName } from "./jobs/types";

// ---------------------------------------------------------------------------
// Job name -> queue routing
//
// One queue per class of work so a slow class cannot starve another: every AI
// generation shares `ai-generation`, attachment/import work goes to
// `file-processing`, GDPR-style exports to `data-export`, and every repeatable
// cron to `marketplace-alerts` (which runs at concurrency 1). A `JobName` with
// no entry here cannot be enqueued — the type makes that a compile error.
// ---------------------------------------------------------------------------
const QUEUE_FOR_JOB: Record<JobName, QueueName> = {
  "ai.generate.questions": "ai-generation",
  "ai.generate.flashcards": "ai-generation",
  "ai.generate.lesson": "ai-generation",
  "ai.generate.recap": "ai-generation",
  "ai.generate.essay": "ai-generation",
  "ai.generate.topic": "ai-generation",
  "ai.explain.answer": "ai-generation",
  "ai.study.recommendations": "ai-generation",
  "ai.ask.tutor": "ai-generation",
  "ai.enhance.flashcard": "ai-generation",
  "ai.companion.message": "ai-generation",
  "notes.ai.summarize": "ai-generation",
  "notes.ai.quiz": "ai-generation",
  "notes.ai.flashcards": "ai-generation",
  "ai.studyPack.generate": "ai-generation",
  "notes.ai.narration": "ai-generation",
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
  "cron.examReminders": "marketplace-alerts",
  "cron.weeklySummary": "marketplace-alerts",
};

/* -------------------------------------------------------------------------
 * Retries
 *
 * A job fails for one of two reasons: the input was wrong (permanent) or the
 * world was briefly unavailable — a provider 429, a storage blip, a dropped
 * connection (transient). Only the second is worth retrying, and the processor
 * is what tells the difference: `toJobError` classifies the message and
 * `wrapProcessor` converts a permanent failure into an `UnrecoverableError`, so
 * these attempt counts only ever spend on the transient kind.
 *
 * Counts are deliberately small and the backoff deliberately long: every AI
 * attempt is real provider spend, and the record's 10-minute stale window
 * (JOB_STALE_TIMEOUT_MS) has to outlast the delay plus the next attempt, which
 * is why the AI delay is 15 s rather than minutes.
 * ---------------------------------------------------------------------- */

type JobRetryOptions = {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
};

/** Model calls: one 429 or upstream hiccup should not lose the student's work. */
const AI_RETRY: JobRetryOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
};

/**
 * Long generations get ONE retry, not two: a study pack is up to a dozen model
 * calls, so a second full re-run is more provider spend than the failure cost.
 */
const LONG_AI_RETRY: JobRetryOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
};

/** File work fails on the bytes far more often than on the world. */
const FILE_RETRY: JobRetryOptions = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 10_000 },
};

/** An export is idempotent and cheap to redo; a storage blip should not lose it. */
const EXPORT_RETRY: JobRetryOptions = {
  attempts: 3,
  backoff: { type: 'fixed', delay: 30_000 },
};

/** Crons run again on their own schedule — retrying just doubles the fan-out. */
const CRON_RETRY: JobRetryOptions = {
  attempts: 1,
  backoff: { type: 'fixed', delay: 0 },
};

const RETRY_FOR_QUEUE: Record<QueueName, JobRetryOptions> = {
  'ai-generation': AI_RETRY,
  'file-processing': FILE_RETRY,
  'data-export': EXPORT_RETRY,
  'marketplace-alerts': CRON_RETRY,
};

/** Job names whose retry profile differs from their queue's default. */
const RETRY_FOR_JOB: Partial<Record<JobName, JobRetryOptions>> = {
  'ai.studyPack.generate': LONG_AI_RETRY,
  'notes.ai.narration': LONG_AI_RETRY,
};

/**
 * What BullMQ should do when this job throws. Exported so the values are
 * testable directly — an `attempts` that silently reads 1 is what made every
 * retry path downstream dead code.
 */
export function retryOptionsForJob(name: JobName): JobRetryOptions {
  return RETRY_FOR_JOB[name] ?? RETRY_FOR_QUEUE[QUEUE_FOR_JOB[name]];
}

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

/**
 * What a request reserved before it handed work to a queue.
 *
 * `pool` records WHICH allowance paid — daily or banked bonus — because a job
 * that permanently fails must refund to the same pool. Older job records
 * predate the field; they are treated as 'daily', which is what they were.
 */
export type AiJobCharge = {
  credits: number;
  featureKey?: string;
  pool?: 'daily' | 'bonus';
};

/**
 * Create a job record and hand the work to its queue.
 *
 * Returns null — not an error — when BullMQ is disabled or the queue is
 * missing, which is the signal `runSyncOrEnqueue` uses to fall back to
 * in-request execution.
 *
 * The record is written BEFORE `queue.add`, so a worker can never pick the job
 * up and find nothing to advance, and the charge is on the record from the
 * first instant the refund path could need it. The BullMQ job id is the same
 * uuid as the record id, which is what lets the processors look a record up
 * from `job.id`.
 */
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

  // FIXED (F7a): real `attempts` and `backoff` per job type (see
  // `retryOptionsForJob`), so the retry-aware machinery downstream is live:
  // `refundChargeOnFinalFailure` now has non-final attempts to skip, and a
  // `JobError.retryable` is honoured rather than advertised. A processor that
  // knows the input is bad throws an UnrecoverableError, so a permanent failure
  // still fails on the first attempt.
  await queue.add(
    name,
    { ...payload, userId },
    {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 200,
      ...retryOptionsForJob(name),
    },
  );

  return { jobId, async: true };
}

/**
 * Offload to a worker when one exists; otherwise do the work here.
 *
 * `syncFn` runs only on the no-queue path, so it must be the same work the
 * processor would have done — a divergence shows up as a feature that behaves
 * differently in local development (no Redis) than in production.
 */
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
