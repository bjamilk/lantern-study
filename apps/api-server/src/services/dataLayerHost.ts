/**
 * dataLayerHost.ts — the shrinking bridge from the data layer back to the
 * `SupabaseService` facade.
 *
 * ## Purpose
 *
 * `services/data/index.ts` builds every `deps` literal the data modules need.
 * Seven of those deps cannot be built from the data layer alone, and this
 * module is the one place that admits it.
 *
 * It held fifteen until monolith lane M3. The five bodies that never left the
 * facade (`normalizeMessageRecord`, `normalizeListingRecord(Async)`,
 * `signSimilarListingCards`, `calculateTestScore`, `generateTestQuestions`)
 * now live in `data/mappers.ts`, `data/marketplace.ts` and `data/tests.ts`,
 * and the per-instance rating-column circuit breaker is held by the LAYER
 * (`createRatingColumnCircuitBreaker`). What is left is one group, plus
 * `legacyService`:
 *
 *  1. SERVICES THAT TAKE THE WHOLE `SupabaseService` — `marketplaceOrders`,
 *     `marketplaceSellerTools`, `marketplaceFavoriteAlerts`,
 *     `learningConnections`, `userDataLifecycle`, `courseTopics`. The bodies
 *     here are the facade's own inline arrows, moved verbatim, lazy `import()`
 *     included — the import still happens when the dep is CALLED, never at
 *     module load, which is what keeps the cycle out of the boot path.
 *
 * ## The gotcha
 *
 * This file only shrinks. Every entry removed from it is a dep the data layer
 * can build for itself, and when it is empty `SupabaseService` has nothing left
 * that anything needs — which is the condition for deleting the facade. Do not
 * add an entry without saying in the PR how it comes back out.
 *
 * ## What it touches
 *
 * Nothing directly. It holds no client and issues no query; every body here
 * delegates to the facade instance or to a `services/*` singleton.
 */
import type { SupabaseService } from './supabase';
import type { DataLayerHost } from './data';

export function createDataLayerHost(service: SupabaseService): DataLayerHost {
  return {
    legacyService: service,

    resolveTopicForArtefact: async (topicId, courseId) => {
      const { getCourseTopicsService } = await import('./courseTopics');
      return getCourseTopicsService(service).resolveForArtefact(topicId, courseId);
    },

    recordLearningConnection: async (input) => {
      const { getLearningConnectionsService } = await import('./learningConnections');
      await getLearningConnectionsService(service).record(input as never);
    },
    createOrderFromBuyNow: async (lid, buyerId, couponCode, quantity) => {
      const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
      return getMarketplaceOrdersService(service).createOrderFromBuyNow(
        lid,
        buyerId,
        couponCode,
        quantity,
      );
    },
    createOrderFromOfferAccept: async (offerId, actorId) => {
      const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
      return getMarketplaceOrdersService(service).createOrderFromOfferAccept(
        offerId,
        actorId,
      );
    },
    consumeBoostCredit: async (sellerId) => {
      const { getMarketplaceSellerToolsService } = await import(
        './marketplaceSellerTools'
      );
      return getMarketplaceSellerToolsService(service).consumeBoostCredit(sellerId);
    },
    notifyListingBackAvailable: async (listing, previousStatus) => {
      const { notifyListingBackAvailable } = await import('./marketplaceFavoriteAlerts');
      await notifyListingBackAvailable(service, listing, previousStatus);
    },

    deleteUserAccountFully: async (userId) =>
      (await import('./userDataLifecycle')).deleteUserAccountFully(service, userId),
    exportUserDataArchive: async (userId) =>
      (await import('./userDataLifecycle')).exportUserDataArchive(service, userId),
  };
}
