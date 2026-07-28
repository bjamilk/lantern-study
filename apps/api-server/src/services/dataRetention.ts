import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';

const RETENTION_DAYS = parseInt(process.env.AI_LOG_RETENTION_DAYS || '90', 10);

export async function purgeExpiredAIInferenceLogs(supabaseService: SupabaseService): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabaseService
    .getClient()
    .from('ai_inference_log')
    .delete()
    .lt('created_at', cutoffIso)
    .select('id');

  if (error) {
    logger.error('Failed to purge AI inference logs', { error: error.message });
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    logger.info('Purged expired AI inference logs', { count, cutoffIso });
  }
  return count;
}

export async function purgeExpiredAIAnalytics(supabaseService: SupabaseService): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabaseService
    .getClient()
    .from('ai_analytics')
    .delete()
    .lt('created_at', cutoffIso)
    .select('id');

  if (error) {
    logger.warn('Failed to purge ai_analytics', { error: error.message });
    return 0;
  }
  return data?.length ?? 0;
}

export async function purgeExpiredProductEvents(supabaseService: SupabaseService): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabaseService
    .getClient()
    .from('product_events')
    .delete()
    .lt('created_at', cutoffIso)
    .select('id');

  if (error) {
    logger.warn('Failed to purge product_events', { error: error.message });
    return 0;
  }
  const count = data?.length ?? 0;
  if (count > 0) {
    logger.info('Purged expired product_events', { count, cutoffIso });
  }
  return count;
}

export type DataRetentionPurgeResult = {
  aiInferenceLogs: number;
  aiAnalytics: number;
  productEvents: number;
  scheduledAccounts: number;
};

/**
 * Single retention pass used by both the in-process daily timer and BullMQ cron.dataRetention.
 * Must include scheduled account hard-deletes so pause→grace→purge works when BULLMQ_ENABLED=true.
 */
export async function runDataRetentionPurge(
  supabaseService: SupabaseService
): Promise<DataRetentionPurgeResult> {
  const aiInferenceLogs = await purgeExpiredAIInferenceLogs(supabaseService);
  const aiAnalytics = await purgeExpiredAIAnalytics(supabaseService);
  const productEvents = await purgeExpiredProductEvents(supabaseService);
  const { purgeScheduledAccountDeletions } = await import('./accountLifecycle');
  const scheduledAccounts = await purgeScheduledAccountDeletions(supabaseService);
  return { aiInferenceLogs, aiAnalytics, productEvents, scheduledAccounts };
}

export function startDataRetentionJobs(supabaseService: SupabaseService): void {
  if (process.env.ENABLE_DATA_RETENTION_JOBS !== 'true') {
    return;
  }

  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  const run = async () => {
    await runDataRetentionPurge(supabaseService);
  };

  void run();
  setInterval(() => void run(), INTERVAL_MS);
  logger.info('Data retention jobs scheduled (daily)');
}
