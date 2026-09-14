export { createApiClient, type ApiClient, type ApiClientConfig } from './client';
export { createIdempotencyKey } from './idempotency';
export { VersionConflictError, isVersionConflictError } from './versionConflict';
export {
  RateLimitError,
  parseRetryAfterMs,
  listingsCacheKey,
  marketplaceListingsCache,
  marketplaceCategoryAnalyticsCache,
} from './marketplaceCache';
export {
  createApiEndpoints,
  isQuestionStatEligible,
  isNotEnabledError,
  COMMUNITY_NOT_ENABLED_CODE,
  COMMUNITY_NOT_ENABLED_COPY,
  type BoardMessageRow,
  type CommunityInviteCreated,
  type CommunityInviteSummary,
  type LanternApiEndpoints,
  type NotEnabledError,
} from './endpoints';
export {
  createAIClient,
  type AIClientConfig,
  type LanternAIClient,
  type AIGeneratedQuestion,
  type AIGeneratedFlashcard,
  type AIStudyRecommendation,
  type AIStudyPerformanceData,
} from './ai';
export {
  createCompanionClient,
  normalizeCompanionCitation,
  COMPANION_MODES,
  DEFAULT_COMPANION_MODE,
  COMPANION_MODE_LABELS,
  isCompanionMode,
  normalizeCompanionMode,
  GUIDED_MODE_PROMISE,
  GUIDED_PICKER_TITLE,
  GUIDED_COST_NOTE,
  buildGuidedGoals,
  guidedFreeTextPrompt,
  guidedSeedPrompt,
  showGuidedComposerPicker,
  type GuidedGoal,
  type GuidedGoalsInput,
  type GuidedNextTopic,
  type GuidedStartTopic,
  type LanternCompanionClient,
} from './companion';
export {
  parseGlobalAIUsageFromHeaders,
  parseGlobalAIUsageFromHeaderReader,
  xhrHeaderReader,
  type AIUsageHeaderReader,
} from './usageHeaders';

import { createApiClient, type ApiClientConfig } from './client';
import { createApiEndpoints } from './endpoints';
import { createAIClient, type AIClientConfig } from './ai';
import { createCompanionClient } from './companion';

export function createLanternApi(config: ApiClientConfig) {
  const client = createApiClient(config);
  return {
    client,
    api: createApiEndpoints(client),
  };
}

export function createLanternAI(config: AIClientConfig) {
  const ai = createAIClient(config);
  const companion = createCompanionClient(config);
  return { ai, companion };
}
