export const QUEUE_NAMES = {
  AI_GENERATION: "ai-generation",
  FILE_PROCESSING: "file-processing",
  DATA_EXPORT: "data-export",
  MARKETPLACE_ALERTS: "marketplace-alerts",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobStatus = "queued" | "active" | "completed" | "failed";

export interface JobRecord {
  id: string;
  queue: QueueName;
  name: string;
  status: JobStatus;
  userId?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** AI credits reserved by the request that enqueued this job — refunded if
      the job permanently fails (a 202 is a 2xx, so the middleware's own
      non-2xx auto-refund can never fire for async work). */
  charge?: { credits: number; featureKey?: string };
  /** Set once the failure refund has been issued, so retries can't double-refund. */
  chargeRefunded?: boolean;
}

export type AIJobName =
  | "ai.generate.questions"
  | "ai.generate.flashcards"
  | "ai.explain.answer"
  | "ai.study.recommendations"
  | "ai.ask.tutor"
  | "ai.enhance.flashcard"
  | "ai.companion.message"
  | "notes.ai.summarize"
  | "notes.ai.quiz"
  | "notes.ai.flashcards";

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
  | "cron.jobReminders";

export type JobName = AIJobName | FileJobName | ExportJobName | CronJobName;
