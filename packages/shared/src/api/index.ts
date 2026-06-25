export { createApiClient, type ApiClient, type ApiClientConfig } from './client';
export {
  RateLimitError,
  parseRetryAfterMs,
  listingsCacheKey,
  marketplaceListingsCache,
  marketplaceCategoryAnalyticsCache,
} from './marketplaceCache';
export { createApiEndpoints, type LanternApiEndpoints } from './endpoints';
export {
  createAIClient,
  type AIClientConfig,
  type LanternAIClient,
  type AIGeneratedQuestion,
  type AIGeneratedFlashcard,
  type AIStudyRecommendation,
} from './ai';
export { createCompanionClient, type LanternCompanionClient } from './companion';

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
