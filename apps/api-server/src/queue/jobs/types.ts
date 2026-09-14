import type {
  JobCredit,
  JobError,
  JobKind,
  JobPushAudit,
  JobResultRef,
  JobStage,
} from "@lantern/shared/jobs/jobState";

export const QUEUE_NAMES = {
  AI_GENERATION: "ai-generation",
  FILE_PROCESSING: "file-processing",
  DATA_EXPORT: "data-export",
  MARKETPLACE_ALERTS: "marketplace-alerts",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobStatus = "queued" | "active" | "completed" | "failed";

/**
 * The durable record behind every 202. Stored in Redis (see queue/jobStatus)
 * and served verbatim by GET /api/v1/jobs/:id, so its shape is a client
 * contract: `stage`/`percent` drive the progress a student sees, `resultRef`
 * tells the client where the finished work landed, and `credit` is the honest
 * ledger for the charge this job's request reserved.
 */
export interface JobRecord {
  id: string;
  queue: QueueName;
  name: string;
  kind: JobKind;
  /** Legacy status older clients still read; always derived from `stage`. */
  status: JobStatus;
  stage: JobStage;
  /** 0-100, monotonic — it never goes backwards. */
  percent: number;
  userId?: string;
  /** The note/deck/file this job was started from, for the completion push's
      subtitle ("10 flashcards ready · SDOH"). Stamped at enqueue when the
      payload carried a title; absent jobs simply lose the suffix. */
  sourceTitle?: string;
  result?: unknown;
  resultRef?: JobResultRef;
  error?: JobError;
  createdAt: string;
  /** First moment a worker picked the job up. */
  startedAt?: string;
  updatedAt: string;
  /** Set when the job reached done/failed/timed_out. */
  finishedAt?: string;
  /** AI credits reserved by the request that enqueued this job — refunded if
      the job permanently fails (a 202 is a 2xx, so the middleware's own
      non-2xx auto-refund can never fire for async work). */
  charge?: {
    credits: number;
    featureKey?: string;
    /**
     * Which allowance paid: the daily counter or the banked bonus pool.
     * Absent on records written before bonus uses existed — those were all
     * daily, and are refunded as such.
     */
    pool?: 'daily' | 'bonus';
  };
  /** What was charged and what has been handed back. */
  credit?: JobCredit;
  /** Set once the failure refund has been issued, so retries can't double-refund. */
  chargeRefunded?: boolean;
  /** What happened to this job's completion push. Served to the OWNER only. */
  push?: JobPushAudit;
}

export type AIJobName =
  | "ai.generate.questions"
  | "ai.generate.flashcards"
  | "ai.generate.lesson"
  | "ai.generate.recap"
  | "ai.generate.essay"
  | "ai.generate.topic"
  | "ai.explain.answer"
  | "ai.study.recommendations"
  | "ai.ask.tutor"
  | "ai.enhance.flashcard"
  | "ai.companion.message"
  | "notes.ai.summarize"
  | "notes.ai.quiz"
  | "notes.ai.flashcards"
  | "ai.studyPack.generate"
  | "notes.ai.narration";

export type FileJobName =
  | "deck.importApkg"
  | "notes.presentation.preview"
  | "notes.youtube.transcript"
  | "notes.ocr.extract";

export type ExportJobName = "export.userData";

export type CronJobName =
  | "cron.dataRetention"
  | "cron.marketplaceAlerts"
  | "cron.jobAlerts"
  | "cron.jobReminders"
  | "cron.studyReminders"
  | "cron.examReminders"
  | "cron.weeklySummary";

export type JobName = AIJobName | FileJobName | ExportJobName | CronJobName;
