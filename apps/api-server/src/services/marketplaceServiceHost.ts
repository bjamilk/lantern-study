/**
 * marketplaceServiceHost.ts — the one host type the marketplace money services
 * take, and the typed adapter that builds it from a flat holder.
 *
 * ## Why one type for six services
 *
 * `marketplaceOrders`, `marketplacePayments`, `marketplaceSellerTools`,
 * `marketplaceQuestionBanks`, `marketplaceStudyPacks` and the leaves they call
 * (`creators`, `moderation`, `marketplaceCoupons`, `marketplaceFavoriteAlerts`)
 * are mutually recursive: orders → payments → question banks → payments, seller
 * tools → orders, and each of them hands ITS OWN host to the next. Per-service
 * host aliases would therefore reference each other in a cycle, which a type
 * alias may not do. One shared type states the union once, and every one of
 * those services holds exactly it.
 *
 * It is still NARROW — nine namespaces of one to three members, not the whole
 * `DataLayer` — so it says what the money path may touch, and a test stand-in
 * for it is a plain object literal the compiler checks.
 *
 * ## The gotcha
 *
 * `SupabaseService` spelled every one of these FLAT (`createNotification`,
 * `getMarketplaceListingById`, …), so the facade did not satisfy this type.
 * The four `deps` arrows inside it went through a typed adapter,
 * `marketplaceHostFromFlat`, rather than an `as any` on the handle — which is
 * the shape that shipped the #92 regression. Facade, arrows and adapter are
 * all deleted (lane M3); a test that wants this host builds it from its own
 * stubs, one namespace at a time.
 */
import type { DataLayer } from './data';

export type MarketplaceServiceHost = Pick<DataLayer, 'getClient'> & {
  notifications: Pick<DataLayer['notifications'], 'createNotification'>;
  marketplace: Pick<
    DataLayer['marketplace'],
    | 'getMarketplaceListingById'
    | 'createMarketplaceListing'
    | 'logMarketplaceBudgetTransactions'
  >;
  directMessages: Pick<
    DataLayer['directMessages'],
    'listBlockedUserIds' | 'sendDirectMessage'
  >;
  storageAcl: Pick<
    DataLayer['storageAcl'],
    'signStorageDisplayUrl' | 'signStorageDisplayUrls'
  >;
  groups: Pick<DataLayer['groups'], 'getGroupById'>;
  offlineBundles: Pick<DataLayer['offlineBundles'], 'saveOfflineBundle'>;
  notes: Pick<DataLayer['notes'], 'createNote' | 'updateNote'>;
  decks: Pick<DataLayer['decks'], 'importDeck' | 'replaceDeckCards'>;
  academic: Pick<DataLayer['academic'], 'resolveArtefactTopic'>;
};
