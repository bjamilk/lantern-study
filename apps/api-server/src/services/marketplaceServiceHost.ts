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
 * `SupabaseService` spells every one of these FLAT (`createNotification`,
 * `getMarketplaceListingById`, …), so the facade does not satisfy this type.
 * The call sites that still hold one — four `deps` arrows inside the facade —
 * go through `marketplaceHostFromFlat`, which is typed: the parameter is
 * structural, so this module names no facade, and an `as any` on the handle is
 * exactly the shape that shipped the #92 regression. The adapter has no other
 * caller, and it is deleted with the class.
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

/** The flat spelling of the same members — i.e. what the facade exposes. */
export type FlatMarketplaceHost = {
  getClient: () => ReturnType<DataLayer['getClient']>;
  createNotification: DataLayer['notifications']['createNotification'];
  getMarketplaceListingById: DataLayer['marketplace']['getMarketplaceListingById'];
  createMarketplaceListing: DataLayer['marketplace']['createMarketplaceListing'];
  logMarketplaceBudgetTransactions: DataLayer['marketplace']['logMarketplaceBudgetTransactions'];
  listBlockedUserIds: DataLayer['directMessages']['listBlockedUserIds'];
  sendDirectMessage: DataLayer['directMessages']['sendDirectMessage'];
  signStorageDisplayUrl: DataLayer['storageAcl']['signStorageDisplayUrl'];
  signStorageDisplayUrls: DataLayer['storageAcl']['signStorageDisplayUrls'];
  getGroupById: DataLayer['groups']['getGroupById'];
  saveOfflineBundle: DataLayer['offlineBundles']['saveOfflineBundle'];
  createNote: DataLayer['notes']['createNote'];
  updateNote: DataLayer['notes']['updateNote'];
  importDeck: DataLayer['decks']['importDeck'];
  replaceDeckCards: DataLayer['decks']['replaceDeckCards'];
  resolveArtefactTopic: DataLayer['academic']['resolveArtefactTopic'];
};

/**
 * Regroup a flat holder under the namespaces that own each member. Every arrow
 * reads through `flat` at CALL time, so a stand-in that swaps a method after
 * construction is honoured — the property the facade's own `this.` arrows have.
 */
export function marketplaceHostFromFlat(
  flat: FlatMarketplaceHost,
): MarketplaceServiceHost {
  return {
    getClient: () => flat.getClient(),
    notifications: {
      createNotification: (...args) => flat.createNotification(...args),
    },
    marketplace: {
      getMarketplaceListingById: (...args) =>
        flat.getMarketplaceListingById(...args),
      createMarketplaceListing: (...args) =>
        flat.createMarketplaceListing(...args),
      logMarketplaceBudgetTransactions: (...args) =>
        flat.logMarketplaceBudgetTransactions(...args),
    },
    directMessages: {
      listBlockedUserIds: (...args) => flat.listBlockedUserIds(...args),
      sendDirectMessage: (...args) => flat.sendDirectMessage(...args),
    },
    storageAcl: {
      signStorageDisplayUrl: (...args) => flat.signStorageDisplayUrl(...args),
      signStorageDisplayUrls: (...args) => flat.signStorageDisplayUrls(...args),
    },
    groups: { getGroupById: (...args) => flat.getGroupById(...args) },
    offlineBundles: {
      saveOfflineBundle: (...args) => flat.saveOfflineBundle(...args),
    },
    notes: {
      createNote: (...args) => flat.createNote(...args),
      updateNote: (...args) => flat.updateNote(...args),
    },
    decks: {
      importDeck: (...args) => flat.importDeck(...args),
      replaceDeckCards: (...args) => flat.replaceDeckCards(...args),
    },
    academic: {
      resolveArtefactTopic: (...args) => flat.resolveArtefactTopic(...args),
    },
  };
}
