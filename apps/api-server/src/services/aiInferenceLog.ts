import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

export interface AIInferenceLogEntry {
  userId: string;
  feature: string;
  provider?: string;
  model?: string;
  tokenEstimate?: number;
  requestId?: string;
}

export async function logAIInference(
  client: SupabaseClient,
  entry: AIInferenceLogEntry
): Promise<void> {
  try {
    const { error } = await client.from('ai_inference_log').insert({
      user_id: entry.userId,
      feature: entry.feature,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      token_estimate: entry.tokenEstimate ?? null,
      request_id: entry.requestId ?? null,
    });
    if (error) {
      logger.warn('AI inference log insert failed', { error: error.message, feature: entry.feature });
    }
  } catch (err) {
    logger.warn('AI inference log exception', { err, feature: entry.feature });
  }
}
