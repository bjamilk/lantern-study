/**
 * dataLayerHost.ts — the shrinking bridge from the data layer back to the
 * `SupabaseService` facade.
 *
 * ## Purpose
 *
 * `services/data/index.ts` builds every `deps` literal the data modules need.
 * Fifteen of those deps cannot be built from the data layer alone, and this
 * module is the one place that admits it. They fall into three groups:
 *
 *  1. BODIES THAT NEVER LEFT THE FACADE — `normalizeMessageRecord`,
 *     `normalizeListingRecord(Async)`, `signSimilarListingCards`,
 *     `calculateTestScore`, `generateTestQuestions`. Most are `private`, hence
 *     the casts below: they are reached through the instance until the lane
 *     that moves them into `services/data/*` runs.
 *  2. PER-INSTANCE STATE — `ratingColumnsAvailable` /
 *     `noteRatingColumnsMissing`, the circuit breaker for the unapplied
 *     rating-column migration. `supabase.reviewSignals.test.ts` asserts it PER
 *     INSTANCE, so it must stay on the instance and be read through it.
 *  3. SERVICES THAT TAKE THE WHOLE `SupabaseService` — `marketplaceOrders`,
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
import type { DataLayer, DataLayerHost } from './data';

/**
 * The facade methods this bridge reaches that TypeScript hides because they are
 * `private`. Casting once, here, keeps the casts out of the data layer.
 */
type FacadeInternals = {
  normalizeMessageRecord: (row: any) => any;
  normalizeListingRecord: (listing: any) => any;
  normalizeListingRecordAsync: (listing: any) => Promise<any>;
  ratingColumnsAvailable: () => boolean;
  noteRatingColumnsMissing: () => void;
  calculateTestScore: (questions: any[], answers: any[]) => number;
  generateTestQuestions: (config: any) => any[];
};

/**
 * `getLayer` is a THUNK, not the layer: the host is an argument to
 * `createDataLayer`, so the layer does not exist yet when this runs. Every
 * group-3 body below is lazy already — it resolves its `services/` singleton
 * when the dep is CALLED — so by then `server.ts` has assigned the layer. A
 * body that has not been flipped yet still takes `service`; the two coexist
 * until the last of them is flipped and the parameter goes away with them.
 */
export function createDataLayerHost(
  service: SupabaseService,
  getLayer: () => DataLayer,
): DataLayerHost {
  const internals = service as unknown as FacadeInternals;

  return {
    legacyService: service,

    resolveTopicForArtefact: async (topicId, courseId) => {
      const { getCourseTopicsService } = await import('./courseTopics');
      return getCourseTopicsService(service).resolveForArtefact(topicId, courseId);
    },

    normalizeMessageRecord: (row) => internals.normalizeMessageRecord(row),
    normalizeListingRecord: (listing) => internals.normalizeListingRecord(listing),
    normalizeListingRecordAsync: (listing) =>
      internals.normalizeListingRecordAsync(listing),
    ratingColumnsAvailable: () => internals.ratingColumnsAvailable(),
    noteRatingColumnsMissing: () => internals.noteRatingColumnsMissing(),
    signSimilarListingCards: (listings) => service.signSimilarListingCards(listings),
    calculateTestScore: (questions, answers) =>
      internals.calculateTestScore(questions, answers),
    generateTestQuestions: (config) => internals.generateTestQuestions(config),

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
