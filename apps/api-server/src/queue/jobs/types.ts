export const QUEUE_NAMES = {
  AI_GENERATION: 'ai-generation',
  FILE_PROCESSING: 'file-processing',
  DATA_EXPORT: 'data-export',
  MARKETPLACE_ALERTS: 'marketplace-alerts',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

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
}

export type AIJobName =
  | 'ai.generate.questions'
  | 'ai.generate.flashcards'
  | 'ai.explain.answer'
  | 'ai.study.recommendations'
  | 'ai.ask.tutor'
  | 'ai.enhance.flashcard'
  | 'ai.companion.message'
  | 'notes.ai.summarize'
  | 'notes.ai.quiz'
  | 'notes.ai.flashcards';

export type FileJobName = 'deck.importApkg';

export type ExportJobName = 'export.userData';

export type CronJobName =
  | 'cron.dataRetention'
  | 'cron.marketplaceAlerts';

export type JobName = AIJobName | FileJobName | ExportJobName | CronJobName;
