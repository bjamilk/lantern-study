import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

export interface AIInferenceLogEntry {
  userId: string;
  feature: string;
  provider?: string;
  model?: string;
  tokenEstimate?: number;
  /** Provider-reported usage; when present it beats any estimate. */
  usage?: { promptTokens: number; completionTokens: number; cachedTokens: number };
  requestId?: string;
  /**
   * Which tutor style shaped a companion turn (F2). ONE OF FOUR FIXED IDS —
   * never the fragment text, and never anything the student typed.
   *
   * It is not a column on `ai_inference_log`: adding one needs a migration this
   * lane does not own, and a style is worth nothing to bill against. It goes to
   * the structured logger instead, alongside the same feature and provider, so
   * "which styles do students actually use" is answerable from logs today and
   * can move to a column later without changing any call site.
   */
  tutorStyle?: string;
}

export async function logAIInference(
  client: SupabaseClient,
  entry: AIInferenceLogEntry
): Promise<void> {
  if (entry.tutorStyle) {
    logger.info('AI inference tutor style', {
      feature: entry.feature,
      provider: entry.provider ?? null,
      tutorStyle: entry.tutorStyle,
    });
  }
  try {
    const { error } = await client.from('ai_inference_log').insert({
      user_id: entry.userId,
      feature: entry.feature,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      token_estimate:
        entry.usage != null
          ? entry.usage.promptTokens + entry.usage.completionTokens
          : (entry.tokenEstimate ?? null),
      request_id: entry.requestId ?? null,
    });
    if (error) {
      logger.warn('AI inference log insert failed', { error: error.message, feature: entry.feature });
    }
  } catch (err) {
    logger.warn('AI inference log exception', { err, feature: entry.feature });
  }
}
